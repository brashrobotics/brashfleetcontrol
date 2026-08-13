import type {
  AssignmentDecisionRepository,
  CommandClaimOptions,
  CommandRepository,
  MapTopologyRepository,
  MissionEventRepository,
  MissionRepository,
  NewMissionEvent,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
  TrafficPlanRepository,
} from "@brash/application";
import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
  MissionEventType,
  MissionEventView,
} from "@brash/contracts";
import {
  MapTopology,
  Mission,
  Robot,
  type MapTopologySnapshot,
  type MissionLocation,
  type MissionState,
  type RecoverableMissionState,
  type RobotAvailability,
  type RobotConnection,
  type TrafficPlanSnapshot,
  type TrafficReservationSnapshot,
} from "@brash/domain";
import type { PostgresDatabase } from "./postgres-database.js";

interface MissionRow {
  mission_id: string;
  external_reference: string | null;
  priority: number;
  required_capabilities: string[];
  payload_kg: string;
  pickup: MissionLocation;
  dropoff: MissionLocation;
  state: MissionState;
  assigned_robot_id: string | null;
  command_id: string | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
  recovery_previous_state: RecoverableMissionState | null;
  recovery_started_at: Date | null;
}

interface RobotRow {
  robot_id: string;
  display_name: string;
  vendor: string;
  model: string;
  capabilities: string[];
  max_payload_kg: string;
  allowed_zones: string[];
  sequence: string;
  observed_at: Date;
  connection: RobotConnection;
  availability: RobotAvailability;
  battery_percent: string;
  map_id: string;
  pose_x: number;
  pose_y: number;
  pose_yaw: number;
  active_mission_id: string | null;
  last_seen_at: Date;
  connection_changed_at: Date;
}

interface CommandRow {
  command_payload: MissionCommand;
  attempt_count: number;
  last_attempt_at: Date | null;
  last_error: string | null;
}

interface MissionEventRow {
  event_id: string;
  mission_id: string;
  event_type: MissionEventType;
  mission_state: MissionState;
  robot_id: string | null;
  command_id: string | null;
  message: string;
  event_data: Record<string, unknown>;
  occurred_at: Date;
}

interface MapTopologyRow {
  topology: MapTopologySnapshot;
}

interface TrafficPlanRow {
  route_id: string;
  mission_id: string;
  robot_id: string;
  map_id: string;
  status: TrafficPlanSnapshot["status"];
  origin_node_id: string;
  pickup_node_id: string;
  dropoff_node_id: string;
  requested_start_at: Date;
  scheduled_start_at: Date;
  expected_arrival_at: Date;
  total_distance_meters: number;
  total_wait_seconds: number;
  segments: Array<Omit<TrafficPlanSnapshot["segments"][number], "enterAt" | "exitAt"> & {
    enterAt: string;
    exitAt: string;
  }>;
  planned_at: Date;
  last_renewed_at: Date;
  lease_expires_at: Date;
  released_at: Date | null;
}

interface TrafficReservationRow {
  reservation_id: string;
  route_id: string;
  mission_id: string;
  robot_id: string;
  map_id: string;
  resource_id: string;
  resource_type: TrafficReservationSnapshot["resourceType"];
  sequence: number;
  starts_at: Date;
  ends_at: Date;
  state: TrafficReservationSnapshot["state"];
  released_at: Date | null;
}

const MISSION_COLUMNS = `
  mission_id, external_reference, priority, required_capabilities, payload_kg,
  pickup, dropoff, state, assigned_robot_id, command_id, failure_reason,
  created_at, updated_at, recovery_previous_state, recovery_started_at
`;

const ROBOT_COLUMNS = `
  robot_id, display_name, vendor, model, capabilities, max_payload_kg,
  allowed_zones, sequence, observed_at, connection, availability,
  battery_percent, map_id, pose_x, pose_y, pose_yaw, active_mission_id,
  last_seen_at, connection_changed_at
`;

