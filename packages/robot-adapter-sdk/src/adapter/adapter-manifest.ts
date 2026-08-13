export const ROBOT_ADAPTER_SDK_VERSION = "1.0" as const;

export type AdapterProtocol = "SIMULATOR" | "REST" | "MQTT" | "VDA5050" | "CUSTOM" | "COMPOSITE";

export type AdapterFeature =
  | "ROBOT_DISCOVERY"
  | "STATE_POLLING"
  | "STATE_EVENTS"
  | "MISSION_EXECUTION"
  | "MISSION_CANCELLATION"
  | "IDEMPOTENT_COMMANDS";

export interface AdapterManifest {
  sdkVersion: typeof ROBOT_ADAPTER_SDK_VERSION;
  adapterId: string;
  displayName: string;
  adapterVersion: string;
  protocol: AdapterProtocol;
  features: AdapterFeature[];
  vendor?: string;
  supportedFleetSchemaVersions: string[];
}

export interface RobotAdapterFactory<TConfig> {
  readonly manifest: AdapterManifest;
  create(config: TConfig): import("./robot-adapter.js").RobotAdapter;
}

export function assertAdapterManifest(manifest: AdapterManifest): void {
  if (manifest.sdkVersion !== ROBOT_ADAPTER_SDK_VERSION) {
    throw new Error(`Unsupported Robot Adapter SDK version ${manifest.sdkVersion}.`);
  }
  for (const [field, value] of [
    ["adapterId", manifest.adapterId],
    ["displayName", manifest.displayName],
    ["adapterVersion", manifest.adapterVersion],
  ] as const) {
    if (!value.trim()) throw new Error(`Adapter manifest ${field} must not be empty.`);
  }
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(manifest.adapterId)) {
    throw new Error("Adapter manifest adapterId must be a stable lowercase identifier.");
  }
  if (new Set(manifest.features).size !== manifest.features.length) {
    throw new Error("Adapter manifest features must be unique.");
  }
  const required: AdapterFeature[] = [
    "ROBOT_DISCOVERY",
    "STATE_POLLING",
    "STATE_EVENTS",
    "MISSION_EXECUTION",
    "MISSION_CANCELLATION",
    "IDEMPOTENT_COMMANDS",
  ];
  for (const feature of required) {
    if (!manifest.features.includes(feature)) throw new Error(`Adapter manifest is missing required feature ${feature}.`);
  }
  if (manifest.supportedFleetSchemaVersions.length === 0) {
    throw new Error("Adapter manifest must declare at least one Fleet schema version.");
  }
}

