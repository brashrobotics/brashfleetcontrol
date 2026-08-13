import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  FLEET_SCHEMA_VERSION,
  type MissionCommand,
  type RobotAvailability,
  type RobotConnection,
  type RobotPose,
} from "@brash/contracts";
import {
  CANONICAL_HTTP_ADAPTER_PROTOCOL_VERSION,
  type CanonicalHttpEndpointManifest,
} from "@brash/http-robot-adapter";
import type { SimulatorRobotDefinition } from "@brash/simulator-adapter";
import { EmulatorEventCursorExpiredError, EmulatorEventJournal } from "./engine/event-journal.js";
import {
  RobotEmulatorEngine,
  type RobotEmulatorEngineOptions,
  type RobotEmulatorStatePatch,
} from "./engine/robot-emulator-engine.js";
import { createDefaultEmulatorRobots } from "./fixtures/default-robots.js";

const MAX_BODY_BYTES = 1_048_576;

export interface RobotEmulatorHttpServerOptions extends RobotEmulatorEngineOptions {
  host?: string;
  port?: number;
  bearerToken?: string;
  definitions?: SimulatorRobotDefinition[];
  eventJournalCapacity?: number;
}

export interface RunningRobotEmulator {
  readonly engine: RobotEmulatorEngine;
  readonly url: string;
  stop(): Promise<void>;
}