const TRAFFIC_PLAN_COLUMNS = `
  route_id, mission_id, robot_id, map_id, status,
  origin_node_id, pickup_node_id, dropoff_node_id,
  requested_start_at, scheduled_start_at, expected_arrival_at,
  total_distance_meters, total_wait_seconds, segments, planned_at,
  last_renewed_at, lease_expires_at, released_at
`;

const TRAFFIC_RESERVATION_COLUMNS = `
  reservation_id, route_id, mission_id, robot_id, map_id,
  resource_id, resource_type, sequence, starts_at, ends_at, state, released_at
`;

export class PostgresMissionRepository implements MissionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getById(missionId: string, options?: RepositoryReadOptions): Promise<Mission | null> {
    const result = await this.database.query<MissionRow>(
      `SELECT ${MISSION_COLUMNS} FROM missions WHERE mission_id = $1${lockClause(options)}`,
      [missionId],
    );
    return result.rows[0] ? missionFromRow(result.rows[0]) : null;
  }

  async findByExternalReference(externalReference: string): Promise<Mission | null> {
    const result = await this.database.query<MissionRow>(
      `SELECT ${MISSION_COLUMNS} FROM missions WHERE external_reference = $1`,
      [externalReference],
    );
    return result.rows[0] ? missionFromRow(result.rows[0]) : null;
  }

  async list(): Promise<Mission[]> {
    const result = await this.database.query<MissionRow>(
      `SELECT ${MISSION_COLUMNS} FROM missions ORDER BY created_at DESC, mission_id`,
    );
    return result.rows.map(missionFromRow);
  }

  async save(mission: Mission): Promise<void> {
    const snapshot = mission.snapshot();
    await this.database.query(`
      INSERT INTO missions (
        mission_id, external_reference, priority, required_capabilities, payload_kg,
        pickup, dropoff, state, assigned_robot_id, command_id, failure_reason,
        created_at, updated_at, recovery_previous_state, recovery_started_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (mission_id) DO UPDATE SET
        external_reference = EXCLUDED.external_reference,
        priority = EXCLUDED.priority,
        required_capabilities = EXCLUDED.required_capabilities,
        payload_kg = EXCLUDED.payload_kg,
        pickup = EXCLUDED.pickup,
        dropoff = EXCLUDED.dropoff,
        state = EXCLUDED.state,
        assigned_robot_id = EXCLUDED.assigned_robot_id,
        command_id = EXCLUDED.command_id,
        failure_reason = EXCLUDED.failure_reason,
        recovery_previous_state = EXCLUDED.recovery_previous_state,
        recovery_started_at = EXCLUDED.recovery_started_at,
        updated_at = EXCLUDED.updated_at,
        revision = missions.revision + 1
    `, [
      snapshot.missionId,
      snapshot.externalReference ?? null,
      snapshot.priority,
      JSON.stringify(snapshot.requiredCapabilities),
      snapshot.payloadKg,
      JSON.stringify(snapshot.pickup),
      JSON.stringify(snapshot.dropoff),
      snapshot.state,
      snapshot.assignedRobotId,
      snapshot.commandId,
      snapshot.failureReason,
      snapshot.createdAt,
      snapshot.updatedAt,
      snapshot.recoveryPreviousState,
      snapshot.recoveryStartedAt,
    ]);
  }
}

