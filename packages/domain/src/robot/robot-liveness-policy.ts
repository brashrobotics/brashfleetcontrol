import type { Robot, RobotConnection } from "./robot.js";

export interface RobotLivenessPolicyOptions {
  degradedAfterMs?: number;
  offlineAfterMs?: number;
}

export interface RobotLivenessEvaluation {
  connection: RobotConnection;
  ageMs: number;
  changed: boolean;
}

export class RobotLivenessPolicy {
  readonly degradedAfterMs: number;
  readonly offlineAfterMs: number;

  constructor(options: RobotLivenessPolicyOptions = {}) {
    this.degradedAfterMs = options.degradedAfterMs ?? 10_000;
    this.offlineAfterMs = options.offlineAfterMs ?? 30_000;
    if (this.degradedAfterMs <= 0 || this.offlineAfterMs <= this.degradedAfterMs) {
      throw new Error("Robot liveness thresholds must be positive and offline must follow degraded.");
    }
  }

  evaluate(robot: Robot, now: Date): RobotLivenessEvaluation {
    const ageMs = Math.max(0, now.getTime() - robot.lastSeenAt.getTime());
    const connection: RobotConnection = robot.connection === "OFFLINE"
      ? "OFFLINE"
      : ageMs >= this.offlineAfterMs
        ? "OFFLINE"
        : ageMs >= this.degradedAfterMs
          ? "DEGRADED"
          : "ONLINE";
    return { connection, ageMs, changed: connection !== robot.connection };
  }
}