export async function startRobotEmulatorHttpServer(
  options: RobotEmulatorHttpServerOptions = {},
): Promise<RunningRobotEmulator> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4280;
  const journal = new EmulatorEventJournal(options.eventJournalCapacity ?? 10_000);
  const engine = new RobotEmulatorEngine(
    options.definitions ?? createDefaultEmulatorRobots(options.now?.() ?? new Date()),
    {
      now: options.now,
      startDelayMs: options.startDelayMs,
      missionDurationMs: options.missionDurationMs,
      motionUpdateIntervalMs: options.motionUpdateIntervalMs,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      batteryDrainPercentPerMeter: options.batteryDrainPercentPerMeter,
      onEvent: (event) => { journal.append(event); },
      onError: options.onError,
    },
  );
  let networkAvailable = true;

  await engine.start();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://robot-emulator.local");
      applyCommonHeaders(response);
      if (request.method === "OPTIONS") return sendEmpty(response, 204);
      if (!authorized(request, options.bearerToken)) return sendJson(response, 401, { code: "UNAUTHORIZED", message: "A valid emulator bearer token is required." });

      if (request.method === "GET" && url.pathname === "/control/v1/snapshot") {
        const descriptors = await engine.listRobots();
        const robots = await Promise.all(descriptors.map(async (descriptor) => ({ descriptor, state: await engine.getState(descriptor.robotId) })));
        return sendJson(response, 200, { networkAvailable, robots });
      }
      if (request.method === "POST" && url.pathname === "/control/v1/network") {
        const body = requireRecord(await readJson(request));
        if (typeof body.available !== "boolean") throw new HttpInputError(400, "available must be a boolean.");
        networkAvailable = body.available;
        return sendJson(response, 200, { networkAvailable });
      }

      const stateControlMatch = /^\/control\/v1\/robots\/([^/]+)\/state$/.exec(url.pathname);
      if (request.method === "POST" && stateControlMatch) {
        const robotId = decodePathSegment(stateControlMatch[1]);
        const patch = parseStatePatch(await readJson(request));
        return sendJson(response, 200, await engine.patchRobotState(robotId, patch));
      }

      const failControlMatch = /^\/control\/v1\/robots\/([^/]+)\/fail-active-mission$/.exec(url.pathname);
      if (request.method === "POST" && failControlMatch) {
        const robotId = decodePathSegment(failControlMatch[1]);
        const body = requireRecord(await readJson(request));
        const reason = requireNonEmptyString(body.reason, "reason");
        const commandId = engine.activeCommandId(robotId);
        await engine.failActiveMission(robotId, reason);
        return sendJson(response, 200, { robotId, commandId, failed: true });
      }

      if (request.method === "GET" && url.pathname === "/api/v1/health") {
        return sendJson(response, 200, { ok: true, service: "brash-robot-emulator", robotNetworkAvailable: networkAvailable });
      }
      if (!networkAvailable) return sendJson(response, 503, { code: "EMULATED_NETWORK_OUTAGE", message: "The robot network is unavailable by fault injection." });

      if (request.method === "GET" && url.pathname === "/api/v1/manifest") {
        const manifest: CanonicalHttpEndpointManifest = {
          protocol: "BRASH_CANONICAL_HTTP",
          protocolVersion: CANONICAL_HTTP_ADAPTER_PROTOCOL_VERSION,
          serviceId: "brash-robot-emulator",
          supportedFleetSchemaVersions: [FLEET_SCHEMA_VERSION],
          capabilities: ["ROBOT_DISCOVERY", "STATE_POLLING", "STATE_EVENTS", "MISSION_EXECUTION", "MISSION_CANCELLATION", "FAULT_INJECTION"],
        };
        return sendJson(response, 200, manifest);
      }
      if (request.method === "GET" && url.pathname === "/api/v1/robots") {
        return sendJson(response, 200, await engine.listRobots());
      }

      const stateMatch = /^\/api\/v1\/robots\/([^/]+)\/state$/.exec(url.pathname);
      if (request.method === "GET" && stateMatch) {
        return sendJson(response, 200, await engine.getState(decodePathSegment(stateMatch[1])));
      }

      if (request.method === "POST" && url.pathname === "/api/v1/missions") {
        const command = parseMissionCommand(await readJson(request));
        return sendJson(response, 202, await engine.executeMission(command));
      }

      const cancellationMatch = /^\/api\/v1\/robots\/([^/]+)\/missions\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && cancellationMatch) {
        return sendJson(
          response,
          200,
          await engine.cancelMission(decodePathSegment(cancellationMatch[1]), decodePathSegment(cancellationMatch[2])),
        );
      }

      if (request.method === "GET" && url.pathname === "/api/v1/events") {
        const after = queryInteger(url, "after", 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = queryInteger(url, "limit", 250, 1, 1_000);
        return sendJson(response, 200, journal.read(after, limit));
      }

      return sendJson(response, 404, { code: "NOT_FOUND", message: `${request.method ?? "UNKNOWN"} ${url.pathname} was not found.` });
    } catch (error) {
      if (error instanceof HttpInputError) return sendJson(response, error.status, { code: error.code, message: error.message });
      if (error instanceof EmulatorEventCursorExpiredError) {
        return sendJson(response, 409, {
          code: "EVENT_CURSOR_EXPIRED",
          message: error.message,
          oldestSequence: error.oldestSequence,
          latestSequence: error.latestSequence,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = /was not found|not found/i.test(message) ? 404 : 409;
      return sendJson(response, status, { code: "EMULATOR_OPERATION_FAILED", message });
    }
  });

  try {
    await listen(server, port, host);
  } catch (error) {
    await engine.stop();
    throw error;
  }
  const address = server.address() as AddressInfo;
  const displayHost = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
  return {
    engine,
    url: `http://${formatHost(displayHost)}:${address.port}`,
    async stop() {
      await close(server);
      await engine.stop();
    },
  };
}

function parseMissionCommand(value: unknown): MissionCommand {
  const body = requireRecord(value);
  for (const field of ["commandId", "missionId", "robotId", "issuedAt", "expiresAt", "mapId"] as const) {
    requireNonEmptyString(body[field], field);
  }
  if (body.schemaVersion !== FLEET_SCHEMA_VERSION) throw new HttpInputError(400, `schemaVersion must be ${FLEET_SCHEMA_VERSION}.`);
  if (!Array.isArray(body.steps)) throw new HttpInputError(400, "steps must be an array.");
  if (!Number.isFinite(Date.parse(body.issuedAt as string)) || !Number.isFinite(Date.parse(body.expiresAt as string))) {
    throw new HttpInputError(400, "issuedAt and expiresAt must be ISO-8601 timestamps.");
  }
  body.steps.forEach(parseMissionStep);
  return structuredClone(value) as MissionCommand;
}

