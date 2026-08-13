import type {
  CommandReceipt,
  MissionCommand,
  RobotAdapterEvent,
  RobotDescriptor,
  RobotPose,
  RobotStateSnapshot,
} from "@brash/contracts";
import { SimulatorAdapter, type SimulatorRobotDefinition } from "@brash/simulator-adapter";

export interface RobotEmulatorEngineOptions {
  now?: () => Date;
  startDelayMs?: number;
  missionDurationMs?: number;
  motionUpdateIntervalMs?: number;
  heartbeatIntervalMs?: number;
  batteryDrainPercentPerMeter?: number;
  onEvent?: (event: RobotAdapterEvent) => void | Promise<void>;
  onError?: (error: Error) => void;
}

interface CommandRun {
  command: MissionCommand;
  startTimer: ReturnType<typeof setTimeout> | null;
  motionTimer: ReturnType<typeof setInterval> | null;
  startedAtMs: number | null;
  startPose: RobotPose | null;
  startBatteryPercent: number | null;
  advancing: boolean;
}

export type RobotEmulatorStatePatch = Partial<Pick<
  RobotStateSnapshot,
  "connection" | "availability" | "activeMissionId" | "batteryPercent" | "pose"
>>;

export class RobotEmulatorEngine {
  readonly adapter: SimulatorAdapter;

  private readonly now: () => Date;
  private readonly startDelayMs: number;
  private readonly missionDurationMs: number;
  private readonly motionUpdateIntervalMs: number;
  private readonly batteryDrainPercentPerMeter: number;
  private readonly onError: (error: Error) => void;
  private readonly runs = new Map<string, CommandRun>();
  private readonly robotCommands = new Map<string, string>();
  private readonly seenCommandIds = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private started = false;

  constructor(definitions: SimulatorRobotDefinition[], options: RobotEmulatorEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.startDelayMs = positiveInteger(options.startDelayMs, 500, "startDelayMs", true);
    this.missionDurationMs = positiveInteger(options.missionDurationMs, 8_000, "missionDurationMs");
    this.motionUpdateIntervalMs = positiveInteger(options.motionUpdateIntervalMs, 250, "motionUpdateIntervalMs");
    this.batteryDrainPercentPerMeter = nonNegative(options.batteryDrainPercentPerMeter, 0.015, "batteryDrainPercentPerMeter");
    this.onError = options.onError ?? (() => undefined);
    this.adapter = new SimulatorAdapter(definitions, {
      adapterId: "external-robot-emulator",
      displayName: "BRASH external robot emulator",
      now: this.now,
      autoAdvance: false,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 1_000,
    });
    if (options.onEvent) this.unsubscribe = this.adapter.subscribe(options.onEvent);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.adapter.connect();
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    for (const commandId of [...this.runs.keys()]) this.clearRun(commandId);
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.adapter.disconnect();
    this.started = false;
  }

  async listRobots(): Promise<RobotDescriptor[]> {
    return this.adapter.listRobots();
  }

  async getState(robotId: string): Promise<RobotStateSnapshot> {
    return this.adapter.getState(robotId);
  }

  async executeMission(command: MissionCommand): Promise<CommandReceipt> {
    const seen = this.seenCommandIds.has(command.commandId);
    const receipt = await this.adapter.executeMission(command);
    this.seenCommandIds.add(command.commandId);
    if (receipt.status === "ACCEPTED" && !seen) {
      const run: CommandRun = {
        command: structuredClone(command),
        startTimer: null,
        motionTimer: null,
        startedAtMs: null,
        startPose: null,
        startBatteryPercent: null,
        advancing: false,
      };
      this.runs.set(command.commandId, run);
      this.robotCommands.set(command.robotId, command.commandId);
      run.startTimer = setTimeout(() => void this.startRun(command.commandId), this.startDelayMs);
    }
    return receipt;
  }

  async cancelMission(robotId: string, commandId: string): Promise<CommandReceipt> {
    this.clearRun(commandId);
    if (this.robotCommands.get(robotId) === commandId) this.robotCommands.delete(robotId);
    return this.adapter.cancelMission(robotId, commandId);
  }