export class PostgresRobotRepository implements RobotRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getById(robotId: string, options?: RepositoryReadOptions): Promise<Robot | null> {
    const result = await this.database.query<RobotRow>(
      `SELECT ${ROBOT_COLUMNS} FROM robots WHERE robot_id = $1${lockClause(options)}`,
      [robotId],
    );
    return result.rows[0] ? robotFromRow(result.rows[0]) : null;
  }

  async list(options?: RepositoryReadOptions): Promise<Robot[]> {
    const result = await this.database.query<RobotRow>(
      `SELECT ${ROBOT_COLUMNS} FROM robots ORDER BY robot_id${lockClause(options)}`,
    );
    return result.rows.map(robotFromRow);
  }

  async save(robot: Robot): Promise<void> {
    const snapshot = robot.snapshot();
    await this.database.query(`
      INSERT INTO robots (
        robot_id, display_name, vendor, model, capabilities, max_payload_kg,
        allowed_zones, sequence, observed_at, connection, availability,
        battery_percent, map_id, pose_x, pose_y, pose_yaw, active_mission_id,
        updated_at, last_seen_at, connection_changed_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT (robot_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        vendor = EXCLUDED.vendor,
        model = EXCLUDED.model,
        capabilities = EXCLUDED.capabilities,
        max_payload_kg = EXCLUDED.max_payload_kg,
        allowed_zones = EXCLUDED.allowed_zones,
        sequence = EXCLUDED.sequence,
        observed_at = EXCLUDED.observed_at,
        connection = EXCLUDED.connection,
        availability = EXCLUDED.availability,
        battery_percent = EXCLUDED.battery_percent,
        map_id = EXCLUDED.map_id,
        pose_x = EXCLUDED.pose_x,
        pose_y = EXCLUDED.pose_y,
        pose_yaw = EXCLUDED.pose_yaw,
        active_mission_id = EXCLUDED.active_mission_id,
        last_seen_at = EXCLUDED.last_seen_at,
        connection_changed_at = EXCLUDED.connection_changed_at,
        updated_at = EXCLUDED.updated_at
    `, [
      snapshot.robotId,
      snapshot.displayName,
      snapshot.vendor,
      snapshot.model,
      JSON.stringify(snapshot.capabilities),
      snapshot.maxPayloadKg,
      JSON.stringify(snapshot.allowedZones),
      snapshot.sequence,
      snapshot.observedAt,
      snapshot.connection,
      snapshot.availability,
      snapshot.batteryPercent,
      snapshot.pose.mapId,
      snapshot.pose.x,
      snapshot.pose.y,
      snapshot.pose.yaw,
      snapshot.activeMissionId,
      snapshot.observedAt,
      snapshot.lastSeenAt,
      snapshot.connectionChangedAt,
    ]);
  }
}

