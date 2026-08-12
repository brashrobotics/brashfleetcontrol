import type { Mission, Robot } from "@brash/domain";

export interface MissionRepository {
  getById(missionId: string): Promise<Mission | null>;
  findByExternalReference(externalReference: string): Promise<Mission | null>;
  list(): Promise<Mission[]>;
  save(mission: Mission): Promise<void>;
}

export interface RobotRepository {
  getById(robotId: string): Promise<Robot | null>;
  list(): Promise<Robot[]>;
  save(robot: Robot): Promise<void>;
}

export interface TransactionManager {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}

