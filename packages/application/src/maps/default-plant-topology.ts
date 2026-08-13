import { MapTopology, type MapEdge, type MapNode } from "@brash/domain";

const nodes: MapNode[] = [
  { nodeId: "N-WAREHOUSE-A", label: "Warehouse A", kind: "STATION", stationId: "WAREHOUSE-A", zoneId: "warehouse", x: 10, y: 5 },
  { nodeId: "N-NORTH-WEST", label: "North-west junction", kind: "INTERSECTION", x: 40, y: 5 },
  { nodeId: "N-NORTH-EAST", label: "North-east junction", kind: "INTERSECTION", x: 70, y: 5 },
  { nodeId: "N-ASSEMBLY-02", label: "Assembly 2", kind: "STATION", stationId: "ASSEMBLY-02", zoneId: "production", x: 72, y: 24 },
  { nodeId: "N-CENTER", label: "Central crossing", kind: "INTERSECTION", x: 46, y: 24 },
  { nodeId: "N-PRESS-A", label: "Press A", kind: "STATION", stationId: "PRESS-A", zoneId: "production", x: 30, y: 23 },
  { nodeId: "N-SOUTH-CENTER", label: "South crossing", kind: "INTERSECTION", x: 50, y: 65 },
  { nodeId: "N-WAREHOUSE-B", label: "Warehouse B", kind: "STATION", stationId: "WAREHOUSE-B", zoneId: "warehouse", x: 24, y: 71 },
  { nodeId: "N-QUALITY", label: "Quality", kind: "STATION", stationId: "QUALITY", zoneId: "quality", x: 73, y: 74 },
  { nodeId: "N-CHARGER-C-02", label: "Charger C-02", kind: "STATION", stationId: "CHARGER-C-02", zoneId: "warehouse", x: 50, y: 84 },
];

function edge(
  edgeId: string,
  fromNodeId: string,
  toNodeId: string,
  lengthMeters: number,
  travelTimeSeconds = Math.max(2, Math.ceil(lengthMeters / 1.2)),
): MapEdge {
  return { edgeId, fromNodeId, toNodeId, directed: false, lengthMeters, travelTimeSeconds };
}

const edges: MapEdge[] = [
  edge("E-NORTH-01", "N-WAREHOUSE-A", "N-NORTH-WEST", 30),
  edge("E-NORTH-02", "N-NORTH-WEST", "N-NORTH-EAST", 30),
  edge("E-ASSEMBLY-IN", "N-NORTH-EAST", "N-ASSEMBLY-02", 19),
  edge("E-CENTER-EAST", "N-ASSEMBLY-02", "N-CENTER", 26),
  edge("E-CENTER-NORTH", "N-CENTER", "N-NORTH-WEST", 21),
  edge("E-PRESS-IN", "N-CENTER", "N-PRESS-A", 16),
  edge("E-CENTER-SOUTH", "N-CENTER", "N-SOUTH-CENTER", 41),
  edge("E-WAREHOUSE-B-IN", "N-SOUTH-CENTER", "N-WAREHOUSE-B", 27),
  edge("E-QUALITY-IN", "N-SOUTH-CENTER", "N-QUALITY", 25),
  edge("E-CHARGER-IN", "N-SOUTH-CENTER", "N-CHARGER-C-02", 19),
  edge("E-EAST-BYPASS", "N-ASSEMBLY-02", "N-QUALITY", 50),
];

export function createDefaultPlantTopology(): MapTopology {
  return MapTopology.create({
    mapId: "plant-a@1",
    displayName: "BRASH Demo Plant · Floor 01",
    revision: 1,
    nodes,
    edges,
  });
}
