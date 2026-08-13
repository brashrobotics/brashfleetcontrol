import type {
  AlarmRecord,
  AlarmRepository,
  AssignmentDecisionRepository,
  AuditEventFilter,
  AuditEventRecord,
  AuditRepository,
  CommandClaimOptions,
  CapabilityProfileRecord,
  CapabilityProfileRepository,
  CommandRepository,
  InfrastructureResourceRecord,
  InfrastructureResourceRepository,
  IntegrationEventClaimOptions,
  IntegrationEventFilter,
  IntegrationEventRecord,
  IntegrationEventRepository,
  MapTopologyRepository,
  MapVersionRecord,
  MissionEventRepository,
  MissionQueueClaimOptions,
  MissionQueueEntry,
  MissionQueueOutcome,
  MissionQueueRepository,
  MissionRepository,
  NewMissionEvent,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
  RaiseAlarmInput,
  TrafficPlanRepository,
  TrafficRestrictionRecord,
  TrafficRestrictionRepository,
  WorkflowClaimOptions,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowResourceReservationRecord,
  WorkflowResourceReservationRepository,
  WorkflowStepRecord,
  WorkOrderClaimOptions,
  WorkOrderRecord,
  WorkOrderRepository,
} from "@brash/application";
import type {
  AlarmSeverity,
  AlarmSourceType,
  AlarmStatus,
  AssignmentDecision,
  AuditOutcome,
  CommandReceipt,
  InfrastructureResourceStatus,
  MissionCommand,
  MissionEventType,
  MissionEventView,
  FleetRole,
  WorkflowStepDefinition,
  CreateWorkOrderRequest,
  OrchestratorCandidateView,
  WorkOrderStatus,
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
  preferred_robot_id: string | null;
  robot_constraints: import("@brash/contracts").RobotAssignmentConstraints | null;
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
  capability_metadata: import("@brash/domain").RobotCapabilityMetadata;
}

interface CapabilityProfileRow {
  profile_id: string; vendor: string; model: string; profile_version: number; display_name: string;
  status: CapabilityProfileRecord["status"]; actions: string[]; max_payload_kg: string; allowed_zones: string[];
  dimensions_meters: CapabilityProfileRecord["dimensionsMeters"]; supported_floor_types: string[]; attachments: string[];
  supports_cancellation: boolean; adapter_protocol_version: string; created_by: string; created_at: Date;
  published_by: string | null; published_at: Date | null; retired_by: string | null; retired_at: Date | null;
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

interface MissionQueueRow {
  mission_id: string;
  base_priority: number;
  effective_priority: number;
  attempt_count: number;
  enqueued_at: Date;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
}

interface AuditEventRow {
  audit_event_id: string;
  occurred_at: Date;
  actor_id: string;
  actor_display_name: string;
  actor_role: FleetRole | null;
  action: string;
  target_type: string;
  target_id: string;
  outcome: AuditOutcome;
  correlation_id: string;
  request_method: string;
  request_path: string;
  site_id: string | null;
  metadata: Record<string, unknown>;
}

interface AlarmRow {
  alarm_id: string;
  fingerprint: string;
  alarm_code: string;
  severity: AlarmSeverity;
  status: AlarmStatus;
  title: string;
  message: string;
  source_type: AlarmSourceType;
  source_id: string;
  occurrence_count: number;
  first_occurred_at: Date;
  last_occurred_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  acknowledgement_note: string | null;
  resolved_at: Date | null;
}

interface TrafficRestrictionRow {
  restriction_id: string; map_id: string; resource_id: string; status: "ACTIVE" | "CLEARED";
  reason: string; created_by: string; created_at: Date; cleared_by: string | null; cleared_at: Date | null;
}

interface MapTopologyRow {
  topology: MapTopologySnapshot;
  family_id: string;
  status: MapVersionRecord["status"];
  created_by: string;
  created_at: Date;
  published_by: string | null;
  published_at: Date | null;
  retired_by: string | null;
  retired_at: Date | null;
}

interface InfrastructureResourceRow {
  resource_id: string;
  map_id: string;
  display_name: string;
  resource_type: InfrastructureResourceRecord["type"];
  status: InfrastructureResourceRecord["status"];
  reservation_policy: InfrastructureResourceRecord["reservationPolicy"];
  edge_id: string | null;
  node_id: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string;
  updated_at: Date;
  status_reason: string | null;
}

interface WorkflowRow {
  workflow_id: string;
  name: string;
  external_reference: string | null;
  status: WorkflowRecord["status"];
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
  failure_reason: string | null;
}

interface WorkflowStepRow {
  workflow_id: string;
  step_id: string;
  definition: WorkflowStepDefinition;
  status: WorkflowStepRecord["status"];
  attempt_count: number;
  mission_id: string | null;
  resource_reservation_id: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  next_attempt_at: Date;
  timeout_at: Date | null;
  wait_until: Date | null;
  last_error: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
}

interface WorkflowResourceReservationRow {
  reservation_id: string;
  workflow_id: string;
  step_id: string;
  resource_id: string;
  starts_at: Date;
  ends_at: Date;
  state: WorkflowResourceReservationRecord["state"];
  released_at: Date | null;
}

interface WorkOrderRow {
  work_order_id: string;
  external_reference: string | null;
  request: CreateWorkOrderRequest;
  status: WorkOrderStatus;
  selected_robot_id: string | null;
  workflow_id: string | null;
  candidates: OrchestratorCandidateView[];
  allocation_attempt_count: number;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  failure_reason: string | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

interface IntegrationEventRow {
  event_id: string;
  idempotency_key: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: IntegrationEventRecord["status"];
  attempt_count: number;
  occurred_at: Date;
  next_attempt_at: Date;
  last_attempt_at: Date | null;
  delivered_at: Date | null;
  last_error: string | null;
  response_status: number | null;
  lease_owner: string | null;
  lease_expires_at: Date | null;
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
  mission_id, external_reference, preferred_robot_id, robot_constraints, priority, required_capabilities, payload_kg,
  pickup, dropoff, state, assigned_robot_id, command_id, failure_reason,
  created_at, updated_at, recovery_previous_state, recovery_started_at
`;

const ROBOT_COLUMNS = `
  robot_id, display_name, vendor, model, capabilities, max_payload_kg,
  allowed_zones, sequence, observed_at, connection, availability,
  battery_percent, map_id, pose_x, pose_y, pose_yaw, active_mission_id,
  last_seen_at, connection_changed_at
  , capability_metadata
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
        mission_id, external_reference, preferred_robot_id, robot_constraints, priority, required_capabilities, payload_kg,
        pickup, dropoff, state, assigned_robot_id, command_id, failure_reason,
        created_at, updated_at, recovery_previous_state, recovery_started_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (mission_id) DO UPDATE SET
        external_reference = EXCLUDED.external_reference,
        preferred_robot_id = EXCLUDED.preferred_robot_id,
        robot_constraints = EXCLUDED.robot_constraints,
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
      snapshot.preferredRobotId ?? null,
      snapshot.robotConstraints ? JSON.stringify(snapshot.robotConstraints) : null,
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

export class PostgresMissionQueueRepository implements MissionQueueRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async enqueue(missionId: string, _priority: number, enqueuedAt: Date): Promise<void> {
    await this.database.query(`
      INSERT INTO mission_dispatch_queue (
        mission_id, status, enqueued_at, next_attempt_at, created_at, updated_at
      ) VALUES ($1, 'PENDING', $2, $2, $2, $2)
      ON CONFLICT (mission_id) DO UPDATE SET
        status = 'PENDING',
        enqueued_at = CASE
          WHEN mission_dispatch_queue.status = 'PENDING'
            THEN LEAST(mission_dispatch_queue.enqueued_at, EXCLUDED.enqueued_at)
          ELSE EXCLUDED.enqueued_at
        END,
        next_attempt_at = CASE
          WHEN mission_dispatch_queue.status = 'PENDING'
            THEN LEAST(mission_dispatch_queue.next_attempt_at, EXCLUDED.next_attempt_at)
          ELSE EXCLUDED.next_attempt_at
        END,
        attempt_count = CASE
          WHEN mission_dispatch_queue.status = 'PENDING' THEN mission_dispatch_queue.attempt_count
          ELSE 0
        END,
        last_attempt_at = CASE
          WHEN mission_dispatch_queue.status = 'PENDING' THEN mission_dispatch_queue.last_attempt_at
          ELSE NULL
        END,
        last_error = CASE
          WHEN mission_dispatch_queue.status = 'PENDING' THEN mission_dispatch_queue.last_error
          ELSE NULL
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = NULL,
        updated_at = EXCLUDED.updated_at
    `, [missionId, enqueuedAt]);
  }

