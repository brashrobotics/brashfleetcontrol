import type { CreateWorkOrderRequest, OrchestratorCandidateView, RobotView } from "@brash/contracts";

export interface WorkOrderAllocationDecision {
  selectedRobotId: string | null;
  selectedScore: number | null;
  reasons: string[];
  candidates: OrchestratorCandidateView[];
}

export interface WorkOrderAllocationPolicyOptions {
  minimumBatteryPercent?: number;
  distanceWeight?: number;
  batteryPenaltyWeight?: number;
  capabilitySurplusPenalty?: number;
}

export class WorkOrderAllocationPolicy {
  private readonly minimumBatteryPercent: number;
  private readonly distanceWeight: number;
  private readonly batteryPenaltyWeight: number;
  private readonly capabilitySurplusPenalty: number;

  constructor(options: WorkOrderAllocationPolicyOptions = {}) {
    this.minimumBatteryPercent = options.minimumBatteryPercent ?? 20;
    this.distanceWeight = options.distanceWeight ?? 1;
    this.batteryPenaltyWeight = options.batteryPenaltyWeight ?? 0.15;
    this.capabilitySurplusPenalty = options.capabilitySurplusPenalty ?? 0.25;
  }

  select(request: CreateWorkOrderRequest, robots: RobotView[]): WorkOrderAllocationDecision {
    const candidates = robots.map((robot) => this.evaluate(request, robot)).sort((left, right) => {
      if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
      if (left.score !== null && right.score !== null && left.score !== right.score) return left.score - right.score;
      return left.robotId.localeCompare(right.robotId);
    });
    const selected = candidates.find((candidate) => candidate.eligible) ?? null;
    return {
      selectedRobotId: selected?.robotId ?? null,
      selectedScore: selected?.score ?? null,
      reasons: selected ? [...selected.reasons] : ["No robot currently satisfies every work-order constraint."],
      candidates,
    };
  }

  private evaluate(request: CreateWorkOrderRequest, robot: RobotView): OrchestratorCandidateView {
    const reasons: string[] = [];
    if (robot.state.connection !== "ONLINE") reasons.push(`Connection is ${robot.state.connection}.`);
    if (robot.state.availability !== "AVAILABLE") reasons.push(`Availability is ${robot.state.availability}.`);
    if (robot.state.pose.mapId !== request.pickup.mapId) reasons.push("Robot uses a different published map revision.");
    if (robot.capabilities.maxPayloadKg < request.payloadKg) reasons.push(`Payload limit ${robot.capabilities.maxPayloadKg} kg is below ${request.payloadKg} kg.`);
    for (const capability of request.requiredCapabilities) {
      if (!robot.capabilities.actions.includes(capability)) reasons.push(`Missing capability: ${capability}.`);
    }
    if (robot.state.batteryPercent < this.minimumBatteryPercent) reasons.push(`Battery ${robot.state.batteryPercent}% is below ${this.minimumBatteryPercent}%.`);
    for (const zoneId of [request.pickup.zoneId, request.dropoff.zoneId].filter((value): value is string => Boolean(value))) {
      if (robot.capabilities.allowedZones.length && !robot.capabilities.allowedZones.includes(zoneId)) reasons.push(`Robot is not permitted in zone ${zoneId}.`);
    }
    if (reasons.length) return { robotId: robot.robotId, eligible: false, score: null, reasons };

    const distance = Math.hypot(request.pickup.x - robot.state.pose.x, request.pickup.y - robot.state.pose.y);
    const batteryPenalty = (100 - robot.state.batteryPercent) * this.batteryPenaltyWeight;
    const capabilitySurplus = robot.capabilities.actions.filter((capability) => !request.requiredCapabilities.includes(capability)).length;
    const score = Number((distance * this.distanceWeight + batteryPenalty + capabilitySurplus * this.capabilitySurplusPenalty).toFixed(3));
    return {
      robotId: robot.robotId,
      eligible: true,
      score,
      reasons: [
        `Supports ${request.requiredCapabilities.join(", ")}.`,
        `Pickup distance is ${distance.toFixed(2)} map units.`,
        `Battery is ${robot.state.batteryPercent}%.`,
        `Capability surplus is ${capabilitySurplus}.`,
      ],
    };
  }
}