function parseMissionStep(value: unknown, index: number): void {
  const step = requireRecord(value);
  if (step.type === "MOVE_TO") {
    const target = requireRecord(step.target);
    requireNonEmptyString(target.stationId, `steps[${index}].target.stationId`);
    requireNonEmptyString(target.mapId, `steps[${index}].target.mapId`);
    for (const key of ["x", "y"] as const) {
      if (typeof target[key] !== "number" || !Number.isFinite(target[key])) {
        throw new HttpInputError(400, `steps[${index}].target.${key} must be finite.`);
      }
    }
    if (target.zoneId !== undefined && (typeof target.zoneId !== "string" || !target.zoneId.trim())) {
      throw new HttpInputError(400, `steps[${index}].target.zoneId must be a non-empty string when provided.`);
    }
    return;
  }
  if (step.type === "LOAD") {
    requireNonEmptyString(step.stationId, `steps[${index}].stationId`);
    if (typeof step.payloadKg !== "number" || !Number.isFinite(step.payloadKg) || step.payloadKg < 0) {
      throw new HttpInputError(400, `steps[${index}].payloadKg must be non-negative.`);
    }
    return;
  }
  if (step.type === "UNLOAD") {
    requireNonEmptyString(step.stationId, `steps[${index}].stationId`);
    return;
  }
  throw new HttpInputError(400, `steps[${index}].type is invalid.`);
}

function parseStatePatch(value: unknown): RobotEmulatorStatePatch {
  const body = requireRecord(value);
  const allowed = new Set(["connection", "availability", "activeMissionId", "batteryPercent", "pose"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new HttpInputError(400, `Unsupported state patch field ${key}.`);
  const patch: RobotEmulatorStatePatch = {};
  if (body.connection !== undefined) {
    if (!isOneOf(body.connection, ["ONLINE", "DEGRADED", "OFFLINE"] as const)) throw new HttpInputError(400, "connection is invalid.");
    patch.connection = body.connection as RobotConnection;
  }
  if (body.availability !== undefined) {
    if (!isOneOf(body.availability, ["AVAILABLE", "RESERVED", "EXECUTING", "CHARGING", "ERROR", "MANUAL"] as const)) throw new HttpInputError(400, "availability is invalid.");
    patch.availability = body.availability as RobotAvailability;
  }
  if (body.activeMissionId !== undefined) {
    if (body.activeMissionId !== null && typeof body.activeMissionId !== "string") throw new HttpInputError(400, "activeMissionId must be a string or null.");
    patch.activeMissionId = body.activeMissionId as string | null;
  }
  if (body.batteryPercent !== undefined) {
    if (typeof body.batteryPercent !== "number" || !Number.isFinite(body.batteryPercent) || body.batteryPercent < 0 || body.batteryPercent > 100) {
      throw new HttpInputError(400, "batteryPercent must be between 0 and 100.");
    }
    patch.batteryPercent = body.batteryPercent;
  }
  if (body.pose !== undefined) patch.pose = parsePose(body.pose);
  if (Object.keys(patch).length === 0) throw new HttpInputError(400, "At least one state field is required.");
  return patch;
}

function parsePose(value: unknown): RobotPose {
  const pose = requireRecord(value);
  const mapId = requireNonEmptyString(pose.mapId, "pose.mapId");
  for (const key of ["x", "y", "yaw"] as const) {
    if (typeof pose[key] !== "number" || !Number.isFinite(pose[key])) throw new HttpInputError(400, `pose.${key} must be finite.`);
  }
  return { mapId, x: pose.x as number, y: pose.y as number, yaw: pose.yaw as number };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpInputError(413, "Request body exceeds 1 MiB.", "PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpInputError(400, "Request body must contain valid JSON.", "INVALID_JSON");
  }
}

function authorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function applyCommonHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendEmpty(response: ServerResponse, status: number): void {
  if (response.writableEnded) return;
  response.writeHead(status);
  response.end();
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpInputError(400, "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpInputError(400, `${field} must be a non-empty string.`);
  return value;
}

function queryInteger(url: URL, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new HttpInputError(400, `${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function decodePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded.trim() || decoded.includes("/")) throw new Error();
    return decoded;
  } catch {
    throw new HttpInputError(400, "Path identifier is invalid.");
  }
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
  });
}

class HttpInputError extends Error {
  constructor(readonly status: number, message: string, readonly code = "INVALID_REQUEST") {
    super(message);
    this.name = "HttpInputError";
  }
}