  async claimDue(limit: number, options: MissionQueueClaimOptions): Promise<MissionQueueEntry[]> {
    const result = await this.database.query<MissionQueueRow>(`
      WITH claimable AS (
        SELECT queue.mission_id,
               mission.priority AS base_priority,
               LEAST(100, mission.priority + GREATEST(0, floor(
                 extract(epoch FROM ($1::timestamptz - queue.enqueued_at)) * 1000 / $2
               ))::integer) AS effective_priority
        FROM mission_dispatch_queue AS queue
        JOIN missions AS mission ON mission.mission_id = queue.mission_id
        WHERE queue.status = 'PENDING'
          AND mission.state = 'QUEUED'
          AND queue.next_attempt_at <= $1
          AND (queue.lease_expires_at IS NULL OR queue.lease_expires_at <= $1)
        ORDER BY effective_priority DESC, queue.enqueued_at, queue.mission_id
        FOR UPDATE OF queue SKIP LOCKED
        LIMIT $3
      )
      UPDATE mission_dispatch_queue AS queue
      SET attempt_count = queue.attempt_count + 1,
          last_attempt_at = $1,
          lease_owner = $4,
          lease_expires_at = $5,
          updated_at = $1
      FROM claimable
      WHERE queue.mission_id = claimable.mission_id
      RETURNING queue.mission_id,
                claimable.base_priority,
                claimable.effective_priority,
                queue.attempt_count,
                queue.enqueued_at,
                queue.next_attempt_at,
                queue.last_attempt_at,
                queue.last_error,
                queue.lease_owner,
                queue.lease_expires_at
    `, [
      options.claimedAt,
      options.agingIntervalMs,
      limit,
      options.workerId,
      new Date(options.claimedAt.getTime() + options.leaseDurationMs),
    ]);
    return result.rows.map(missionQueueFromRow);
  }

  async listPending(now: Date, agingIntervalMs: number): Promise<MissionQueueEntry[]> {
    const result = await this.database.query<MissionQueueRow>(`
      SELECT queue.mission_id,
             mission.priority AS base_priority,
             LEAST(100, mission.priority + GREATEST(0, floor(
               extract(epoch FROM ($1::timestamptz - queue.enqueued_at)) * 1000 / $2
             ))::integer) AS effective_priority,
             queue.attempt_count,
             queue.enqueued_at,
             queue.next_attempt_at,
             queue.last_attempt_at,
             queue.last_error,
             queue.lease_owner,
             queue.lease_expires_at
      FROM mission_dispatch_queue AS queue
      JOIN missions AS mission ON mission.mission_id = queue.mission_id
      WHERE queue.status = 'PENDING' AND mission.state = 'QUEUED'
      ORDER BY effective_priority DESC, queue.enqueued_at, queue.mission_id
    `, [now, agingIntervalMs]);
    return result.rows.map(missionQueueFromRow);
  }

  async defer(missionId: string, attemptedAt: Date, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.database.query(`
      UPDATE mission_dispatch_queue
      SET last_attempt_at = $2,
          next_attempt_at = $3,
          last_error = $4,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $2
      WHERE mission_id = $1 AND status = 'PENDING'
    `, [missionId, attemptedAt, nextAttemptAt, reason]);
  }

