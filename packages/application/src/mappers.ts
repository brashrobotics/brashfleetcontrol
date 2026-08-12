import {
  FLEET_SCHEMA_VERSION,
  type MissionView,
  type RobotView,
} from "@brash/contracts";
import type { Mission, Robot } from "@brash/domain";

export function missionToView(mission: Mission): MissionView {
  const snapshot = mission.snapshot();
  return {
    missionId: snapshot.missionId,
    type: "TRANSPORT",
    externalReference: snapshot.externalReference,
    priority: snapshot.priority,
    requiredCapabilities: [...snapshot.requiredCapabilities],
    payloadKg: snapshot.payloadKg,
    pickup: { ...snapshot.pickup },
    dropoff: { ...snapshot.dropoff },
    state: snapshot.state,
    assignedRobotId: snapshot.assignedRobotId,
    commandId: snapshot.commandId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    failureReason: snapshot.failureReason,
  };
}

export function robotToView(robot: Robot): RobotView {
  const snapshot = robot.snapshot();
  return {
    robotId: snapshot.robotId,
    displayName: snapshot.displayName,
    vendor: snapshot.vendor,
    model: snapshot.model,
    capabilities: {
      actions: [...snapshot.capabilities],
      maxPayloadKg: snapshot.maxPayloadKg,
      allowedZones: [...snapshot.allowedZones],
    },
    state: {
      schemaVersion: FLEET_SCHEMA_VERSION,
      robotId: snapshot.robotId,
      sequence: snapshot.sequence,
      observedAt: snapshot.observedAt.toISOString(),
      connection: snapshot.connection,
      availability: snapshot.availability,
      batteryPercent: snapshot.batteryPercent,
      pose: { ...snapshot.pose },
      activeMissionId: snapshot.activeMissionId,
    },
  };
}

