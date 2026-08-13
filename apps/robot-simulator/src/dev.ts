import { resolveSecret } from "@brash/config";
import { startRobotEmulatorHttpServer } from "./server.js";

const host = process.env.ROBOT_EMULATOR_HOST?.trim() || "127.0.0.1";
const port = environmentInteger("ROBOT_EMULATOR_PORT", 4280, 0);
const emulator = await startRobotEmulatorHttpServer({
  host,
  port,
  bearerToken: resolveSecret("ROBOT_EMULATOR_TOKEN"),
  startDelayMs: environmentInteger("ROBOT_EMULATOR_START_DELAY_MS", 500, 0),
  missionDurationMs: environmentInteger("ROBOT_EMULATOR_MISSION_DURATION_MS", 8_000, 1),
  motionUpdateIntervalMs: environmentInteger("ROBOT_EMULATOR_MOTION_INTERVAL_MS", 250, 1),
  heartbeatIntervalMs: environmentInteger("ROBOT_EMULATOR_HEARTBEAT_MS", 1_000, 1),
  onError: (error) => console.error(JSON.stringify({ level: "error", event: "robot_emulator.run.failed", message: error.message })),
});

console.log(`BRASH Robot Emulator ready: ${emulator.url}`);
console.log(`Control snapshot: ${emulator.url}/control/v1/snapshot`);

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
