import { VDA5050_MAJOR_VERSION, type Vda5050Identity } from "./vda5050-types.js";

export type Vda5050Topic =
  | "order"
  | "instantActions"
  | "state"
  | "connection"
  | "factsheet"
  | "visualization"
  | "zoneSet"
  | "responses";

export interface Vda5050TopicOptions {
  interfaceName?: string;
  majorVersion?: string;
}

export function vda5050Topic(
  identity: Vda5050Identity,
  topic: Vda5050Topic,
  options: Vda5050TopicOptions = {},
): string {
  const interfaceName = options.interfaceName ?? "vda5050";
  const majorVersion = options.majorVersion ?? VDA5050_MAJOR_VERSION;
  for (const [name, value] of [
    ["interfaceName", interfaceName],
    ["majorVersion", majorVersion],
    ["manufacturer", identity.manufacturer],
    ["serialNumber", identity.serialNumber],
  ] as const) assertTopicLevel(value, name);
  return `${interfaceName}/${majorVersion}/${identity.manufacturer}/${identity.serialNumber}/${topic}`;
}

function assertTopicLevel(value: string, name: string): void {
  if (!value.trim() || /[\u0000/+#]/.test(value)) {
    throw new Error(`VDA 5050 ${name} must be one non-empty MQTT topic level without /, +, or #.`);
  }
}
