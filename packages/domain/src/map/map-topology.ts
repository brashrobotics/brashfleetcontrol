import { DomainError } from "../shared/domain-error.js";

export type MapNodeKind = "WAYPOINT" | "INTERSECTION" | "STATION" | "HOLDING_POINT";

export interface MapNode {
  nodeId: string;
  label: string;
  kind: MapNodeKind;
  x: number;
  y: number;
  stationId?: string;
  zoneId?: string;
}

export interface MapEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  directed: boolean;
  lengthMeters: number;
  travelTimeSeconds: number;
}

export interface MapTopologySnapshot {
  mapId: string;
  displayName: string;
  revision: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface RouteTraversal {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  lengthMeters: number;
  travelTimeSeconds: number;
}

export class MapTopology {
  readonly mapId: string;
  readonly displayName: string;
  readonly revision: number;
  readonly nodes: readonly MapNode[];
  readonly edges: readonly MapEdge[];

  private readonly nodesById: Map<string, MapNode>;
  private readonly adjacency: Map<string, RouteTraversal[]>;

  private constructor(snapshot: MapTopologySnapshot) {
    this.mapId = snapshot.mapId;
    this.displayName = snapshot.displayName;
    this.revision = snapshot.revision;
    this.nodes = Object.freeze(snapshot.nodes.map((node) => Object.freeze({ ...node })));
    this.edges = Object.freeze(snapshot.edges.map((edge) => Object.freeze({ ...edge })));
    this.nodesById = new Map(this.nodes.map((node) => [node.nodeId, node]));
    this.adjacency = this.buildAdjacency();
  }

  static create(snapshot: MapTopologySnapshot): MapTopology {
    if (!snapshot.mapId.trim()) throw new DomainError("MAP_ID_REQUIRED", "Map ID is required.");
    if (!snapshot.displayName.trim()) throw new DomainError("MAP_NAME_REQUIRED", "Map display name is required.");
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      throw new DomainError("MAP_REVISION_INVALID", "Map revision must be a positive integer.");
    }
    if (snapshot.nodes.length === 0) {
      throw new DomainError("MAP_NODE_REQUIRED", "A map topology requires at least one node.");
    }

    const nodeIds = new Set<string>();
    const stations = new Set<string>();
    for (const node of snapshot.nodes) {
      if (!node.nodeId.trim()) throw new DomainError("MAP_NODE_ID_REQUIRED", "Every map node requires an ID.");
      if (nodeIds.has(node.nodeId)) throw new DomainError("MAP_NODE_DUPLICATE", `Duplicate map node ${node.nodeId}.`);
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        throw new DomainError("MAP_NODE_POSITION_INVALID", `Map node ${node.nodeId} has invalid coordinates.`);
      }
      if (node.stationId) {
        if (stations.has(node.stationId)) {
          throw new DomainError("MAP_STATION_DUPLICATE", `Station ${node.stationId} is mapped more than once.`);
        }
        stations.add(node.stationId);
      }
      nodeIds.add(node.nodeId);
    }

