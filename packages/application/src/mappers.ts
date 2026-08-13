import {
  FLEET_SCHEMA_VERSION,
  type MapTopologyView,
  type MissionView,
  type RobotView,
  type RobotOperatorControlView,
  type TrafficPlanView,
  type TrafficReservationView,
} from "@brash/contracts";
import type {
  MapTopology,
  Mission,
  Robot,
  TrafficPlanSnapshot,
  TrafficReservationSnapshot,
} from "@brash/domain";

export function missionToView(mission: Mission): MissionView {
  const snapshot = mission.snapshot();
  return {
    missionId: snapshot.missionId,
    type: "TRANSPORT",
    externalReference: snapshot.externalReference,
    preferredRobotId: snapshot.preferredRobotId,
    priority: snapshot.priority,
    requiredCapabilities: [...snapshot.requiredCapabilities],
    payloadKg: snapshot.payloadKg,
    pickup: { ...snapshot.pickup },
    dropoff: { ...snapshot.dropoff },
    robotConstraints: snapshot.robotConstraints ? structuredClone(snapshot.robotConstraints) : undefined,
    state: snapshot.state,
    assignedRobotId: snapshot.assignedRobotId,
    commandId: snapshot.commandId,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
    failureReason: snapshot.failureReason,
    recoveryPreviousState: snapshot.recoveryPreviousState,
    recoveryStartedAt: snapshot.recoveryStartedAt?.toISOString() ?? null,
  };
}

export function robotToView(robot: Robot, operatorControl: RobotOperatorControlView | null = null): RobotView {
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
      ...structuredClone(snapshot.capabilityMetadata),
    },
    state: {
      schemaVersion: FLEET_SCHEMA_VERSION,
      robotId: snapshot.robotId,
      sequence: snapshot.sequence,
      observedAt: snapshot.observedAt.toISOString(),
      lastSeenAt: snapshot.lastSeenAt.toISOString(),
      connectionChangedAt: snapshot.connectionChangedAt.toISOString(),
      connection: snapshot.connection,
      availability: snapshot.availability,
      batteryPercent: snapshot.batteryPercent,
      pose: { ...snapshot.pose },
      activeMissionId: snapshot.activeMissionId,
    },
    operatorControl: operatorControl ? structuredClone(operatorControl) : null,
  };
}

export function topologyToView(topology: MapTopology): MapTopologyView {
  const snapshot = topology.snapshot();
  return {
    mapId: snapshot.mapId,
    displayName: snapshot.displayName,
    revision: snapshot.revision,
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

export function trafficPlanToView(plan: TrafficPlanSnapshot): TrafficPlanView {
  return {
    routeId: plan.routeId,
    missionId: plan.missionId,
    robotId: plan.robotId,
    mapId: plan.mapId,
    status: plan.status,
    originNodeId: plan.originNodeId,
    pickupNodeId: plan.pickupNodeId,
    dropoffNodeId: plan.dropoffNodeId,
    requestedStartAt: plan.requestedStartAt.toISOString(),
    scheduledStartAt: plan.scheduledStartAt.toISOString(),
    expectedArrivalAt: plan.expectedArrivalAt.toISOString(),
    totalDistanceMeters: plan.totalDistanceMeters,
    totalWaitSeconds: plan.totalWaitSeconds,
    segments: plan.segments.map((segment) => ({
      ...segment,
      enterAt: segment.enterAt.toISOString(),
      exitAt: segment.exitAt.toISOString(),
    })),
    plannedAt: plan.plannedAt.toISOString(),
    lastRenewedAt: plan.lastRenewedAt.toISOString(),
    leaseExpiresAt: plan.leaseExpiresAt.toISOString(),
    releasedAt: plan.releasedAt?.toISOString() ?? null,
  };
}

export function trafficReservationToView(reservation: TrafficReservationSnapshot): TrafficReservationView {
  return {
    ...reservation,
    startsAt: reservation.startsAt.toISOString(),
    endsAt: reservation.endsAt.toISOString(),
    releasedAt: reservation.releasedAt?.toISOString() ?? null,
  };
}
