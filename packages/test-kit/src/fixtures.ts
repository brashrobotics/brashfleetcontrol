import {
  FLEET_SCHEMA_VERSION,
  type CreateMissionRequest,
  type RobotDescriptor,
  type RobotStateSnapshot,
} from "@brash/contracts";
import type { SimulatorRobotDefinition } from "@brash/simulator-adapter";

export interface RobotFixtureOptions {
  robotId: string;
  displayName?: string;
  capabilities?: string[];
  maxPayloadKg?: number;
  allowedZones?: string[];
  batteryPercent?: number;
  x?: number;
  y?: number;
  mapId?: string;
  availability?: RobotStateSnapshot["availability"];
  connection?: RobotStateSnapshot["connection"];
}

export function robotFixture(options: RobotFixtureOptions): SimulatorRobotDefinition {
  const mapId = options.mapId ?? "plant-a@1";
  const descriptor: RobotDescriptor = {
    robotId: options.robotId,
    displayName: options.displayName ?? options.robotId,
    vendor: "BRASH",
    model: "SIM-AMR",
    capabilities: {
      actions: options.capabilities ?? ["pallet_transport"],
      maxPayloadKg: options.maxPayloadKg ?? 500,
      allowedZones: options.allowedZones ?? ["warehouse", "production"],
    },
  };
  const observedAt = "2026-08-12T10:00:00.000Z";
  const state: RobotStateSnapshot = {
    schemaVersion: FLEET_SCHEMA_VERSION,
    robotId: options.robotId,
    sequence: 1,
    observedAt,
    lastSeenAt: observedAt,
    connectionChangedAt: observedAt,
    connection: options.connection ?? "ONLINE",
    availability: options.availability ?? "AVAILABLE",
    batteryPercent: options.batteryPercent ?? 80,
    pose: {
      mapId,
      x: options.x ?? 0,
      y: options.y ?? 0,
      yaw: 0,
    },
    activeMissionId: null,
  };
  return { descriptor, state };
}

export function transportMissionFixture(
  overrides: Partial<CreateMissionRequest> = {},
): CreateMissionRequest {
  return {
    type: "TRANSPORT",
    externalReference: "WMS-ORDER-1001",
    priority: 70,
    requiredCapabilities: ["pallet_transport"],
    payloadKg: 300,
    pickup: {
      stationId: "WAREHOUSE-A",
      mapId: "plant-a@1",
      x: 10,
      y: 5,
      zoneId: "warehouse",
    },
    dropoff: {
      stationId: "ASSEMBLY-02",
      mapId: "plant-a@1",
      x: 70,
      y: 25,
      zoneId: "production",
    },
    autoDispatch: true,
    ...overrides,
  };
}
