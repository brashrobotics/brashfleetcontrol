import { resolveSecret } from "@brash/config";
import { HttpRobotAdapter } from "@brash/http-robot-adapter";
import { MqttJsTransport } from "@brash/mqtt-adapter";
import type { RobotAdapter } from "@brash/robot-adapter-sdk";
import { Vda5050Adapter, type Vda5050RobotConfig } from "@brash/vda5050-adapter";
import { createDevelopmentAdapter } from "./create-development-system.js";

export function createConfiguredRobotAdapter(
  environment: NodeJS.ProcessEnv = process.env,
): RobotAdapter {
  const mode = environment.FLEET_ROBOT_ADAPTER?.trim().toLowerCase() || "simulator";
  if (mode === "simulator") return createDevelopmentAdapter();
  if (mode === "vda5050") return createVda5050Adapter(environment);
  if (mode !== "http") throw new Error(`Unsupported FLEET_ROBOT_ADAPTER ${mode}. Expected simulator, http, or vda5050.`);

  const baseUrl = environment.FLEET_ROBOT_ADAPTER_URL?.trim();
  if (!baseUrl) throw new Error("FLEET_ROBOT_ADAPTER_URL is required when FLEET_ROBOT_ADAPTER=http.");
  return new HttpRobotAdapter({
    baseUrl,
    bearerToken: resolveSecret("FLEET_ROBOT_ADAPTER_TOKEN", environment),
    requestTimeoutMs: environmentInteger(environment, "FLEET_ROBOT_ADAPTER_TIMEOUT_MS", 5_000),
    eventPollIntervalMs: environmentInteger(environment, "FLEET_ROBOT_ADAPTER_POLL_MS", 100),
    allowInsecureHttp: environment.NODE_ENV !== "production" || environment.FLEET_ROBOT_ADAPTER_ALLOW_INSECURE_HTTP === "true",
    onBackgroundError: (error) => {
      console.error(JSON.stringify({ level: "error", event: "robot_adapter.poll.failed", message: error.message }));
    },
  });
}

function createVda5050Adapter(environment: NodeJS.ProcessEnv): RobotAdapter {
  const brokerUrl = environment.FLEET_MQTT_URL?.trim() || "mqtt://127.0.0.1:1883";
  const url = new URL(brokerUrl);
  if (environment.NODE_ENV === "production"
    && !["mqtts:", "wss:"].includes(url.protocol)
    && environment.FLEET_MQTT_ALLOW_INSECURE !== "true") {
    throw new Error("Production VDA adapter requires mqtts/wss. Use FLEET_MQTT_ALLOW_INSECURE only on an isolated development network.");
  }
  const majorVersion = environment.FLEET_VDA_MAJOR_VERSION?.trim() || "v3";
  if (majorVersion !== "v3") throw new Error("This adapter build implements only the VDA 5050 major topic version v3 profile.");
  const siteId = environment.FLEET_SITE_ID?.trim() || "plant-a";
  const transport = new MqttJsTransport({
    brokerUrl,
    clientId: environment.FLEET_MQTT_CLIENT_ID?.trim() || `brash-fleet-${siteId}-${process.pid}`,
    username: resolveSecret("FLEET_MQTT_USERNAME", environment),
    password: resolveSecret("FLEET_MQTT_PASSWORD", environment),
    connectTimeoutMs: environmentInteger(environment, "FLEET_MQTT_CONNECT_TIMEOUT_MS", 10_000),
    reconnectPeriodMs: environmentNonNegativeInteger(environment, "FLEET_MQTT_RECONNECT_MS", 1_000),
    onError: (error) => {
      console.error(JSON.stringify({ level: "error", event: "vda5050.mqtt.failed", message: error.message }));
    },
  });
  return new Vda5050Adapter({
    transport,
    robots: configuredVdaRobots(environment),
    interfaceName: environment.FLEET_VDA_INTERFACE?.trim() || "vda5050",
    majorVersion,
    acknowledgementTimeoutMs: environmentInteger(environment, "FLEET_VDA_ACK_TIMEOUT_MS", 5_000),
    initialStateTimeoutMs: environmentInteger(environment, "FLEET_VDA_INITIAL_STATE_TIMEOUT_MS", 10_000),
    onBackgroundError: (error) => {
      console.error(JSON.stringify({ level: "error", event: "vda5050.message.failed", message: error.message }));
    },
  });
}

function configuredVdaRobots(environment: NodeJS.ProcessEnv): Vda5050RobotConfig[] {
  const json = environment.FLEET_VDA_ROBOTS?.trim();
  if (json) {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      throw new Error("FLEET_VDA_ROBOTS must be valid JSON.");
    }
    if (!Array.isArray(value)) throw new Error("FLEET_VDA_ROBOTS must be a JSON array.");
    return value as Vda5050RobotConfig[];
  }
  return [
    referenceVdaRobot("EMU-01", "Emulator Atlas", ["pallet_transport", "box_transport"], 800),
    referenceVdaRobot("EMU-02", "Emulator Nova", ["box_transport"], 150),
    referenceVdaRobot("EMU-03", "Emulator Kite", ["pallet_transport"], 600),
  ];
}

function referenceVdaRobot(robotId: string, displayName: string, actions: string[], maxPayloadKg: number): Vda5050RobotConfig {
  return {
    manufacturer: "BRASH",
    serialNumber: robotId,
    descriptor: {
      robotId,
      displayName,
      vendor: "BRASH",
      model: "VDA5050-EMU-AMR",
      capabilities: {
        actions,
        maxPayloadKg,
        allowedZones: ["warehouse", "production", "quality"],
        dimensionsMeters: { length: 1.1, width: 0.75, height: 0.45, turningRadius: 0.55 },
        supportedFloorTypes: ["industrial-concrete"],
        supportsCancellation: true,
        adapterProtocolVersion: "VDA5050/3.0.0",
      },
    },
  };
}

function environmentInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function environmentNonNegativeInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
