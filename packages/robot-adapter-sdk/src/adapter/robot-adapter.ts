import type {
  CommandReceipt,
  MissionCommand,
  RobotAdapterEvent,
  RobotDescriptor,
  RobotStateSnapshot,
} from "@brash/contracts";
import type { AdapterManifest } from "./adapter-manifest.js";

export type RobotAdapterEventHandler = (event: RobotAdapterEvent) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface RobotAdapter {
  readonly adapterId: string;
  readonly manifest: AdapterManifest;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listRobots(): Promise<RobotDescriptor[]>;
  getState(robotId: string): Promise<RobotStateSnapshot>;
  executeMission(command: MissionCommand): Promise<CommandReceipt>;
  cancelMission(robotId: string, commandId: string): Promise<CommandReceipt>;
  subscribe(handler: RobotAdapterEventHandler): Unsubscribe;
}