    const edgeIds = new Set<string>();
    for (const edge of snapshot.edges) {
      if (!edge.edgeId.trim()) throw new DomainError("MAP_EDGE_ID_REQUIRED", "Every map edge requires an ID.");
      if (edgeIds.has(edge.edgeId)) throw new DomainError("MAP_EDGE_DUPLICATE", `Duplicate map edge ${edge.edgeId}.`);
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        throw new DomainError("MAP_EDGE_NODE_UNKNOWN", `Map edge ${edge.edgeId} references an unknown node.`);
      }
      if (edge.fromNodeId === edge.toNodeId) {
        throw new DomainError("MAP_EDGE_LOOP_INVALID", `Map edge ${edge.edgeId} cannot connect a node to itself.`);
      }
      if (!Number.isFinite(edge.lengthMeters) || edge.lengthMeters <= 0) {
        throw new DomainError("MAP_EDGE_LENGTH_INVALID", `Map edge ${edge.edgeId} requires a positive length.`);
      }
      if (!Number.isFinite(edge.travelTimeSeconds) || edge.travelTimeSeconds <= 0) {
        throw new DomainError("MAP_EDGE_TRAVEL_TIME_INVALID", `Map edge ${edge.edgeId} requires a positive travel time.`);
      }
      edgeIds.add(edge.edgeId);
    }

    return new MapTopology(snapshot);
  }

  static restore(snapshot: MapTopologySnapshot): MapTopology {
    return MapTopology.create(snapshot);
  }

  getNode(nodeId: string): MapNode {
    const node = this.nodesById.get(nodeId);
    if (!node) throw new DomainError("MAP_NODE_NOT_FOUND", `Map node ${nodeId} was not found on ${this.mapId}.`);
    return { ...node };
  }

  nearestNode(position: { x: number; y: number }): MapNode {
    const nearest = [...this.nodes]
      .map((node) => ({ node, distance: Math.hypot(node.x - position.x, node.y - position.y) }))
      .sort((left, right) => left.distance - right.distance || left.node.nodeId.localeCompare(right.node.nodeId))[0];
    return { ...nearest.node };
  }

  nodeForLocation(location: { stationId?: string; x: number; y: number }): MapNode {
    if (location.stationId) {
      const stationNode = this.nodes.find((node) => node.stationId === location.stationId);
      if (stationNode) return { ...stationNode };
    }
    return this.nearestNode(location);
  }

  shortestPath(fromNodeId: string, toNodeId: string): RouteTraversal[] {
    this.getNode(fromNodeId);
    this.getNode(toNodeId);
    if (fromNodeId === toNodeId) return [];

    const distances = new Map(this.nodes.map((node) => [node.nodeId, Number.POSITIVE_INFINITY]));
    const previous = new Map<string, { nodeId: string; traversal: RouteTraversal }>();
    const unvisited = new Set(this.nodes.map((node) => node.nodeId));
    distances.set(fromNodeId, 0);

    while (unvisited.size > 0) {
      const current = [...unvisited].sort((left, right) => {
        const delta = (distances.get(left) ?? Infinity) - (distances.get(right) ?? Infinity);
        return delta || left.localeCompare(right);
      })[0];
      const currentDistance = distances.get(current) ?? Infinity;
      if (!Number.isFinite(currentDistance)) break;
      unvisited.delete(current);
      if (current === toNodeId) break;

      for (const traversal of this.adjacency.get(current) ?? []) {
        if (!unvisited.has(traversal.toNodeId)) continue;
        const candidate = currentDistance + traversal.travelTimeSeconds;
        const known = distances.get(traversal.toNodeId) ?? Infinity;
        const previousTraversal = previous.get(traversal.toNodeId)?.traversal;
        if (candidate < known || (candidate === known && traversal.edgeId.localeCompare(previousTraversal?.edgeId ?? "") < 0)) {
          distances.set(traversal.toNodeId, candidate);
          previous.set(traversal.toNodeId, { nodeId: current, traversal });
        }
      }
    }

    if (!previous.has(toNodeId)) {
      throw new DomainError("TRAFFIC_ROUTE_NOT_FOUND", `No route connects ${fromNodeId} to ${toNodeId} on ${this.mapId}.`);
    }

    const path: RouteTraversal[] = [];
    let cursor = toNodeId;
    while (cursor !== fromNodeId) {
      const step = previous.get(cursor);
      if (!step) throw new DomainError("TRAFFIC_ROUTE_NOT_FOUND", `Route reconstruction failed at ${cursor}.`);
      path.unshift({ ...step.traversal });
      cursor = step.nodeId;
    }
    return path;
  }

  snapshot(): MapTopologySnapshot {
    return {
      mapId: this.mapId,
      displayName: this.displayName,
      revision: this.revision,
      nodes: this.nodes.map((node) => ({ ...node })),
      edges: this.edges.map((edge) => ({ ...edge })),
    };
  }

  private buildAdjacency(): Map<string, RouteTraversal[]> {
    const adjacency = new Map<string, RouteTraversal[]>(this.nodes.map((node) => [node.nodeId, []]));
    for (const edge of this.edges) {
      adjacency.get(edge.fromNodeId)!.push({
        edgeId: edge.edgeId,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        lengthMeters: edge.lengthMeters,
        travelTimeSeconds: edge.travelTimeSeconds,
      });
      if (!edge.directed) {
        adjacency.get(edge.toNodeId)!.push({
          edgeId: edge.edgeId,
          fromNodeId: edge.toNodeId,
          toNodeId: edge.fromNodeId,
          lengthMeters: edge.lengthMeters,
          travelTimeSeconds: edge.travelTimeSeconds,
        });
      }
    }
    for (const traversals of adjacency.values()) {
      traversals.sort((left, right) => left.edgeId.localeCompare(right.edgeId) || left.toNodeId.localeCompare(right.toNodeId));
    }
    return adjacency;
  }
}