  async patchRobotState(robotId: string, patch: RobotEmulatorStatePatch): Promise<RobotStateSnapshot> {
    if ((patch.connection && patch.connection !== "ONLINE")
      || (patch.availability && ["ERROR", "MANUAL"].includes(patch.availability))) {
      const commandId = this.robotCommands.get(robotId);
      if (commandId) this.clearRun(commandId);
    }
    await this.adapter.publishRobotState(robotId, patch);
    return this.adapter.getState(robotId);
  }

  async failActiveMission(robotId: string, reason: string): Promise<void> {
    const commandId = this.robotCommands.get(robotId);
    if (!commandId) throw new Error(`Robot ${robotId} has no active emulator command.`);
    this.clearRun(commandId);
    this.robotCommands.delete(robotId);
    await this.adapter.failMission(commandId, reason);
  }

  activeCommandId(robotId: string): string | null {
    return this.robotCommands.get(robotId) ?? null;
  }

  private async startRun(commandId: string): Promise<void> {
    const run = this.runs.get(commandId);
    if (!run) return;
    run.startTimer = null;
    try {
      const state = await this.adapter.getState(run.command.robotId);
      if (state.connection !== "ONLINE") return;
      await this.adapter.startMission(commandId);
      run.startedAtMs = this.now().getTime();
      run.startPose = structuredClone(state.pose);
      run.startBatteryPercent = state.batteryPercent;
      run.motionTimer = setInterval(() => void this.advanceRun(commandId), this.motionUpdateIntervalMs);
      await this.advanceRun(commandId);
    } catch (error) {
      this.onError(asError(error));
    }
  }

  private async advanceRun(commandId: string): Promise<void> {
    const run = this.runs.get(commandId);
    if (!run || run.advancing || run.startedAtMs === null || !run.startPose || run.startBatteryPercent === null) return;
    run.advancing = true;
    try {
      const progress = Math.min(1, Math.max(0, (this.now().getTime() - run.startedAtMs) / this.missionDurationMs));
      const route = [run.startPose, ...run.command.steps
        .filter((step): step is Extract<(typeof run.command.steps)[number], { type: "MOVE_TO" }> => step.type === "MOVE_TO")
        .map((step) => ({ mapId: step.target.mapId, x: step.target.x, y: step.target.y, yaw: 0 }))];
      const pose = interpolateRoute(route, progress);
      const travelledMeters = routeLength(route) * progress;
      const batteryPercent = Math.max(0, run.startBatteryPercent - travelledMeters * this.batteryDrainPercentPerMeter);
      await this.adapter.publishRobotState(run.command.robotId, { pose, batteryPercent });
      if (progress >= 1) {
        this.clearRun(commandId);
        this.robotCommands.delete(run.command.robotId);
        await this.adapter.completeMission(commandId);
      }
    } catch (error) {
      this.onError(asError(error));
    } finally {
      run.advancing = false;
    }
  }

  private clearRun(commandId: string): void {
    const run = this.runs.get(commandId);
    if (!run) return;
    if (run.startTimer) clearTimeout(run.startTimer);
    if (run.motionTimer) clearInterval(run.motionTimer);
    this.runs.delete(commandId);
  }
}

function interpolateRoute(points: RobotPose[], progress: number): RobotPose {
  if (points.length === 0) throw new Error("Emulator route requires an origin.");
  if (points.length === 1) return structuredClone(points[0]);
  const total = routeLength(points);
  if (total === 0) return structuredClone(points.at(-1)!);
  let remaining = total * progress;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    if (remaining <= length || index === points.length - 1) {
      const ratio = length === 0 ? 1 : Math.min(1, remaining / length);
      const x = start.x + (end.x - start.x) * ratio;
      const y = start.y + (end.y - start.y) * ratio;
      return {
        mapId: end.mapId,
        x,
        y,
        yaw: length === 0 ? start.yaw : Math.atan2(end.y - start.y, end.x - start.x),
      };
    }
    remaining -= length;
  }
  return structuredClone(points.at(-1)!);
}

function routeLength(points: RobotPose[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}

function distance(first: RobotPose, second: RobotPose): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function positiveInteger(value: number | undefined, fallback: number, name: string, allowZero = false): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (allowZero ? resolved < 0 : resolved <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return resolved;
}

function nonNegative(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${name} must be a non-negative number.`);
  return resolved;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
