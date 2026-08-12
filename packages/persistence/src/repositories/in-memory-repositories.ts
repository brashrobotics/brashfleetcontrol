import type {
  MissionRepository,
  RobotRepository,
} from "@brash/application";
import type { Mission, Robot } from "@brash/domain";

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, Mission>();

  async getById(missionId: string): Promise<Mission | null> {
    return this.missions.get(missionId) ?? null;
  }

  async findByExternalReference(externalReference: string): Promise<Mission | null> {
    for (const mission of this.missions.values()) {
      if (mission.externalReference === externalReference) return mission;
    }
    return null;
  }

  async list(): Promise<Mission[]> {
    return [...this.missions.values()].sort((left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime()
      || left.missionId.localeCompare(right.missionId),
    );
  }

  async save(mission: Mission): Promise<void> {
    this.missions.set(mission.missionId, mission);
  }
}

export class InMemoryRobotRepository implements RobotRepository {
  private readonly robots = new Map<string, Robot>();

  async getById(robotId: string): Promise<Robot | null> {
    return this.robots.get(robotId) ?? null;
  }

  async list(): Promise<Robot[]> {
    return [...this.robots.values()].sort((left, right) => left.robotId.localeCompare(right.robotId));
  }

  async save(robot: Robot): Promise<void> {
    this.robots.set(robot.robotId, robot);
  }
}

