import {
  FLEET_SCHEMA_VERSION,
  type CommandReceipt,
  type MissionCommand,
  type RobotAdapterEvent,
  type RobotDescriptor,
  type RobotStateSnapshot,
} from "@brash/contracts";
import {
  AdapterContractError,
  ROBOT_ADAPTER_SDK_VERSION,
  assertAdapterEvent,
  assertCommandReceipt,
  assertRobotDescriptor,
  assertRobotState,
  type AdapterManifest,
  type RobotAdapter,
  type RobotAdapterEventHandler,
  type Unsubscribe,
} from "@brash/robot-adapter-sdk";

export const CANONICAL_HTTP_ADAPTER_PROTOCOL_VERSION = "1.0" as const;

export interface CanonicalHttpEndpointManifest {
  protocol: "BRASH_CANONICAL_HTTP";
  protocolVersion: typeof CANONICAL_HTTP_ADAPTER_PROTOCOL_VERSION;
  serviceId: string;
  supportedFleetSchemaVersions: string[];
  capabilities: string[];
}

export interface SequencedAdapterEvent {
  sequence: number;
  event: RobotAdapterEvent;
}

export interface AdapterEventBatch {
  oldestSequence: number;
  latestSequence: number;
  events: SequencedAdapterEvent[];
}

export interface HttpRobotAdapterOptions {
  baseUrl: string;
  adapterId?: string;
  displayName?: string;
  bearerToken?: string;
  requestTimeoutMs?: number;
  eventPollIntervalMs?: number;
  eventBatchSize?: number;
  allowInsecureHttp?: boolean;
  fetchImplementation?: typeof fetch;
  onBackgroundError?: (error: Error) => void;
}

