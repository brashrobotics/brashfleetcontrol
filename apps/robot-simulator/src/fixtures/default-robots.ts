import { FLEET_SCHEMA_VERSION, type RobotDescriptor, type RobotStateSnapshot } from "@brash/contracts";
import type { SimulatorRobotDefinition } from "@brash/simulator-adapter";

export function createDefaultEmulatorRobots(now = new Date()): SimulatorRobotDefinition[] {
  return [
    robot({ robotId: "EMU-01", displayName: "Emulator Atlas", actions: ["pallet_transport", "box_transport"], maxPayloadKg: 800, batteryPercent: 82, x: 5, y: 5, now }),
    robot({ robotId: "EMU-02", displayName: "Emulator Nova", actions: ["box_transport"], maxPayloadKg: 150, batteryPercent: 94, x: 40, y: 5, now }),
    robot({ robotId: "EMU-03", displayName: "Emulator Kite", actions: ["pallet_transport"], maxPayloadKg: 600, batteryPercent: 61, x: 70, y: 65, now }),
  ];
}

function robot(input: {
  robotId: string;
  displayName: string;
  actions: string[];
  maxPayloadKg: number;
  batteryPercent: number;
  x: number;
  y: number;
  now: Date;
}): SimulatorRobotDefinition {
  const descriptor: RobotDescriptor = {
    robotId: input.robotId,
    displayName: input.displayName,
    vendor: "BRASH",
    model: "HTTP-EMU-AMR",
    capabilities: {
      actions: input.actions,
      maxPayloadKg: input.maxPayloadKg,
      allowedZones: ["warehouse", "production", "quality"],
      dimensionsMeters: { length: 1.1, width: 0.75, height: 0.45, turningRadius: 0.55 },
      supportedFloorTypes: ["industrial-concrete"],
      supportsCancellation: true,
      adapterProtocolVersion: "brash-canonical-http/1.0",
    },
  };
  const observedAt = input.now.toISOString();
  const state: RobotStateSnapshot = {
    schemaVersion: FLEET_SCHEMA_VERSION,
    robotId: input.robotId,
    sequence: 1,
    observedAt,
    lastSeenAt: observedAt,
    connectionChangedAt: observedAt,
    connection: "ONLINE",
    availability: "AVAILABLE",
    batteryPercent: input.batteryPercent,
    pose: { mapId: "plant-a@1", x: input.x, y: input.y, yaw: 0 },
    activeMissionId: null,
  };
  return { descriptor, state };
}
