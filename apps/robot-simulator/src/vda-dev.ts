import { resolveSecret } from "@brash/config";
import { MqttJsTransport } from "@brash/mqtt-adapter";
import { vda5050Topic } from "@brash/vda5050-adapter";
import { createDefaultEmulatorRobots } from "./fixtures/default-robots.js";
import {
  Vda5050RobotEmulator,
  vda5050BrokenConnectionMessage,
  type Vda5050EmulatedRobot,
} from "./vda5050/vda5050-robot-emulator.js";

const brokerUrl = process.env.ROBOT_EMULATOR_MQTT_URL?.trim() || "mqtt://127.0.0.1:1883";
assertSecureBrokerConfiguration(brokerUrl);
const username = resolveSecret("ROBOT_EMULATOR_MQTT_USERNAME");
const password = resolveSecret("ROBOT_EMULATOR_MQTT_PASSWORD");
const interfaceName = process.env.ROBOT_EMULATOR_VDA_INTERFACE?.trim() || "vda5050";
const robots: Vda5050EmulatedRobot[] = createDefaultEmulatorRobots().map((definition) => {
  const identity = { manufacturer: "BRASH", serialNumber: definition.descriptor.robotId };
  definition.descriptor.model = "VDA5050-EMU-AMR";
  definition.descriptor.capabilities.adapterProtocolVersion = "VDA5050/3.0.0";
  return {
    ...identity,
    definition,
    transport: new MqttJsTransport({
      brokerUrl,
      clientId: `brash-vda-robot-${definition.descriptor.robotId.toLowerCase()}`,
      username,
      password,
      connectTimeoutMs: environmentInteger("ROBOT_EMULATOR_MQTT_CONNECT_TIMEOUT_MS", 10_000, 1),
      reconnectPeriodMs: environmentInteger("ROBOT_EMULATOR_MQTT_RECONNECT_MS", 1_000, 0),
      will: {
        topic: vda5050Topic(identity, "connection", { interfaceName }),
        payload: JSON.stringify(vda5050BrokenConnectionMessage(identity)),
        qos: 1,
        retain: true,
      },
      onError: (error) => console.error(JSON.stringify({
        level: "error",
        event: "vda_robot.mqtt.failed",
        robotId: definition.descriptor.robotId,
        message: error.message,
      })),
    }),
  };
});

const emulator = new Vda5050RobotEmulator({
  robots,
  interfaceName,
  startDelayMs: environmentInteger("ROBOT_EMULATOR_START_DELAY_MS", 500, 0),
  missionDurationMs: environmentInteger("ROBOT_EMULATOR_MISSION_DURATION_MS", 8_000, 1),
  motionUpdateIntervalMs: environmentInteger("ROBOT_EMULATOR_MOTION_INTERVAL_MS", 250, 1),
  heartbeatIntervalMs: environmentInteger("ROBOT_EMULATOR_HEARTBEAT_MS", 1_000, 1),
  onError: (error) => console.error(JSON.stringify({ level: "error", event: "vda_robot_emulator.failed", message: error.message })),
});

await emulator.start();
console.log(`BRASH VDA 5050 v3 Robot Emulator ready (${robots.length} robots): ${redactBrokerUrl(brokerUrl)}`);

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await emulator.stop();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

function environmentInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  return value;
}

function assertSecureBrokerConfiguration(value: string): void {
  const url = new URL(value);
  if (process.env.NODE_ENV === "production"
    && !["mqtts:", "wss:"].includes(url.protocol)
    && process.env.ROBOT_EMULATOR_MQTT_ALLOW_INSECURE !== "true") {
    throw new Error("Production VDA emulator requires mqtts/wss. Use the insecure override only on an isolated development network.");
  }
}

function redactBrokerUrl(value: string): string {
  const url = new URL(value);
  if (url.username) url.username = "redacted";
  if (url.password) url.password = "redacted";
  return url.toString();
}
