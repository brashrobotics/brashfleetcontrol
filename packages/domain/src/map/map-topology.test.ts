import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../shared/domain-error.js";
import { MapTopology } from "./map-topology.js";

test("map topology chooses the deterministic lowest travel-time path", () => {
  const topology = MapTopology.create({
    mapId: "test-map@1",
    displayName: "Test map",
    revision: 1,
    nodes: [
      { nodeId: "A", label: "A", kind: "STATION", stationId: "A-STATION", x: 0, y: 0 },
      { nodeId: "B", label: "B", kind: "INTERSECTION", x: 5, y: 0 },
      { nodeId: "C", label: "C", kind: "STATION", stationId: "C-STATION", x: 10, y: 0 },
    ],
    edges: [
      { edgeId: "E-AC", fromNodeId: "A", toNodeId: "C", directed: false, lengthMeters: 10, travelTimeSeconds: 12 },
      { edgeId: "E-AB", fromNodeId: "A", toNodeId: "B", directed: false, lengthMeters: 5, travelTimeSeconds: 4 },
      { edgeId: "E-BC", fromNodeId: "B", toNodeId: "C", directed: false, lengthMeters: 5, travelTimeSeconds: 4 },
    ],
  });

  assert.deepEqual(topology.shortestPath("A", "C").map((step) => step.edgeId), ["E-AB", "E-BC"]);
  assert.equal(topology.nodeForLocation({ stationId: "C-STATION", x: 0, y: 0 }).nodeId, "C");
  assert.equal(topology.nearestNode({ x: 4.9, y: 0 }).nodeId, "B");
});

test("map topology rejects an edge that references an unknown node", () => {
  assert.throws(() => MapTopology.create({
    mapId: "broken@1",
    displayName: "Broken map",
    revision: 1,
    nodes: [{ nodeId: "A", label: "A", kind: "WAYPOINT", x: 0, y: 0 }],
    edges: [{ edgeId: "E", fromNodeId: "A", toNodeId: "MISSING", directed: false, lengthMeters: 1, travelTimeSeconds: 1 }],
  }), (error) => error instanceof DomainError && error.code === "MAP_EDGE_NODE_UNKNOWN");
});

test("map topology reroutes around an excluded edge", () => {
  const topology = MapTopology.create({
    mapId: "reroute@1", displayName: "Reroute", revision: 1,
    nodes: [
      { nodeId: "A", label: "A", kind: "WAYPOINT", x: 0, y: 0 },
      { nodeId: "B", label: "B", kind: "WAYPOINT", x: 5, y: 0 },
      { nodeId: "C", label: "C", kind: "WAYPOINT", x: 5, y: 5 },
      { nodeId: "D", label: "D", kind: "WAYPOINT", x: 10, y: 0 },
    ],
    edges: [
      { edgeId: "E-AB", fromNodeId: "A", toNodeId: "B", directed: false, lengthMeters: 5, travelTimeSeconds: 5 },
      { edgeId: "E-BD", fromNodeId: "B", toNodeId: "D", directed: false, lengthMeters: 5, travelTimeSeconds: 5 },
      { edgeId: "E-AC", fromNodeId: "A", toNodeId: "C", directed: false, lengthMeters: 7, travelTimeSeconds: 7 },
      { edgeId: "E-CD", fromNodeId: "C", toNodeId: "D", directed: false, lengthMeters: 7, travelTimeSeconds: 7 },
    ],
  });
  const direct = topology.shortestPath("A", "D");
  const rerouted = topology.shortestPath("A", "D", { excludedEdgeIds: new Set(["E-AB"]) });
  assert.notEqual(rerouted[0].edgeId, direct[0].edgeId);
});