  async complete(missionId: string, outcome: MissionQueueOutcome, completedAt: Date): Promise<void> {
    await this.database.query(`
      UPDATE mission_dispatch_queue
      SET status = $2,
          completed_at = $3,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = $3
      WHERE mission_id = $1 AND status = 'PENDING'
    `, [missionId, outcome, completedAt]);
  }
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async append(event: AuditEventRecord): Promise<void> {
    await this.database.query(`
      INSERT INTO audit_events (
        audit_event_id, occurred_at, actor_id, actor_display_name, actor_role,
        action, target_type, target_id, outcome, correlation_id,
        request_method, request_path, site_id, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    `, [event.auditEventId, event.occurredAt, event.actorId, event.actorDisplayName, event.actorRole,
      event.action, event.targetType, event.targetId, event.outcome, event.correlationId,
      event.requestMethod, event.requestPath, event.siteId, JSON.stringify(event.metadata)]);
  }

  async list(filter: AuditEventFilter): Promise<AuditEventRecord[]> {
    const result = await this.database.query<AuditEventRow>(`
      SELECT * FROM audit_events
      WHERE ($2::text IS NULL OR actor_id = $2)
        AND ($3::text IS NULL OR target_type = $3)
        AND ($4::text IS NULL OR target_id = $4)
        AND ($5::text IS NULL OR correlation_id = $5)
      ORDER BY occurred_at DESC, audit_event_id DESC
      LIMIT $1
    `, [filter.limit, filter.actorId ?? null, filter.targetType ?? null, filter.targetId ?? null, filter.correlationId ?? null]);
    return result.rows.map(auditEventFromRow);
  }
}

export class PostgresAlarmRepository implements AlarmRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async raise(input: RaiseAlarmInput): Promise<AlarmRecord> {
    const result = await this.database.query<AlarmRow>(`
      INSERT INTO alarms (
        fingerprint, alarm_code, severity, status, title, message,
        source_type, source_id, first_occurred_at, last_occurred_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, 'OPEN', $4, $5, $6, $7, $8, $8, $8, $8)
      ON CONFLICT (fingerprint) WHERE status <> 'RESOLVED' DO UPDATE SET
        alarm_code = EXCLUDED.alarm_code,
        severity = EXCLUDED.severity,
        title = EXCLUDED.title,
        message = EXCLUDED.message,
        occurrence_count = alarms.occurrence_count + 1,
        last_occurred_at = EXCLUDED.last_occurred_at,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `, [
      input.fingerprint,
      input.code,
      input.severity,
      input.title,
      input.message,
      input.sourceType,
      input.sourceId,
      input.occurredAt,
    ]);
    return alarmFromRow(result.rows[0]);
  }

  async getById(alarmId: string): Promise<AlarmRecord | null> {
    const numericId = parseAlarmId(alarmId);
    if (numericId === null) return null;
    const result = await this.database.query<AlarmRow>("SELECT * FROM alarms WHERE alarm_id = $1", [numericId]);
    return result.rows[0] ? alarmFromRow(result.rows[0]) : null;
  }

  async listActive(): Promise<AlarmRecord[]> {
    const result = await this.database.query<AlarmRow>(`
      SELECT * FROM alarms
      WHERE status <> 'RESOLVED'
      ORDER BY CASE severity WHEN 'CRITICAL' THEN 3 WHEN 'WARNING' THEN 2 ELSE 1 END DESC,
               last_occurred_at DESC, alarm_id DESC
    `);
    return result.rows.map(alarmFromRow);
  }

  async acknowledge(alarmId: string, operatorId: string, note: string | null, at: Date): Promise<AlarmRecord | null> {
    const numericId = parseAlarmId(alarmId);
    if (numericId === null) return null;
    const result = await this.database.query<AlarmRow>(`
      UPDATE alarms
      SET status = 'ACKNOWLEDGED', acknowledged_at = $2,
          acknowledged_by = $3, acknowledgement_note = $4, updated_at = $2
      WHERE alarm_id = $1 AND status <> 'RESOLVED'
      RETURNING *
    `, [numericId, at, operatorId, note]);
    return result.rows[0] ? alarmFromRow(result.rows[0]) : null;
  }

  async resolveByFingerprint(fingerprint: string, at: Date): Promise<AlarmRecord | null> {
    const result = await this.database.query<AlarmRow>(`
      UPDATE alarms
      SET status = 'RESOLVED', resolved_at = $2, updated_at = $2
      WHERE fingerprint = $1 AND status <> 'RESOLVED'
      RETURNING *
    `, [fingerprint, at]);
    return result.rows[0] ? alarmFromRow(result.rows[0]) : null;
  }
}

export class PostgresTrafficRestrictionRepository implements TrafficRestrictionRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async create(mapId: string, resourceId: string, reason: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord> {
    const result = await this.database.query<TrafficRestrictionRow>(`
      INSERT INTO traffic_restrictions (map_id, resource_id, status, reason, created_by, created_at, updated_at)
      VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $5)
      ON CONFLICT (map_id, resource_id) WHERE status = 'ACTIVE' DO UPDATE SET updated_at = EXCLUDED.updated_at
      RETURNING *
    `, [mapId, resourceId, reason, operatorId, at]);
    return trafficRestrictionFromRow(result.rows[0]);
  }

  async listActive(mapId: string): Promise<TrafficRestrictionRecord[]> {
    const result = await this.database.query<TrafficRestrictionRow>(
      "SELECT * FROM traffic_restrictions WHERE map_id = $1 AND status = 'ACTIVE' ORDER BY resource_id",
      [mapId],
    );
    return result.rows.map(trafficRestrictionFromRow);
  }

  async clear(restrictionId: string, operatorId: string, at: Date): Promise<TrafficRestrictionRecord | null> {
    const numericId = restrictionId.match(/^RESTRICTION-(\d+)$/)?.[1];
    if (!numericId) return null;
    const result = await this.database.query<TrafficRestrictionRow>(`
      UPDATE traffic_restrictions SET status = 'CLEARED', cleared_by = $2, cleared_at = $3, updated_at = $3
      WHERE restriction_id = $1 AND status = 'ACTIVE' RETURNING *
    `, [numericId, operatorId, at]);
    return result.rows[0] ? trafficRestrictionFromRow(result.rows[0]) : null;
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
        updated_at, last_seen_at, connection_changed_at, capability_metadata
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb
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
        capability_metadata = EXCLUDED.capability_metadata,
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
      JSON.stringify(snapshot.capabilityMetadata),
    ]);
  }
}

