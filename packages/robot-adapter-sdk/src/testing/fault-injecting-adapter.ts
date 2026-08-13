import type {
  CommandReceipt,
  MissionCommand,
  RobotAdapterEvent,
  RobotDescriptor,
  RobotStateSnapshot,
} from "@brash/contracts";
import type { AdapterManifest } from "../adapter/adapter-manifest.js";
import type { RobotAdapter, RobotAdapterEventHandler, Unsubscribe } from "../adapter/robot-adapter.js";

export interface AdapterFaultInjectionOptions {
  executeReceiptLosses?: number;
  cancellationReceiptLosses?: number;
  operationDelayMs?: number;
  dropEventTypes?: RobotAdapterEvent["type"][];
}

/**
 * A deterministic transport-fault wrapper for adapter certification and CI.
 * The delegated operation finishes before a receipt-loss error is raised,
 * matching the ambiguous outcome produced by a broken network link.
 */
export class FaultInjectingAdapter implements RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  private executeReceiptLosses: number;
  private cancellationReceiptLosses: number;
  private readonly operationDelayMs: number;
  private readonly dropEventTypes: ReadonlySet<RobotAdapterEvent["type"]>;

  constructor(private readonly delegate: RobotAdapter, options: AdapterFaultInjectionOptions = {}) {
    this.adapterId = delegate.adapterId;
    this.manifest = delegate.manifest;
    this.executeReceiptLosses = assertNonNegativeInteger(options.executeReceiptLosses ?? 0, "executeReceiptLosses");
    this.cancellationReceiptLosses = assertNonNegativeInteger(options.cancellationReceiptLosses ?? 0, "cancellationReceiptLosses");
    this.operationDelayMs = assertNonNegativeInteger(options.operationDelayMs ?? 0, "operationDelayMs");
    this.dropEventTypes = new Set(options.dropEventTypes ?? []);
  }

  async connect(): Promise<void> {
    await this.delay();
    await this.delegate.connect();
  }

  async disconnect(): Promise<void> {
    await this.delay();
    await this.delegate.disconnect();
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    await this.delay();
    return this.delegate.listRobots();
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    await this.delay();
    return this.delegate.getState(robotId);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    await this.delay();
    const receipt = await this.delegate.executeMission(command);
    if (this.executeReceiptLosses > 0) {
      this.executeReceiptLosses -= 1;
      throw new InjectedAdapterTransportError("EXECUTE_RECEIPT_LOST", command.commandId);
    }
    return receipt;
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    await this.delay();
    const receipt = await this.delegate.cancelMission(robotId, commandId);
    if (this.cancellationReceiptLosses > 0) {
      this.cancellationReceiptLosses -= 1;
      throw new InjectedAdapterTransportError("CANCELLATION_RECEIPT_LOST", commandId);
    }
    return receipt;
  }

  subscribe(handler: RobotAdapterEventHandler): Unsubscribe {
    return this.delegate.subscribe((event) => {
      if (!this.dropEventTypes.has(event.type)) return handler(event);
    });
  }

  private async delay(): Promise<void> {
    if (this.operationDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.operationDelayMs));
  }
}

export class InjectedAdapterTransportError extends Error {
  constructor(readonly code: "EXECUTE_RECEIPT_LOST" | "CANCELLATION_RECEIPT_LOST", readonly commandId: string) {
    super(`Injected transport failure ${code} for command ${commandId}.`);
    this.name = "InjectedAdapterTransportError";
  }
}

function assertNonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer.`);
  return value;
}
