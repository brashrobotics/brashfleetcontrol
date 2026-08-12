import type {
  AssignmentDecisionRepository,
  CommandRepository,
  MissionRepository,
  PendingCommand,
  RepositoryReadOptions,
  RobotRepository,
} from "@brash/application";
import type {
  AssignmentDecision,
  CommandReceipt,
  MissionCommand,
} from "@brash/contracts";
import {
  Mission,
  Robot,
  type MissionLocation,
  type MissionState,
  type RobotAvailability,
  type RobotConnection,
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
}

interface CommandRow {
  command_payload: MissionCommand;
  attempt_count: number;
  last_attempt_at: Date | null;
  last_error: string | null;
}

const MISSION_COLUMNS = `
  mission_id, external_reference, priority, required_capabilities, payload_kg,
  pickup, dropoff, state, assigned_robot_id, command_id, failure_reason,
  created_at, updated_at
`;

const ROBOT_COLUMNS = `
  robot_id, display_name, vendor, model, capabilities, max_payload_kg,
  allowed_zones, sequence, observed_at, connection, availability,
  battery_percent, map_id, pose_x, pose_y, pose_yaw, active_mission_id
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
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13
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
        battery_percent, map_id, pose_x, pose_y, pose_yaw, active_mission_id, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18
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
    ]);
  }
}

export class PostgresCommandRepository implements CommandRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async enqueue(command: MissionCommand, createdAt: Date): Promise<void> {
    await this.database.query(`
      INSERT INTO command_outbox (
        command_id, mission_id, robot_id, command_payload, created_at, updated_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $5)
      ON CONFLICT (command_id) DO NOTHING
    `, [command.commandId, command.missionId, command.robotId, JSON.stringify(command), createdAt]);
  }

  async listPending(): Promise<PendingCommand[]> {
    const result = await this.database.query<CommandRow>(`
      SELECT command_payload, attempt_count, last_attempt_at, last_error
      FROM command_outbox
      WHERE status = 'PENDING'
      ORDER BY created_at, command_id
    `);
    return result.rows.map((row) => ({
      command: structuredClone(row.command_payload),
      attemptCount: row.attempt_count,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
      lastError: row.last_error,
    }));
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

  async recordAttemptFailure(commandId: string, reason: string, attemptedAt: Date): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET last_attempt_at = $3,
          last_error = $2,
          updated_at = $3
      WHERE command_id = $1 AND status = 'PENDING'
    `, [commandId, reason, attemptedAt]);
  }

  async recordReceipt(receipt: CommandReceipt): Promise<void> {
    await this.database.query(`
      UPDATE command_outbox
      SET status = $2,
          receipt = $3::jsonb,
          last_error = $4,
          updated_at = $5
      WHERE command_id = $1
    `, [
      receipt.commandId,
      receipt.status,
      JSON.stringify(receipt),
      receipt.reason ?? null,
      new Date(receipt.receivedAt),
    ]);
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

function lockClause(options?: RepositoryReadOptions): string {
  if (!options?.forUpdate) return "";
  return options.skipLocked ? " FOR UPDATE SKIP LOCKED" : " FOR UPDATE";
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
  });
}