export class PostgresCapabilityProfileRepository implements CapabilityProfileRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async create(profile: CapabilityProfileRecord): Promise<void> {
    await this.database.query(`INSERT INTO robot_capability_profiles (
      profile_id,vendor,model,profile_version,display_name,status,actions,max_payload_kg,allowed_zones,
      dimensions_meters,supported_floor_types,attachments,supports_cancellation,adapter_protocol_version,
      created_by,created_at,published_by,published_at,retired_by,retired_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20)`, capabilityProfileValues(profile));
  }

  async getById(profileId: string): Promise<CapabilityProfileRecord | null> {
    const result = await this.database.query<CapabilityProfileRow>("SELECT * FROM robot_capability_profiles WHERE profile_id=$1", [profileId]);
    return result.rows[0] ? capabilityProfileFromRow(result.rows[0]) : null;
  }

  async list(): Promise<CapabilityProfileRecord[]> {
    const result = await this.database.query<CapabilityProfileRow>("SELECT * FROM robot_capability_profiles ORDER BY vendor, model, profile_version DESC");
    return result.rows.map(capabilityProfileFromRow);
  }

  async publish(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null> {
    const result = await this.database.query<CapabilityProfileRow>(`UPDATE robot_capability_profiles SET status='PUBLISHED', published_by=$2, published_at=$3
      WHERE profile_id=$1 AND status='DRAFT' RETURNING *`, [profileId, operatorId, at]);
    return result.rows[0] ? capabilityProfileFromRow(result.rows[0]) : null;
  }

  async retire(profileId: string, operatorId: string, at: Date): Promise<CapabilityProfileRecord | null> {
    const result = await this.database.query<CapabilityProfileRow>(`UPDATE robot_capability_profiles SET status='RETIRED', retired_by=$2, retired_at=$3
      WHERE profile_id=$1 AND status <> 'RETIRED' RETURNING *`, [profileId, operatorId, at]);
    return result.rows[0] ? capabilityProfileFromRow(result.rows[0]) : null;
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
      `SELECT * FROM map_topologies WHERE map_id = $1${lockClause(options)}`,
      [mapId],
    );
    return result.rows[0] ? MapTopology.restore(structuredClone(result.rows[0].topology)) : null;
  }

  async list(): Promise<MapTopology[]> {
    const result = await this.database.query<MapTopologyRow>(
      "SELECT * FROM map_topologies WHERE status = 'PUBLISHED' ORDER BY map_id",
    );
    return result.rows.map((row) => MapTopology.restore(structuredClone(row.topology)));
  }

  async save(topology: MapTopology): Promise<void> {
    const snapshot = topology.snapshot();
    await this.database.query(`
      INSERT INTO map_topologies (
        map_id, family_id, display_name, revision, topology, status,
        created_by, published_by, published_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, 'PUBLISHED',
        'system-bootstrap', 'system-bootstrap', now(), now(), now())
      ON CONFLICT (map_id) DO NOTHING
    `, [snapshot.mapId, familyIdFor(snapshot.mapId), snapshot.displayName, snapshot.revision, JSON.stringify(snapshot)]);
    const comparison = await this.database.query<{ matches: boolean }>(
      "SELECT topology = $2::jsonb AS matches FROM map_topologies WHERE map_id = $1",
      [snapshot.mapId, JSON.stringify(snapshot)],
    );
    if (!comparison.rows[0]?.matches) {
      throw new Error(`Published map ${snapshot.mapId} is immutable; create a new revision.`);
    }
  }

  async getVersion(mapId: string, options?: RepositoryReadOptions): Promise<MapVersionRecord | null> {
    const result = await this.database.query<MapTopologyRow>(
      `SELECT * FROM map_topologies WHERE map_id = $1${lockClause(options)}`,
      [mapId],
    );
    return result.rows[0] ? mapVersionFromRow(result.rows[0]) : null;
  }

  async listVersions(familyId?: string): Promise<MapVersionRecord[]> {
    const result = familyId
      ? await this.database.query<MapTopologyRow>("SELECT * FROM map_topologies WHERE family_id = $1 ORDER BY revision", [familyId])
      : await this.database.query<MapTopologyRow>("SELECT * FROM map_topologies ORDER BY family_id, revision");
    return result.rows.map(mapVersionFromRow);
  }

  async createDraft(topology: MapTopology, familyId: string, operatorId: string, at: Date): Promise<MapVersionRecord> {
    const snapshot = topology.snapshot();
    const result = await this.database.query<MapTopologyRow>(`
      INSERT INTO map_topologies (
        map_id, family_id, display_name, revision, topology, status,
        created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, 'DRAFT', $6, $7, $7)
      RETURNING *
    `, [snapshot.mapId, familyId, snapshot.displayName, snapshot.revision, JSON.stringify(snapshot), operatorId, at]);
    return mapVersionFromRow(result.rows[0]);
  }

  async publish(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null> {
    const result = await this.database.query<MapTopologyRow>(`
      UPDATE map_topologies SET status = 'PUBLISHED', published_by = $2,
        published_at = $3, updated_at = $3
      WHERE map_id = $1 AND status = 'DRAFT'
      RETURNING *
    `, [mapId, operatorId, at]);
    return result.rows[0] ? mapVersionFromRow(result.rows[0]) : null;
  }

  async retire(mapId: string, operatorId: string, at: Date): Promise<MapVersionRecord | null> {
    const result = await this.database.query<MapTopologyRow>(`
      UPDATE map_topologies SET status = 'RETIRED', retired_by = $2,
        retired_at = $3, updated_at = $3
      WHERE map_id = $1 AND status = 'PUBLISHED'
      RETURNING *
    `, [mapId, operatorId, at]);
    return result.rows[0] ? mapVersionFromRow(result.rows[0]) : null;
  }
}