export class PostgresCommandRepository implements CommandRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async enqueue(command: MissionCommand, createdAt: Date): Promise<void> {
    await this.database.query(`
      INSERT INTO command_outbox (
        command_id, mission_id, robot_id, command_payload,
        next_attempt_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $5, $5)
      ON CONFLICT (command_id) DO NOTHING
    `, [command.commandId, command.missionId, command.robotId, JSON.stringify(command), createdAt]);
  }

  async updatePending(command: MissionCommand, updatedAt: Date): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET command_payload = $2::jsonb,
          next_attempt_at = LEAST(next_attempt_at, $3),
          updated_at = $3
      WHERE command_id = $1 AND status = 'PENDING'
    `, [command.commandId, JSON.stringify(command), updatedAt]);
  }

  async deferPendingByMission(missionId: string, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET next_attempt_at = $2, last_error = $3,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE mission_id = $1 AND status = 'PENDING'
    `, [missionId, nextAttemptAt, reason]);
  }

  async resumePendingByMission(missionId: string, at: Date): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET next_attempt_at = $2, last_error = NULL,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
      WHERE mission_id = $1 AND status = 'PENDING'
    `, [missionId, at]);
  }

  async cancelPendingByMission(missionId: string, at: Date, reason: string): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET status = 'CANCELLED', last_error = $3,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = $2
      WHERE mission_id = $1 AND status = 'PENDING'
    `, [missionId, at, reason]);
  }

  async claimById(commandId: string, options: CommandClaimOptions): Promise<PendingCommand | null> {
    const result = await this.database.query<CommandRow>(`
      UPDATE command_outbox
      SET lease_owner = $2,
          lease_expires_at = $3,
          updated_at = $4
      WHERE command_id = $1
        AND status = 'PENDING'
        AND next_attempt_at <= $4
        AND (lease_expires_at IS NULL OR lease_expires_at <= $4)
      RETURNING command_payload, attempt_count, last_attempt_at, last_error
    `, [
      commandId,
      options.workerId,
      new Date(options.claimedAt.getTime() + options.leaseDurationMs),
      options.claimedAt,
    ]);
    return result.rows[0] ? commandFromRow(result.rows[0]) : null;
  }

  async claimPending(limit: number, options: CommandClaimOptions): Promise<PendingCommand[]> {
    const result = await this.database.query<CommandRow>(`
      WITH claimable AS (
        SELECT command_id
        FROM command_outbox
        WHERE status = 'PENDING'
          AND next_attempt_at <= $1
          AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
        ORDER BY next_attempt_at, created_at, command_id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE command_outbox AS command
      SET lease_owner = $3,
          lease_expires_at = $4,
          updated_at = $1
      FROM claimable
      WHERE command.command_id = claimable.command_id
      RETURNING command.command_payload, command.attempt_count,
                command.last_attempt_at, command.last_error
    `, [
      options.claimedAt,
      limit,
      options.workerId,
      new Date(options.claimedAt.getTime() + options.leaseDurationMs),
    ]);
    return result.rows.map(commandFromRow);
  }

  async recordAttempt(commandId: string, attemptedAt: Date): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET attempt_count = attempt_count + 1,
          last_attempt_at = $2,
          last_error = NULL,
          updated_at = $2
      WHERE command_id = $1 AND status = 'PENDING'
    `, [commandId, attemptedAt]);
  }

  async recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date, nextAttemptAt: Date): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET last_attempt_at = $3,
          last_error = $2,
          next_attempt_at = $4,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $3
      WHERE command_id = $1 AND status = 'PENDING'
    `, [commandId, reason, attemptedAt, nextAttemptAt]);
  }

  async recordReceipt(receipt: CommandReceipt): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET status = $2,
          receipt = $3::jsonb,
          last_error = $4,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $5
      WHERE command_id = $1 AND status = 'PENDING'
    `, [
      receipt.commandId,
      receipt.status,
      JSON.stringify(receipt),
      receipt.reason ?? null,
      new Date(receipt.receivedAt),
    ]);
  }
}

export class PostgresMapTopologyRepository implements MapTopologyRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getById(mapId: string, options?: RepositoryReadOptions): Promise<MapTopology | null> {
    const result = await this.database.query<MapTopologyRow>(
      `SELECT topology FROM map_topologies WHERE map_id = $1${lockClause(options)}`,
      [mapId],
    );
    return result.rows[0] ? MapTopology.restore(structuredClone(result.rows[0].topology)) : null;
  }

  async list(): Promise<MapTopology[]> {
    const result = await this.database.query<MapTopologyRow>(
      "SELECT topology FROM map_topologies ORDER BY map_id",
    );
    return result.rows.map((row) => MapTopology.restore(structuredClone(row.topology)));
  }

  async save(topology: MapTopology): Promise<void> {
    const snapshot = topology.snapshot();
    await this.database.query(`
      INSERT INTO map_topologies (map_id, display_name, revision, topology, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, now())
      ON CONFLICT (map_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        revision = EXCLUDED.revision,
        topology = EXCLUDED.topology,
        updated_at = EXCLUDED.updated_at
      WHERE map_topologies.revision <= EXCLUDED.revision
    `, [snapshot.mapId, snapshot.displayName, snapshot.revision, JSON.stringify(snapshot)]);
  }
}

export class PostgresTrafficPlanRepository implements TrafficPlanRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getByMission(missionId: string): Promise<TrafficPlanSnapshot | null> {
    const result = await this.database.query<TrafficPlanRow>(`
      SELECT ${TRAFFIC_PLAN_COLUMNS}
      FROM traffic_route_plans
      WHERE mission_id = $1
    `, [missionId]);
    return result.rows[0] ? this.hydratePlan(result.rows[0]) : null;
  }

  async listByMap(mapId: string): Promise<TrafficPlanSnapshot[]> {
    const result = await this.database.query<TrafficPlanRow>(`
      SELECT ${TRAFFIC_PLAN_COLUMNS}
      FROM traffic_route_plans
      WHERE map_id = $1
      ORDER BY scheduled_start_at, route_id
    `, [mapId]);
    return Promise.all(result.rows.map((row) => this.hydratePlan(row)));
  }

  async listActiveReservations(
    mapId: string,
    after: Date,
    excludeMissionId?: string,
  ): Promise<TrafficReservationSnapshot[]> {
    const result = await this.database.query<TrafficReservationRow>(`
      SELECT ${TRAFFIC_RESERVATION_COLUMNS}
      FROM traffic_reservations
      WHERE map_id = $1
        AND state IN ('ACTIVE', 'SAFETY_HOLD')
        AND (state = 'SAFETY_HOLD' OR ends_at > $2)
        AND ($3::text IS NULL OR mission_id <> $3)
      ORDER BY starts_at, reservation_id
    `, [mapId, after, excludeMissionId ?? null]);
    return result.rows.map(trafficReservationFromRow);
  }

  async save(plan: TrafficPlanSnapshot): Promise<void> {
    await this.database.query("DELETE FROM traffic_reservations WHERE route_id = $1", [plan.routeId]);
    await this.database.query(`
      INSERT INTO traffic_route_plans (
        route_id, mission_id, robot_id, map_id, status,
        origin_node_id, pickup_node_id, dropoff_node_id,
        requested_start_at, scheduled_start_at, expected_arrival_at,
        total_distance_meters, total_wait_seconds, segments,
        planned_at, last_renewed_at, lease_expires_at, released_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14::jsonb, $15, $16, $17, $18, $15
      )
      ON CONFLICT (route_id) DO UPDATE SET
        robot_id = EXCLUDED.robot_id,
        map_id = EXCLUDED.map_id,
        status = EXCLUDED.status,
        origin_node_id = EXCLUDED.origin_node_id,
        pickup_node_id = EXCLUDED.pickup_node_id,
        dropoff_node_id = EXCLUDED.dropoff_node_id,
        requested_start_at = EXCLUDED.requested_start_at,
        scheduled_start_at = EXCLUDED.scheduled_start_at,
        expected_arrival_at = EXCLUDED.expected_arrival_at,
        total_distance_meters = EXCLUDED.total_distance_meters,
        total_wait_seconds = EXCLUDED.total_wait_seconds,
        segments = EXCLUDED.segments,
        planned_at = EXCLUDED.planned_at,
        last_renewed_at = EXCLUDED.last_renewed_at,
        lease_expires_at = EXCLUDED.lease_expires_at,
        released_at = EXCLUDED.released_at,
        updated_at = EXCLUDED.updated_at
    `, [
      plan.routeId,
      plan.missionId,
      plan.robotId,
      plan.mapId,
      plan.status,
      plan.originNodeId,
      plan.pickupNodeId,
      plan.dropoffNodeId,
      plan.requestedStartAt,
      plan.scheduledStartAt,
      plan.expectedArrivalAt,
      plan.totalDistanceMeters,
      plan.totalWaitSeconds,
      JSON.stringify(plan.segments),
      plan.plannedAt,
      plan.lastRenewedAt,
      plan.leaseExpiresAt,
      plan.releasedAt,
    ]);

    for (const reservation of plan.reservations) {
      await this.database.query(`
        INSERT INTO traffic_reservations (
          reservation_id, route_id, mission_id, robot_id, map_id,
          resource_id, resource_type, sequence, starts_at, ends_at,
          state, released_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        reservation.reservationId,
        reservation.routeId,
        reservation.missionId,
        reservation.robotId,
        reservation.mapId,
        reservation.resourceId,
        reservation.resourceType,
        reservation.sequence,
        reservation.startsAt,
        reservation.endsAt,
        reservation.state,
        reservation.releasedAt,
      ]);
    }
  }

  async renewLeaseByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null> {
    await this.database.query(`
      UPDATE traffic_route_plans
      SET last_renewed_at = $2, lease_expires_at = $3, updated_at = $2
      WHERE mission_id = $1 AND status = 'ACTIVE'
    `, [missionId, renewedAt, expiresAt]);
    return this.getByMission(missionId);
  }

  async placeSafetyHoldByMission(missionId: string, at: Date): Promise<TrafficPlanSnapshot | null> {
    await this.database.query(`
      UPDATE traffic_reservations
      SET state = 'SAFETY_HOLD', ends_at = '9999-12-31 23:59:59.999+00'
      WHERE mission_id = $1 AND state = 'ACTIVE'
    `, [missionId]);
    await this.database.query(`
      UPDATE traffic_route_plans
      SET status = 'SAFETY_HOLD', lease_expires_at = $2, updated_at = $2
      WHERE mission_id = $1 AND status = 'ACTIVE'
    `, [missionId, at]);
    return this.getByMission(missionId);
  }

  async acknowledgeSafetyHoldByMission(missionId: string, renewedAt: Date, expiresAt: Date): Promise<TrafficPlanSnapshot | null> {
    await this.database.query(`
      UPDATE traffic_route_plans
      SET last_renewed_at = $2, lease_expires_at = $3, updated_at = $2
      WHERE mission_id = $1 AND status = 'SAFETY_HOLD'
    `, [missionId, renewedAt, expiresAt]);
    return this.getByMission(missionId);
  }

  async releaseByMission(missionId: string, releasedAt: Date): Promise<TrafficPlanSnapshot | null> {
    await this.database.query(`
      UPDATE traffic_reservations
      SET state = 'RELEASED', released_at = $2
      WHERE mission_id = $1 AND state IN ('ACTIVE', 'SAFETY_HOLD')
    `, [missionId, releasedAt]);
    await this.database.query(`
      UPDATE traffic_route_plans
      SET status = 'RELEASED', released_at = $2, updated_at = $2
      WHERE mission_id = $1 AND status IN ('ACTIVE', 'SAFETY_HOLD')
    `, [missionId, releasedAt]);
    return this.getByMission(missionId);
  }

  private async hydratePlan(row: TrafficPlanRow): Promise<TrafficPlanSnapshot> {
    const reservations = await this.database.query<TrafficReservationRow>(`
      SELECT ${TRAFFIC_RESERVATION_COLUMNS}
      FROM traffic_reservations
      WHERE route_id = $1
      ORDER BY sequence, reservation_id
    `, [row.route_id]);
    return trafficPlanFromRow(row, reservations.rows.map(trafficReservationFromRow));
  }
}

