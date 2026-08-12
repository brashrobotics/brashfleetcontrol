import type {
  AssignmentDecision,
  CandidateEvaluation,
} from "@brash/contracts";
import type { Mission, Robot } from "@brash/domain";

export interface WeightedDispatchPolicyOptions {
  minimumBatteryPercent?: number;
  distanceWeight?: number;
  batteryPenaltyWeight?: number;
}

export class WeightedDispatchPolicy {
  private readonly minimumBatteryPercent: number;
  private readonly distanceWeight: number;
  private readonly batteryPenaltyWeight: number;

  constructor(options: WeightedDispatchPolicyOptions = {}) {
    this.minimumBatteryPercent = options.minimumBatteryPercent ?? 20;
    this.distanceWeight = options.distanceWeight ?? 1;
    this.batteryPenaltyWeight = options.batteryPenaltyWeight ?? 0.1;
  }

  select(mission: Mission, robots: Robot[]): AssignmentDecision {
    const candidates = robots
      .map((robot) => this.evaluate(mission, robot))
      .sort((left, right) => {
        if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
        if (left.score !== null && right.score !== null && left.score !== right.score) {
          return left.score - right.score;
        }
        return left.robotId.localeCompare(right.robotId);
      });

    const selected = candidates.find((candidate) => candidate.eligible) ?? null;
    return {
      missionId: mission.missionId,
      selectedRobotId: selected?.robotId ?? null,
      selectedScore: selected?.score ?? null,
      reasons: selected
        ? [...selected.reasons]
        : ["No robot satisfies all mandatory mission constraints."],
      candidates,
    };
  }

  private evaluate(mission: Mission, robot: Robot): CandidateEvaluation {
    const rejectionReasons: string[] = [];
    if (robot.connection !== "ONLINE") rejectionReasons.push("Robot is offline.");
    if (robot.availability !== "AVAILABLE") rejectionReasons.push(`Robot is ${robot.availability}.`);
    if (robot.pose.mapId !== mission.pickup.mapId) rejectionReasons.push("Robot uses a different map version.");
    if (robot.maxPayloadKg < mission.payloadKg) {
      rejectionReasons.push(`Payload capacity ${robot.maxPayloadKg} kg is below the required ${mission.payloadKg} kg.`);
    }
    for (const capability of mission.requiredCapabilities) {
      if (!robot.capabilities.includes(capability)) rejectionReasons.push(`Missing capability: ${capability}.`);
    }
    if (robot.batteryPercent < this.minimumBatteryPercent) {
      rejectionReasons.push(`Battery ${robot.batteryPercent}% is below the ${this.minimumBatteryPercent}% dispatch threshold.`);
    }
    if (
      mission.pickup.zoneId
      && robot.allowedZones.length > 0
      && !robot.allowedZones.includes(mission.pickup.zoneId)
    ) {
      rejectionReasons.push(`Robot is not allowed in pickup zone ${mission.pickup.zoneId}.`);
    }

    if (rejectionReasons.length > 0) {
      return { robotId: robot.robotId, eligible: false, score: null, reasons: rejectionReasons };
    }

    const distance = Math.hypot(
      mission.pickup.x - robot.pose.x,
      mission.pickup.y - robot.pose.y,
    );
    const batteryPenalty = (100 - robot.batteryPercent) * this.batteryPenaltyWeight;
    const score = Number((distance * this.distanceWeight + batteryPenalty).toFixed(3));

    return {
      robotId: robot.robotId,
      eligible: true,
      score,
      reasons: [
        `Supports ${mission.requiredCapabilities.join(", ")}.`,
        `Payload capacity ${robot.maxPayloadKg} kg satisfies ${mission.payloadKg} kg.`,
        `Pickup distance is ${distance.toFixed(2)} map units.`,
        `Battery is ${robot.batteryPercent}%.`,
      ],
    };
  }
}