export class HttpRobotAdapter implements RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  private readonly baseUrl: URL;
  private readonly bearerToken?: string;
  private readonly requestTimeoutMs: number;
  private readonly eventPollIntervalMs: number;
  private readonly eventBatchSize: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly onBackgroundError: (error: Error) => void;
  private readonly handlers = new Set<RobotAdapterEventHandler>();
  private connected = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private activePollAbort: AbortController | null = null;
  private lastEventSequence = 0;
  private consecutivePollFailures = 0;

  constructor(options: HttpRobotAdapterOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    if (this.baseUrl.protocol !== "https:" && !isLoopback(this.baseUrl.hostname) && !options.allowInsecureHttp) {
      throw new Error("HTTP robot adapter requires HTTPS outside loopback addresses. Set allowInsecureHttp only for an isolated development network.");
    }
    this.adapterId = options.adapterId ?? "brash-http-emulator";
    this.manifest = {
      sdkVersion: ROBOT_ADAPTER_SDK_VERSION,
      adapterId: this.adapterId,
      displayName: options.displayName ?? "BRASH canonical HTTP robot adapter",
      adapterVersion: "1.0.0",
      protocol: "REST",
      vendor: "BRASH",
      features: [
        "ROBOT_DISCOVERY",
        "STATE_POLLING",
        "STATE_EVENTS",
        "MISSION_EXECUTION",
        "MISSION_CANCELLATION",
        "IDEMPOTENT_COMMANDS",
      ],
      supportedFleetSchemaVersions: [FLEET_SCHEMA_VERSION],
    };
    this.bearerToken = options.bearerToken;
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, 5_000, "requestTimeoutMs");
    this.eventPollIntervalMs = positiveInteger(options.eventPollIntervalMs, 100, "eventPollIntervalMs");
    this.eventBatchSize = positiveInteger(options.eventBatchSize, 250, "eventBatchSize");
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.onBackgroundError = options.onBackgroundError ?? (() => undefined);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const remote = await this.request<CanonicalHttpEndpointManifest>("/api/v1/manifest");
    assertEndpointManifest(remote);
    if (!remote.supportedFleetSchemaVersions.includes(FLEET_SCHEMA_VERSION)) {
      throw new AdapterContractError(
        "REMOTE_SCHEMA_UNSUPPORTED",
        `Remote adapter does not support Fleet schema ${FLEET_SCHEMA_VERSION}.`,
      );
    }
    this.connected = true;
    if (this.handlers.size > 0) this.schedulePoll(0);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.activePollAbort?.abort();
    this.activePollAbort = null;
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    this.assertConnected();
    const descriptors = await this.request<RobotDescriptor[]>("/api/v1/robots");
    if (!Array.isArray(descriptors)) throw new AdapterContractError("REMOTE_RESPONSE_INVALID", "Robot inventory must be an array.");
    const robotIds = new Set<string>();
    for (const descriptor of descriptors) {
      assertRobotDescriptor(descriptor);
      if (robotIds.has(descriptor.robotId)) {
        throw new AdapterContractError("INVENTORY_ROBOT_DUPLICATE", `Remote inventory contains ${descriptor.robotId} more than once.`);
      }
      robotIds.add(descriptor.robotId);
    }
    return structuredClone(descriptors);
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    this.assertConnected();
    const state = await this.request<RobotStateSnapshot>(`/api/v1/robots/${encodeURIComponent(robotId)}/state`);
    assertRobotState(state, robotId);
    return structuredClone(state);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    this.assertConnected();
    const receipt = await this.request<CommandReceipt>("/api/v1/missions", {
      method: "POST",
      body: JSON.stringify(command),
    });
    assertCommandReceipt(receipt, command);
    return structuredClone(receipt);
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.assertConnected();
    const receipt = await this.request<CommandReceipt>(
      `/api/v1/robots/${encodeURIComponent(robotId)}/missions/${encodeURIComponent(commandId)}/cancel`,
      { method: "POST", body: "{}" },
    );
    if (receipt.commandId !== commandId || receipt.robotId !== robotId) {
      throw new AdapterContractError("RECEIPT_CORRELATION_INVALID", "Cancellation receipt does not match its command and robot.");
    }
    assertCommandReceipt(receipt, receipt);
    return structuredClone(receipt);
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    this.handlers.add(handler);
    if (this.connected) this.schedulePoll(0);
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0 && this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private schedulePoll(delayMs: number): void {
    if (!this.connected || this.handlers.size === 0 || this.pollTimer) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollEvents();
    }, delayMs);
    this.pollTimer.unref?.();
  }

  private async pollEvents(): Promise<void> {
    if (!this.connected || this.handlers.size === 0) return;
    try {
      const batch = await this.request<AdapterEventBatch>(
        `/api/v1/events?after=${this.lastEventSequence}&limit=${this.eventBatchSize}`,
        undefined,
        true,
      );
      if (batch.latestSequence < this.lastEventSequence) {
        // The remote process restarted and its in-memory event journal began at
        // sequence one. Re-read retained events and let Fleet reconcile state.
        this.lastEventSequence = 0;
        this.schedulePoll(0);
        return;
      }
      assertEventBatch(batch, this.lastEventSequence);
      for (const item of batch.events) {
        if (item.sequence <= this.lastEventSequence) continue;
        assertAdapterEvent(item.event);
        for (const handler of [...this.handlers]) await handler(structuredClone(item.event));
        this.lastEventSequence = item.sequence;
      }
      this.consecutivePollFailures = 0;
      this.schedulePoll(batch.events.length === this.eventBatchSize ? 0 : this.eventPollIntervalMs);
    } catch (error) {
      if (!this.connected || isAbortError(error)) return;
      if (error instanceof HttpRobotAdapterError && error.status === 409) {
        this.lastEventSequence = 0;
      }
      this.consecutivePollFailures += 1;
      this.onBackgroundError(asError(error));
      this.schedulePoll(Math.min(
        this.eventPollIntervalMs * (2 ** Math.min(this.consecutivePollFailures - 1, 6)),
        5_000,
      ));
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, background = false): Promise<T> {
    const controller = new AbortController();
    if (background) this.activePollAbort = controller;
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref?.();
    try {
      const headers = new Headers(init.headers);
      headers.set("accept", "application/json");
      if (init.body) headers.set("content-type", "application/json");
      if (this.bearerToken) headers.set("authorization", `Bearer ${this.bearerToken}`);
      const response = await this.fetchImplementation(new URL(path, this.baseUrl), {
        ...init,
        headers,
        signal: controller.signal,
      });
      const payload = await parseResponseBody(response);
      if (!response.ok) {
        const detail = isRecord(payload) && typeof payload.message === "string" ? payload.message : response.statusText;
        throw new HttpRobotAdapterError(response.status, detail || `Remote adapter returned HTTP ${response.status}.`);
      }
      return payload as T;
    } finally {
      clearTimeout(timeout);
      if (background && this.activePollAbort === controller) this.activePollAbort = null;
    }
  }

  private assertConnected(): void {
    if (!this.connected) throw new Error(`Adapter ${this.adapterId} is not connected.`);
  }
}

export class HttpRobotAdapterError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpRobotAdapterError";
  }
}

function assertEndpointManifest(value: CanonicalHttpEndpointManifest): void {
  if (!isRecord(value)
    || value.protocol !== "BRASH_CANONICAL_HTTP"
    || value.protocolVersion !== CANONICAL_HTTP_ADAPTER_PROTOCOL_VERSION
    || typeof value.serviceId !== "string"
    || !Array.isArray(value.supportedFleetSchemaVersions)
    || !Array.isArray(value.capabilities)) {
    throw new AdapterContractError("REMOTE_MANIFEST_INVALID", "Remote endpoint returned an invalid canonical HTTP manifest.");
  }
}

function assertEventBatch(value: AdapterEventBatch, after: number): void {
  if (!isRecord(value)
    || !Number.isSafeInteger(value.oldestSequence)
    || !Number.isSafeInteger(value.latestSequence)
    || !Array.isArray(value.events)) {
    throw new AdapterContractError("REMOTE_EVENT_BATCH_INVALID", "Remote endpoint returned an invalid event batch.");
  }
  let sequence = after;
  for (const item of value.events) {
    if (!isRecord(item) || !Number.isSafeInteger(item.sequence) || item.sequence <= sequence || !("event" in item)) {
      throw new AdapterContractError("REMOTE_EVENT_SEQUENCE_INVALID", "Remote adapter events must be strictly increasing.");
    }
    sequence = item.sequence as number;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdapterContractError("REMOTE_RESPONSE_NOT_JSON", `Remote adapter returned non-JSON content with HTTP ${response.status}.`);
  }
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${name} must be a positive integer.`);
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
