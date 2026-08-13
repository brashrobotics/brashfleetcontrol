import type { MapTopology, RouteTraversal } from "../map/map-topology.js";
import { DomainError } from "../shared/domain-error.js";

export type RoutePhase = "TO_PICKUP" | "TO_DROPOFF";
export type TrafficPlanStatus = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficReservationState = "ACTIVE" | "SAFETY_HOLD" | "RELEASED";
export type TrafficResourceType = "EDGE" | "NODE" | "INFRASTRUCTURE";

export interface InfrastructureTrafficBinding {
  resourceId: string;
  edgeId: string | null;
  nodeId: string | null;
}

export interface TrafficRouteSegment {
  sequence: number;
  phase: RoutePhase;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  enterAt: Date;
  exitAt: Date;
}

export interface TrafficReservationSnapshot {
  reservationId: string;
  routeId: string;
  missionId: string;
  robotId: string;
  mapId: string;
  resourceId: string;
  resourceType: TrafficResourceType;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  state: TrafficReservationState;
  releasedAt: Date | null;
}

export interface TrafficPlanSnapshot {
  routeId: string;
  missionId: string;
  robotId: string;
  mapId: string;
  status: TrafficPlanStatus;
  originNodeId: string;
  pickupNodeId: string;
  dropoffNodeId: string;
  requestedStartAt: Date;
  scheduledStartAt: Date;
  expectedArrivalAt: Date;
  totalDistanceMeters: number;
  totalWaitSeconds: number;
  segments: TrafficRouteSegment[];
  reservations: TrafficReservationSnapshot[];
  plannedAt: Date;
  lastRenewedAt: Date;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
}

export interface ScheduleTrafficInput {
  routeId: string;
  missionId: string;
  robotId: string;
  topology: MapTopology;
  origin: { x: number; y: number };
  pickup: { stationId?: string; x: number; y: number };
  dropoff: { stationId?: string; x: number; y: number };
  requestedStartAt: Date;
  plannedAt: Date;
  existingReservations: TrafficReservationSnapshot[];
  excludedResourceIds?: string[];
  infrastructureBindings?: InfrastructureTrafficBinding[];
}

export interface TrafficSchedulerOptions {
  clearanceMs?: number;
  nodeHoldMs?: number;
  maximumDelayMs?: number;
  reservationLeaseMs?: number;
}

interface PhasedTraversal extends RouteTraversal {
  phase: RoutePhase;
}

interface ReservationWindow {
  resourceId: string;
  resourceType: TrafficResourceType;
  startsAt: Date;
  endsAt: Date;
}

export class TrafficScheduler {
  private readonly clearanceMs: number;
  private readonly nodeHoldMs: number;
  private readonly maximumDelayMs: number;
  private readonly reservationLeaseMs: number;

  constructor(options: TrafficSchedulerOptions = {}) {
    this.clearanceMs = options.clearanceMs ?? 1_000;
    this.nodeHoldMs = options.nodeHoldMs ?? 1_000;
    this.maximumDelayMs = options.maximumDelayMs ?? 30 * 60_000;
    this.reservationLeaseMs = options.reservationLeaseMs ?? 45_000;
  }