export class PostgresAssignmentDecisionRepository implements AssignmentDecisionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async save(decision: AssignmentDecision, decidedAt: Date): Promise<void> {
    await this.database.query(`
      INSERT INTO assignment_decisions (
        mission_id, selected_robot_id, selected_score, reasons, candidates, decided_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
    `, [
      decision.missionId,
      decision.selectedRobotId,
      decision.selectedScore,
      JSON.stringify(decision.reasons),
      JSON.stringify(decision.candidates),
      decidedAt,
    ]);
  }
}

export class PostgresMissionEventRepository implements MissionEventRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async append(event: NewMissionEvent): Promise<void> {
    await this.database.query(`
      INSERT INTO mission_events (
        mission_id, event_type, mission_state, robot_id, command_id,
        message, event_data, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `, [
      event.missionId,
      event.type,
      event.state,
      event.robotId,
      event.commandId,
      event.message,
      JSON.stringify(event.data ?? {}),
      event.occurredAt,
    ]);
  }

  async listByMission(missionId: string): Promise<MissionEventView[]> {
    const result = await this.database.query<MissionEventRow>(`
      SELECT event_id, mission_id, event_type, mission_state, robot_id,
             command_id, message, event_data, occurred_at
      FROM mission_events
      WHERE mission_id = $1
      ORDER BY occurred_at, event_id
    `, [missionId]);
    return result.rows.map((row) => ({
      eventId: `event-${row.event_id}`,
      missionId: row.mission_id,
      type: row.event_type,
      state: row.mission_state,
      robotId: row.robot_id,
      commandId: row.command_id,
      message: row.message,
      data: structuredClone(row.event_data),
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }
}

function lockClause(options?: RepositoryReadOptions): string {
  if (!options?.forUpdate) return "";
  return options.skipLocked ? " FOR UPDATE SKIP LOCKED" : " FOR UPDATE";
}

function commandFromRow(row: CommandRow): PendingCommand {
  return {
    command: structuredClone(row.command_payload),
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    lastError: row.last_error,
  };
}

function trafficReservationFromRow(row: TrafficReservationRow): TrafficReservationSnapshot {
  return {
    reservationId: row.reservation_id,
    routeId: row.route_id,
    missionId: row.mission_id,
    robotId: row.robot_id,
    mapId: row.map_id,
    resourceId: row.resource_id,
    resourceType: row.resource_type,
    sequence: row.sequence,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    state: row.state,
    releasedAt: row.released_at ? new Date(row.released_at) : null,
  };
}

function trafficPlanFromRow(
  row: TrafficPlanRow,
  reservations: TrafficReservationSnapshot[],
): TrafficPlanSnapshot {
  return {
    routeId: row.route_id,
    missionId: row.mission_id,
    robotId: row.robot_id,
    mapId: row.map_id,
    status: row.status,
    originNodeId: row.origin_node_id,
    pickupNodeId: row.pickup_node_id,
    dropoffNodeId: row.dropoff_node_id,
    requestedStartAt: new Date(row.requested_start_at),
    scheduledStartAt: new Date(row.scheduled_start_at),
    expectedArrivalAt: new Date(row.expected_arrival_at),
    totalDistanceMeters: Number(row.total_distance_meters),
    totalWaitSeconds: Number(row.total_wait_seconds),
    segments: row.segments.map((segment) => ({
      ...segment,
      enterAt: new Date(segment.enterAt),
      exitAt: new Date(segment.exitAt),
    })),
    reservations,
    plannedAt: new Date(row.planned_at),
    lastRenewedAt: new Date(row.last_renewed_at),
    leaseExpiresAt: new Date(row.lease_expires_at),
    releasedAt: row.released_at ? new Date(row.released_at) : null,
  };
}

function missionFromRow(row: MissionRow): Mission {
  return Mission.restore({
    missionId: row.mission_id,
    ...(row.external_reference ? { externalReference: row.external_reference } : {}),
    priority: row.priority,
    requiredCapabilities: [...row.required_capabilities],
    payloadKg: Number(row.payload_kg),
    pickup: { ...row.pickup },
    dropoff: { ...row.dropoff },
    state: row.state,
    assignedRobotId: row.assigned_robot_id,
    commandId: row.command_id,
    failureReason: row.failure_reason,
    recoveryPreviousState: row.recovery_previous_state,
    recoveryStartedAt: row.recovery_started_at ? new Date(row.recovery_started_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function robotFromRow(row: RobotRow): Robot {
  return Robot.restore({
    robotId: row.robot_id,
    displayName: row.display_name,
    vendor: row.vendor,
    model: row.model,
    capabilities: [...row.capabilities],
    maxPayloadKg: Number(row.max_payload_kg),
    allowedZones: [...row.allowed_zones],
    sequence: Number(row.sequence),
    observedAt: new Date(row.observed_at),
    connection: row.connection,
    availability: row.availability,
    batteryPercent: Number(row.battery_percent),
    pose: {
      mapId: row.map_id,
      x: row.pose_x,
      y: row.pose_y,
      yaw: row.pose_yaw,
    },
    activeMissionId: row.active_mission_id,
    lastSeenAt: new Date(row.last_seen_at),
    connectionChangedAt: new Date(row.connection_changed_at),
  });
}
