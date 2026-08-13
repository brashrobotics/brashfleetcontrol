export const VDA5050_VERSION = "3.0.0" as const;
export const VDA5050_MAJOR_VERSION = "v3" as const;

export interface Vda5050Identity {
  manufacturer: string;
  serialNumber: string;
}

export interface Vda5050Header extends Vda5050Identity {
  headerId: number;
  timestamp: string;
  version: typeof VDA5050_VERSION;
}

export type Vda5050BlockingType = "NONE" | "SOFT" | "SINGLE" | "HARD";

export interface Vda5050ActionParameter {
  key: string;
  value: unknown;
}

export interface Vda5050Action {
  actionType: string;
  actionId: string;
  blockingType: Vda5050BlockingType;
  actionDescriptor?: string;
  actionParameters?: Vda5050ActionParameter[];
}

export interface Vda5050NodePosition {
  x: number;
  y: number;
  mapId: string;
  theta?: number;
}

export interface Vda5050Node {
  nodeId: string;
  sequenceId: number;
  released: boolean;
  actions: Vda5050Action[];
  nodeDescriptor?: string;
  nodePosition?: Vda5050NodePosition;
}

export interface Vda5050Edge {
  edgeId: string;
  sequenceId: number;
  released: boolean;
  actions: Vda5050Action[];
  edgeDescriptor?: string;
}

export interface Vda5050Order extends Vda5050Header {
  orderId: string;
  orderUpdateId: number;
  orderDescription?: string;
  nodes: Vda5050Node[];
  edges: Vda5050Edge[];
}

export type Vda5050ActionStatus = "WAITING" | "INITIALIZING" | "RUNNING" | "RETRIABLE" | "PAUSED" | "FINISHED" | "FAILED";

export interface Vda5050ActionState {
  actionId: string;
  actionType?: string;
  actionStatus: Vda5050ActionStatus;
  actionDescriptor?: string;
  actionResult?: string;
}

export interface Vda5050NodeState {
  nodeId: string;
  sequenceId: number;
  released: boolean;
  nodeDescriptor?: string;
  nodePosition?: Vda5050NodePosition;
}

export interface Vda5050EdgeState {
  edgeId: string;
  sequenceId: number;
  released: boolean;
  edgeDescriptor?: string;
}

export interface Vda5050ErrorReference {
  referenceKey: string;
  referenceValue: string;
}

export interface Vda5050Error {
  errorType: string;
  errorLevel: "WARNING" | "URGENT" | "CRITICAL" | "FATAL";
  errorDescription?: string;
  errorReferences?: Vda5050ErrorReference[];
}

export interface Vda5050MobileRobotPosition {
  x: number;
  y: number;
  theta: number;
  mapId: string;
  localized: boolean;
}

export interface Vda5050PowerSupply {
  stateOfCharge: number;
  charging: boolean;
}

export interface Vda5050SafetyState {
  activeEmergencyStop: "MANUAL" | "REMOTE" | "NONE";
  fieldViolation: boolean;
}

export type Vda5050OperatingMode =
  | "STARTUP"
  | "AUTOMATIC"
  | "SEMIAUTOMATIC"
  | "INTERVENED"
  | "MANUAL"
  | "SERVICE"
  | "TEACH_IN";

export interface Vda5050State extends Vda5050Header {
  orderId: string;
  orderUpdateId: number;
  lastNodeId: string;
  lastNodeSequenceId: number;
  nodeStates: Vda5050NodeState[];
  edgeStates: Vda5050EdgeState[];
  driving: boolean;
  actionStates: Vda5050ActionState[];
  instantActionStates: Vda5050ActionState[];
  powerSupply: Vda5050PowerSupply;
  operatingMode: Vda5050OperatingMode;
  errors: Vda5050Error[];
  safetyState: Vda5050SafetyState;
  mobileRobotPosition: Vda5050MobileRobotPosition;
}

export type Vda5050ConnectionState = "ONLINE" | "OFFLINE" | "HIBERNATING" | "CONNECTION_BROKEN";

export interface Vda5050Connection extends Vda5050Header {
  connectionState: Vda5050ConnectionState;
}

export interface Vda5050InstantActions extends Vda5050Header {
  actions: Vda5050Action[];
}

export interface Vda5050Factsheet extends Vda5050Header {
  typeSpecification?: Record<string, unknown>;
  physicalParameters?: Record<string, unknown>;
  protocolFeatures?: Record<string, unknown>;
  protocolLimits?: Record<string, unknown>;
}