  schedule(input: ScheduleTrafficInput): TrafficPlanSnapshot {
    if (!input.routeId.trim()) throw new DomainError("TRAFFIC_ROUTE_ID_REQUIRED", "Traffic route ID is required.");
    if (input.topology.mapId.trim() === "") throw new DomainError("MAP_ID_REQUIRED", "Map ID is required.");

    const originNode = input.topology.nearestNode(input.origin);
    const pickupNode = input.topology.nodeForLocation(input.pickup);
    const dropoffNode = input.topology.nodeForLocation(input.dropoff);
    const excludedEdges = new Set((input.excludedResourceIds ?? []).filter((id) => id.startsWith("edge:")).map((id) => id.slice(5)));
    const excludedNodes = new Set((input.excludedResourceIds ?? []).filter((id) => id.startsWith("node:")).map((id) => id.slice(5)));
    if (excludedNodes.has(originNode.nodeId) || excludedNodes.has(pickupNode.nodeId) || excludedNodes.has(dropoffNode.nodeId)) {
      throw new DomainError("TRAFFIC_REQUIRED_NODE_CLOSED", "A required origin, pickup, or drop-off node is closed.");
    }
    const pathConstraints = { excludedEdgeIds: excludedEdges, excludedNodeIds: excludedNodes };
    const traversals: PhasedTraversal[] = [
      ...input.topology.shortestPath(originNode.nodeId, pickupNode.nodeId, pathConstraints).map((step) => ({ ...step, phase: "TO_PICKUP" as const })),
      ...input.topology.shortestPath(pickupNode.nodeId, dropoffNode.nodeId, pathConstraints).map((step) => ({ ...step, phase: "TO_DROPOFF" as const })),
    ];

    let scheduledStartAt = new Date(input.requestedStartAt);
    const horizon = input.requestedStartAt.getTime() + this.maximumDelayMs;
    let segments: TrafficRouteSegment[] = [];
    let windows: ReservationWindow[] = [];

    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      segments = this.buildSegments(traversals, scheduledStartAt);
      windows = this.buildReservationWindows(segments, input.infrastructureBindings ?? []);
      const requiredShift = this.requiredGlobalShift(windows, input.existingReservations);
      if (requiredShift === 0) break;
      scheduledStartAt = new Date(scheduledStartAt.getTime() + requiredShift);
      if (scheduledStartAt.getTime() > horizon) {
        throw new DomainError(
          "TRAFFIC_SCHEDULE_HORIZON_EXCEEDED",
          `No conflict-free route slot was found within ${this.maximumDelayMs / 60_000} minutes.`,
        );
      }
    }

    const expectedArrivalAt = segments.at(-1)?.exitAt ?? scheduledStartAt;
    const reservations = windows.map((window, index): TrafficReservationSnapshot => ({
      reservationId: `${input.routeId}:reservation:${String(index + 1).padStart(3, "0")}`,
      routeId: input.routeId,
      missionId: input.missionId,
      robotId: input.robotId,
      mapId: input.topology.mapId,
      resourceId: window.resourceId,
      resourceType: window.resourceType,
      sequence: index + 1,
      startsAt: new Date(window.startsAt),
      endsAt: new Date(window.endsAt),
      state: "ACTIVE",
      releasedAt: null,
    }));