export class PostgresInfrastructureResourceRepository implements InfrastructureResourceRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getById(resourceId: string, options?: RepositoryReadOptions): Promise<InfrastructureResourceRecord | null> {
    const result = await this.database.query<InfrastructureResourceRow>(
      `SELECT * FROM infrastructure_resources WHERE resource_id = $1${lockClause(options)}`,
      [resourceId],
    );
    return result.rows[0] ? infrastructureResourceFromRow(result.rows[0]) : null;
  }

  async listByMap(mapId: string): Promise<InfrastructureResourceRecord[]> {
    const result = await this.database.query<InfrastructureResourceRow>(
      "SELECT * FROM infrastructure_resources WHERE map_id = $1 ORDER BY resource_id",
      [mapId],
    );
    return result.rows.map(infrastructureResourceFromRow);
  }

  async create(resource: InfrastructureResourceRecord): Promise<InfrastructureResourceRecord> {
    const result = await this.database.query<InfrastructureResourceRow>(`
      INSERT INTO infrastructure_resources (
        resource_id, map_id, display_name, resource_type, status, reservation_policy,
        edge_id, node_id, created_by, created_at, updated_by, updated_at, status_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [resource.resourceId, resource.mapId, resource.displayName, resource.type, resource.status,
      resource.reservationPolicy, resource.edgeId, resource.nodeId, resource.createdBy, resource.createdAt,
      resource.updatedBy, resource.updatedAt, resource.statusReason]);
    return infrastructureResourceFromRow(result.rows[0]);
  }

  async updateStatus(resourceId: string, status: InfrastructureResourceStatus, reason: string, operatorId: string, at: Date): Promise<InfrastructureResourceRecord | null> {
    const result = await this.database.query<InfrastructureResourceRow>(`
      UPDATE infrastructure_resources SET status = $2, status_reason = $3,
        updated_by = $4, updated_at = $5
      WHERE resource_id = $1 RETURNING *
    `, [resourceId, status, reason, operatorId, at]);
    return result.rows[0] ? infrastructureResourceFromRow(result.rows[0]) : null;
  }
}

export class PostgresWorkflowRepository implements WorkflowRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByExternalReference(externalReference: string): Promise<WorkflowRecord | null> {
    const result = await this.database.query<WorkflowRow>("SELECT * FROM workflows WHERE external_reference = $1", [externalReference]);
    return result.rows[0] ? workflowFromRow(result.rows[0]) : null;
  }

  async create(workflow: WorkflowRecord, steps: WorkflowStepRecord[]): Promise<void> {
    await this.database.transaction(async () => {
      await this.database.query(`
        INSERT INTO workflows (workflow_id, name, external_reference, status, created_at, updated_at, completed_at, failure_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [workflow.workflowId, workflow.name, workflow.externalReference, workflow.status, workflow.createdAt,
        workflow.updatedAt, workflow.completedAt, workflow.failureReason]);
      for (const step of steps) {
        await this.database.query(`
          INSERT INTO workflow_steps (
            workflow_id, step_id, definition, dependencies, status, attempt_count,
            mission_id, resource_reservation_id, started_at, completed_at,
            next_attempt_at, timeout_at, wait_until, last_error, lease_owner,
            lease_expires_at, updated_at
          ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, workflowStepValues(step, workflow.updatedAt));
      }
    });
  }

  async getById(workflowId: string): Promise<{ workflow: WorkflowRecord; steps: WorkflowStepRecord[] } | null> {
    const workflowResult = await this.database.query<WorkflowRow>("SELECT * FROM workflows WHERE workflow_id = $1", [workflowId]);
    if (!workflowResult.rows[0]) return null;
    const steps = await this.database.query<WorkflowStepRow>("SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_id", [workflowId]);
    return { workflow: workflowFromRow(workflowResult.rows[0]), steps: steps.rows.map(workflowStepFromRow) };
  }

  async list(): Promise<WorkflowRecord[]> {
    const result = await this.database.query<WorkflowRow>("SELECT * FROM workflows ORDER BY created_at DESC, workflow_id");
    return result.rows.map(workflowFromRow);
  }

  async claimRunnable(limit: number, options: WorkflowClaimOptions): Promise<WorkflowStepRecord[]> {
    return this.database.transaction(async () => {
      const result = await this.database.query<WorkflowStepRow>(`
        WITH candidates AS (
          SELECT step.workflow_id, step.step_id
          FROM workflow_steps AS step
          JOIN workflows AS workflow ON workflow.workflow_id = step.workflow_id
          WHERE workflow.status IN ('PENDING', 'RUNNING', 'CANCELLING')
            AND step.status IN ('PENDING', 'WAITING_RETRY', 'RUNNING')
            AND step.next_attempt_at <= $2
            AND (step.lease_expires_at IS NULL OR step.lease_expires_at <= $2)
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(step.dependencies) AS dependency(step_id)
              LEFT JOIN workflow_steps AS required_step
                ON required_step.workflow_id = step.workflow_id
               AND required_step.step_id = dependency.step_id
              WHERE required_step.status IS DISTINCT FROM 'SUCCEEDED'
            )
          ORDER BY (step.status = 'RUNNING') DESC, step.next_attempt_at, step.workflow_id, step.step_id
          FOR UPDATE OF step SKIP LOCKED
          LIMIT $1
        )
        UPDATE workflow_steps AS step
        SET lease_owner = $3, lease_expires_at = $2 + ($4 * interval '1 millisecond'), updated_at = $2
        FROM candidates
        WHERE step.workflow_id = candidates.workflow_id AND step.step_id = candidates.step_id
        RETURNING step.*
      `, [limit, options.claimedAt, options.workerId, options.leaseDurationMs]);
      return result.rows.map(workflowStepFromRow);
    });
  }

  async saveStep(step: WorkflowStepRecord): Promise<void> {
    await this.database.query(`
      UPDATE workflow_steps SET definition = $3::jsonb, dependencies = $4, status = $5,
        attempt_count = $6, mission_id = $7, resource_reservation_id = $8,
        started_at = $9, completed_at = $10, next_attempt_at = $11,
        timeout_at = $12, wait_until = $13, last_error = $14,
        lease_owner = $15, lease_expires_at = $16, updated_at = $17
      WHERE workflow_id = $1 AND step_id = $2
    `, workflowStepValues(step, new Date()));
  }

  async saveWorkflow(workflow: WorkflowRecord): Promise<void> {
    await this.database.query(`
      UPDATE workflows SET name = $2, external_reference = $3, status = $4,
        updated_at = $5, completed_at = $6, failure_reason = $7
      WHERE workflow_id = $1
    `, [workflow.workflowId, workflow.name, workflow.externalReference, workflow.status,
      workflow.updatedAt, workflow.completedAt, workflow.failureReason]);
  }
}

export class PostgresWorkflowResourceReservationRepository implements WorkflowResourceReservationRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async getActiveByStep(workflowId: string, stepId: string): Promise<WorkflowResourceReservationRecord | null> {
    const result = await this.database.query<WorkflowResourceReservationRow>(`
      SELECT * FROM workflow_resource_reservations
      WHERE workflow_id = $1 AND step_id = $2 AND state = 'ACTIVE'
      ORDER BY starts_at DESC LIMIT 1
    `, [workflowId, stepId]);
    return result.rows[0] ? workflowResourceReservationFromRow(result.rows[0]) : null;
  }

  async tryReserve(reservation: WorkflowResourceReservationRecord): Promise<WorkflowResourceReservationRecord | null> {
    try {
      const result = await this.database.query<WorkflowResourceReservationRow>(`
        INSERT INTO workflow_resource_reservations (
          reservation_id, workflow_id, step_id, resource_id, starts_at, ends_at, state, released_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [reservation.reservationId, reservation.workflowId, reservation.stepId, reservation.resourceId,
        reservation.startsAt, reservation.endsAt, reservation.state, reservation.releasedAt]);
      return workflowResourceReservationFromRow(result.rows[0]);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23P01") return null;
      throw error;
    }
  }

  async release(reservationId: string, at: Date): Promise<WorkflowResourceReservationRecord | null> {
    const result = await this.database.query<WorkflowResourceReservationRow>(`
      UPDATE workflow_resource_reservations SET state = 'RELEASED', released_at = COALESCE(released_at, $2)
      WHERE reservation_id = $1 RETURNING *
    `, [reservationId, at]);
    return result.rows[0] ? workflowResourceReservationFromRow(result.rows[0]) : null;
  }
}

export class PostgresWorkOrderRepository implements WorkOrderRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async findByExternalReference(externalReference: string): Promise<WorkOrderRecord | null> {
    const result = await this.database.query<WorkOrderRow>("SELECT * FROM work_orders WHERE external_reference = $1", [externalReference]);
    return result.rows[0] ? workOrderFromRow(result.rows[0]) : null;
  }

  async getById(workOrderId: string): Promise<WorkOrderRecord | null> {
    const result = await this.database.query<WorkOrderRow>("SELECT * FROM work_orders WHERE work_order_id = $1", [workOrderId]);
    return result.rows[0] ? workOrderFromRow(result.rows[0]) : null;
  }

  async list(): Promise<WorkOrderRecord[]> {
    const result = await this.database.query<WorkOrderRow>("SELECT * FROM work_orders ORDER BY created_at DESC, work_order_id");
    return result.rows.map(workOrderFromRow);
  }

  async create(workOrder: WorkOrderRecord): Promise<void> {
    await this.database.query(`
      INSERT INTO work_orders (
        work_order_id, external_reference, request, status, selected_robot_id,
        workflow_id, candidates, allocation_attempt_count, next_attempt_at,
        last_attempt_at, failure_reason, lease_owner, lease_expires_at,
        created_at, updated_at, completed_at
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, workOrderValues(workOrder));
  }

  async save(workOrder: WorkOrderRecord): Promise<void> {
    await this.database.query(`
      UPDATE work_orders SET external_reference = $2, request = $3::jsonb,
        status = $4, selected_robot_id = $5, workflow_id = $6,
        candidates = $7::jsonb, allocation_attempt_count = $8,
        next_attempt_at = $9, last_attempt_at = $10, failure_reason = $11,
        lease_owner = $12, lease_expires_at = $13, created_at = $14,
        updated_at = $15, completed_at = $16
      WHERE work_order_id = $1
    `, workOrderValues(workOrder));
  }

  async claimPending(limit: number, options: WorkOrderClaimOptions): Promise<WorkOrderRecord[]> {
    return this.database.transaction(async () => {
      const result = await this.database.query<WorkOrderRow>(`
        WITH candidates AS (
          SELECT work_order_id FROM work_orders
          WHERE status = 'PENDING' AND next_attempt_at <= $2
            AND (lease_expires_at IS NULL OR lease_expires_at <= $2)
          ORDER BY (request->>'priority')::integer DESC, next_attempt_at, work_order_id
          FOR UPDATE SKIP LOCKED LIMIT $1
        )
        UPDATE work_orders AS work_order
        SET lease_owner = $3, lease_expires_at = $2 + ($4 * interval '1 millisecond'), updated_at = $2
        FROM candidates
        WHERE work_order.work_order_id = candidates.work_order_id
        RETURNING work_order.*
      `, [limit, options.claimedAt, options.workerId, options.leaseDurationMs]);
      return result.rows.map(workOrderFromRow);
    });
  }
}

export class PostgresIntegrationEventRepository implements IntegrationEventRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async enqueue(event: IntegrationEventRecord): Promise<void> {
    await this.database.query(`
      INSERT INTO integration_event_outbox (
        event_id, idempotency_key, event_type, aggregate_type, aggregate_id,
        payload, status, attempt_count, occurred_at, next_attempt_at,
        last_attempt_at, delivered_at, last_error, response_status,
        lease_owner, lease_expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, integrationEventValues(event));
  }

  async getById(eventId: string): Promise<IntegrationEventRecord | null> {
    const result = await this.database.query<IntegrationEventRow>("SELECT * FROM integration_event_outbox WHERE event_id=$1", [eventId]);
    return result.rows[0] ? integrationEventFromRow(result.rows[0]) : null;
  }

  async list(filter: IntegrationEventFilter): Promise<IntegrationEventRecord[]> {
    const result = await this.database.query<IntegrationEventRow>(`
      SELECT * FROM integration_event_outbox
      WHERE ($1::text IS NULL OR status=$1)
        AND ($2::text IS NULL OR aggregate_type=$2)
        AND ($3::text IS NULL OR aggregate_id=$3)
      ORDER BY occurred_at DESC, event_id
      LIMIT $4
    `, [filter.status ?? null, filter.aggregateType ?? null, filter.aggregateId ?? null, filter.limit]);
    return result.rows.map(integrationEventFromRow);
  }

  async claimDue(limit: number, options: IntegrationEventClaimOptions): Promise<IntegrationEventRecord[]> {
    const result = await this.database.query<IntegrationEventRow>(`
      WITH claimable AS (
        SELECT event_id FROM integration_event_outbox
        WHERE status='PENDING' AND next_attempt_at <= $1
          AND (lease_expires_at IS NULL OR lease_expires_at <= $1)
        ORDER BY next_attempt_at, occurred_at, event_id
        FOR UPDATE SKIP LOCKED LIMIT $2
      )
      UPDATE integration_event_outbox AS event
      SET lease_owner=$3, lease_expires_at=$4
      FROM claimable WHERE event.event_id=claimable.event_id
      RETURNING event.*
    `, [options.claimedAt, limit, options.workerId, new Date(options.claimedAt.getTime() + options.leaseDurationMs)]);
    return result.rows.map(integrationEventFromRow);
  }

  async recordDelivered(eventId: string, deliveredAt: Date, responseStatus: number): Promise<IntegrationEventRecord | null> {
    const result = await this.database.query<IntegrationEventRow>(`
      UPDATE integration_event_outbox SET status='DELIVERED', attempt_count=attempt_count+1,
        last_attempt_at=$2, delivered_at=$2, last_error=NULL, response_status=$3,
        lease_owner=NULL, lease_expires_at=NULL
      WHERE event_id=$1 AND status='PENDING' RETURNING *
    `, [eventId, deliveredAt, responseStatus]);
    return result.rows[0] ? integrationEventFromRow(result.rows[0]) : null;
  }

  async recordFailure(eventId: string, attemptedAt: Date, nextAttemptAt: Date, error: string, maxAttempts: number, responseStatus?: number): Promise<IntegrationEventRecord | null> {
    const result = await this.database.query<IntegrationEventRow>(`
      UPDATE integration_event_outbox SET
        attempt_count=attempt_count+1,
        status=CASE WHEN attempt_count+1 >= $6 THEN 'DEAD_LETTER' ELSE 'PENDING' END,
        last_attempt_at=$2, next_attempt_at=$3, last_error=$4, response_status=$5,
        lease_owner=NULL, lease_expires_at=NULL
      WHERE event_id=$1 AND status='PENDING' RETURNING *
    `, [eventId, attemptedAt, nextAttemptAt, error, responseStatus ?? null, maxAttempts]);
    return result.rows[0] ? integrationEventFromRow(result.rows[0]) : null;
  }

  async redrive(eventId: string, at: Date): Promise<IntegrationEventRecord | null> {
    const result = await this.database.query<IntegrationEventRow>(`
      UPDATE integration_event_outbox SET status='PENDING', attempt_count=0,
        next_attempt_at=$2, last_error=NULL, response_status=NULL,
        lease_owner=NULL, lease_expires_at=NULL
      WHERE event_id=$1 AND status='DEAD_LETTER' RETURNING *
    `, [eventId, at]);
    return result.rows[0] ? integrationEventFromRow(result.rows[0]) : null;
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

function missionQueueFromRow(row: MissionQueueRow): MissionQueueEntry {
  return {
    missionId: row.mission_id,
    basePriority: row.base_priority,
    effectivePriority: row.effective_priority,
    attemptCount: row.attempt_count,
    enqueuedAt: new Date(row.enqueued_at),
    nextAttemptAt: new Date(row.next_attempt_at),
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    lastError: row.last_error,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
  };
}

function auditEventFromRow(row: AuditEventRow): AuditEventRecord {
  return {
    auditEventId: row.audit_event_id,
    occurredAt: new Date(row.occurred_at),
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    outcome: row.outcome,
    correlationId: row.correlation_id,
    requestMethod: row.request_method,
    requestPath: row.request_path,
    siteId: row.site_id,
    metadata: structuredClone(row.metadata),
  };
}

function alarmFromRow(row: AlarmRow): AlarmRecord {
  return {
    alarmId: `ALARM-${row.alarm_id}`,
    fingerprint: row.fingerprint,
    code: row.alarm_code,
    severity: row.severity,
    status: row.status,
    title: row.title,
    message: row.message,
    sourceType: row.source_type,
    sourceId: row.source_id,
    occurrenceCount: row.occurrence_count,
    firstOccurredAt: new Date(row.first_occurred_at),
    lastOccurredAt: new Date(row.last_occurred_at),
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at) : null,
    acknowledgedBy: row.acknowledged_by,
    acknowledgementNote: row.acknowledgement_note,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
  };
}

function parseAlarmId(alarmId: string): string | null {
  const match = alarmId.match(/^ALARM-(\d+)$/);
  return match?.[1] ?? null;
}

function trafficRestrictionFromRow(row: TrafficRestrictionRow): TrafficRestrictionRecord {
  return {
    restrictionId: `RESTRICTION-${row.restriction_id}`, mapId: row.map_id, resourceId: row.resource_id,
    status: row.status, reason: row.reason, createdBy: row.created_by, createdAt: new Date(row.created_at),
    clearedBy: row.cleared_by, clearedAt: row.cleared_at ? new Date(row.cleared_at) : null,
  };
}

function mapVersionFromRow(row: MapTopologyRow): MapVersionRecord {
  return {
    topology: MapTopology.restore(structuredClone(row.topology)),
    familyId: row.family_id,
    status: row.status,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    publishedBy: row.published_by,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    retiredBy: row.retired_by,
    retiredAt: row.retired_at ? new Date(row.retired_at) : null,
  };
}

function infrastructureResourceFromRow(row: InfrastructureResourceRow): InfrastructureResourceRecord {
  return {
    resourceId: row.resource_id,
    mapId: row.map_id,
    displayName: row.display_name,
    type: row.resource_type,
    status: row.status,
    reservationPolicy: row.reservation_policy,
    edgeId: row.edge_id,
    nodeId: row.node_id,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: new Date(row.updated_at),
    statusReason: row.status_reason,
  };
}

function workflowFromRow(row: WorkflowRow): WorkflowRecord {
  return {
    workflowId: row.workflow_id,
    name: row.name,
    externalReference: row.external_reference,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    failureReason: row.failure_reason,
  };
}

function workflowStepFromRow(row: WorkflowStepRow): WorkflowStepRecord {
  return {
    workflowId: row.workflow_id,
    definition: structuredClone(row.definition),
    status: row.status,
    attemptCount: row.attempt_count,
    missionId: row.mission_id,
    resourceReservationId: row.resource_reservation_id,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    nextAttemptAt: new Date(row.next_attempt_at),
    timeoutAt: row.timeout_at ? new Date(row.timeout_at) : null,
    waitUntil: row.wait_until ? new Date(row.wait_until) : null,
    lastError: row.last_error,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
  };
}

function workflowResourceReservationFromRow(row: WorkflowResourceReservationRow): WorkflowResourceReservationRecord {
  return {
    reservationId: row.reservation_id,
    workflowId: row.workflow_id,
    stepId: row.step_id,
    resourceId: row.resource_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    state: row.state,
    releasedAt: row.released_at ? new Date(row.released_at) : null,
  };
}

function workOrderFromRow(row: WorkOrderRow): WorkOrderRecord {
  return {
    workOrderId: row.work_order_id,
    request: structuredClone(row.request),
    status: row.status,
    selectedRobotId: row.selected_robot_id,
    workflowId: row.workflow_id,
    candidates: structuredClone(row.candidates),
    allocationAttemptCount: row.allocation_attempt_count,
    nextAttemptAt: new Date(row.next_attempt_at),
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    failureReason: row.failure_reason,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

function workOrderValues(record: WorkOrderRecord): unknown[] {
  return [record.workOrderId, record.request.externalReference ?? null, JSON.stringify(record.request), record.status,
    record.selectedRobotId, record.workflowId, JSON.stringify(record.candidates), record.allocationAttemptCount,
    record.nextAttemptAt, record.lastAttemptAt, record.failureReason, record.leaseOwner, record.leaseExpiresAt,
    record.createdAt, record.updatedAt, record.completedAt];
}

function integrationEventFromRow(row: IntegrationEventRow): IntegrationEventRecord {
  return {
    eventId: row.event_id,
    idempotencyKey: row.idempotency_key,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: structuredClone(row.payload),
    status: row.status,
    attemptCount: row.attempt_count,
    occurredAt: new Date(row.occurred_at),
    nextAttemptAt: new Date(row.next_attempt_at),
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
    lastError: row.last_error,
    responseStatus: row.response_status,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at) : null,
  };
}

function integrationEventValues(record: IntegrationEventRecord): unknown[] {
  return [record.eventId, record.idempotencyKey, record.eventType, record.aggregateType, record.aggregateId,
    JSON.stringify(record.payload), record.status, record.attemptCount, record.occurredAt, record.nextAttemptAt,
    record.lastAttemptAt, record.deliveredAt, record.lastError, record.responseStatus, record.leaseOwner,
    record.leaseExpiresAt];
}

function capabilityProfileValues(profile: CapabilityProfileRecord): unknown[] {
  return [profile.profileId, profile.vendor, profile.model, profile.version, profile.displayName, profile.status,
    JSON.stringify(profile.actions), profile.maxPayloadKg, JSON.stringify(profile.allowedZones), JSON.stringify(profile.dimensionsMeters),
    JSON.stringify(profile.supportedFloorTypes), JSON.stringify(profile.attachments), profile.supportsCancellation,
    profile.adapterProtocolVersion, profile.operatorId, profile.createdAt, profile.publishedBy, profile.publishedAt,
    profile.retiredBy, profile.retiredAt];
}

function capabilityProfileFromRow(row: CapabilityProfileRow): CapabilityProfileRecord {
  return { profileId: row.profile_id, vendor: row.vendor, model: row.model, version: row.profile_version,
    displayName: row.display_name, status: row.status, actions: [...row.actions], maxPayloadKg: Number(row.max_payload_kg),
    allowedZones: [...row.allowed_zones], dimensionsMeters: { ...row.dimensions_meters }, supportedFloorTypes: [...row.supported_floor_types],
    attachments: [...row.attachments], supportsCancellation: row.supports_cancellation, adapterProtocolVersion: row.adapter_protocol_version,
    operatorId: row.created_by, createdAt: new Date(row.created_at), publishedBy: row.published_by,
    publishedAt: row.published_at ? new Date(row.published_at) : null, retiredBy: row.retired_by,
    retiredAt: row.retired_at ? new Date(row.retired_at) : null };
}

function workflowStepValues(step: WorkflowStepRecord, updatedAt: Date): unknown[] {
  return [
    step.workflowId,
    step.definition.stepId,
    JSON.stringify(step.definition),
    step.definition.dependsOn,
    step.status,
    step.attemptCount,
    step.missionId,
    step.resourceReservationId,
    step.startedAt,
    step.completedAt,
    step.nextAttemptAt,
    step.timeoutAt,
    step.waitUntil,
    step.lastError,
    step.leaseOwner,
    step.leaseExpiresAt,
    updatedAt,
  ];
}

function familyIdFor(mapId: string): string {
  return mapId.match(/^(.+)@\d+$/)?.[1] ?? mapId;
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
    ...(row.preferred_robot_id ? { preferredRobotId: row.preferred_robot_id } : {}),
    ...(row.robot_constraints ? { robotConstraints: structuredClone(row.robot_constraints) } : {}),
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
    capabilityMetadata: structuredClone(row.capability_metadata ?? {}),
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