    return {
      routeId: input.routeId,
      missionId: input.missionId,
      robotId: input.robotId,
      mapId: input.topology.mapId,
      status: "ACTIVE",
      originNodeId: originNode.nodeId,
      pickupNodeId: pickupNode.nodeId,
      dropoffNodeId: dropoffNode.nodeId,
      requestedStartAt: new Date(input.requestedStartAt),
      scheduledStartAt,
      expectedArrivalAt: new Date(expectedArrivalAt),
      totalDistanceMeters: Number(traversals.reduce((total, traversal) => total + traversal.lengthMeters, 0).toFixed(3)),
      totalWaitSeconds: Number(((scheduledStartAt.getTime() - input.requestedStartAt.getTime()) / 1_000).toFixed(3)),
      segments: segments.map((segment) => ({ ...segment, enterAt: new Date(segment.enterAt), exitAt: new Date(segment.exitAt) })),
      reservations,
      plannedAt: new Date(input.plannedAt),
      lastRenewedAt: new Date(input.plannedAt),
      leaseExpiresAt: new Date(input.plannedAt.getTime() + this.reservationLeaseMs),
      releasedAt: null,
    };
  }

  private buildSegments(traversals: PhasedTraversal[], scheduledStartAt: Date): TrafficRouteSegment[] {
    let cursor = scheduledStartAt.getTime();
    return traversals.map((traversal, index) => {
      const enterAt = new Date(cursor);
      cursor += Math.ceil(traversal.travelTimeSeconds * 1_000);
      return {
        sequence: index + 1,
        phase: traversal.phase,
        edgeId: traversal.edgeId,
        fromNodeId: traversal.fromNodeId,
        toNodeId: traversal.toNodeId,
        lengthMeters: traversal.lengthMeters,
        enterAt,
        exitAt: new Date(cursor),
      };
    });
  }

  private buildReservationWindows(segments: TrafficRouteSegment[], infrastructureBindings: InfrastructureTrafficBinding[]): ReservationWindow[] {
    const raw: ReservationWindow[] = [];
    for (const segment of segments) {
      raw.push({
        resourceId: `edge:${segment.edgeId}`,
        resourceType: "EDGE",
        startsAt: new Date(segment.enterAt),
        endsAt: new Date(segment.exitAt.getTime() + this.clearanceMs),
      });
      raw.push({
        resourceId: `node:${segment.fromNodeId}`,
        resourceType: "NODE",
        startsAt: new Date(segment.enterAt.getTime() - this.clearanceMs),
        endsAt: new Date(segment.enterAt.getTime() + this.nodeHoldMs),
      });
      raw.push({
        resourceId: `node:${segment.toNodeId}`,
        resourceType: "NODE",
        startsAt: new Date(segment.exitAt.getTime() - this.clearanceMs),
        endsAt: new Date(segment.exitAt.getTime() + this.nodeHoldMs),
      });
      for (const binding of infrastructureBindings) {
        if (binding.edgeId === segment.edgeId) {
          raw.push({
            resourceId: `infrastructure:${binding.resourceId}`,
            resourceType: "INFRASTRUCTURE",
            startsAt: new Date(segment.enterAt.getTime() - this.clearanceMs),
            endsAt: new Date(segment.exitAt.getTime() + this.clearanceMs),
          });
        }
        if (binding.nodeId === segment.fromNodeId) {
          raw.push({
            resourceId: `infrastructure:${binding.resourceId}`,
            resourceType: "INFRASTRUCTURE",
            startsAt: new Date(segment.enterAt.getTime() - this.clearanceMs),
            endsAt: new Date(segment.enterAt.getTime() + this.nodeHoldMs),
          });
        }
        if (binding.nodeId === segment.toNodeId) {
          raw.push({
            resourceId: `infrastructure:${binding.resourceId}`,
            resourceType: "INFRASTRUCTURE",
            startsAt: new Date(segment.exitAt.getTime() - this.clearanceMs),
            endsAt: new Date(segment.exitAt.getTime() + this.nodeHoldMs),
          });
        }
      }
    }
    return mergeWindows(raw);
  }

  private requiredGlobalShift(
    windows: ReservationWindow[],
    existingReservations: TrafficReservationSnapshot[],
  ): number {
    let requiredShift = 0;
    for (const window of windows) {
      for (const existing of existingReservations) {
        if ((existing.state !== "ACTIVE" && existing.state !== "SAFETY_HOLD") || existing.resourceId !== window.resourceId) continue;
        if (!overlaps(window.startsAt, window.endsAt, existing.startsAt, existing.endsAt)) continue;
        requiredShift = Math.max(requiredShift, existing.endsAt.getTime() - window.startsAt.getTime());
      }
    }
    return Math.max(0, requiredShift);
  }
}

function mergeWindows(windows: ReservationWindow[]): ReservationWindow[] {
  const sorted = [...windows].sort((left, right) =>
    left.resourceId.localeCompare(right.resourceId)
    || left.startsAt.getTime() - right.startsAt.getTime()
    || left.endsAt.getTime() - right.endsAt.getTime(),
  );
  const merged: ReservationWindow[] = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (previous && previous.resourceId === window.resourceId && window.startsAt.getTime() <= previous.endsAt.getTime()) {
      if (window.endsAt.getTime() > previous.endsAt.getTime()) previous.endsAt = new Date(window.endsAt);
      continue;
    }
    merged.push({ ...window, startsAt: new Date(window.startsAt), endsAt: new Date(window.endsAt) });
  }
  return merged;
}

function overlaps(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart.getTime() < rightEnd.getTime() && rightStart.getTime() < leftEnd.getTime();
}
