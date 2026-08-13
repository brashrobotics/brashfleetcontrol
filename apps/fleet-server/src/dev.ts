import { createServer } from "node:http";
import { Readable } from "node:stream";
import { loadPersistenceConfig } from "@brash/config";
import { createDevelopmentSystem } from "./bootstrap/create-development-system.js";
import { createPostgresDevelopmentSystem } from "./bootstrap/create-postgres-development-system.js";
import { serveFleetUi } from "./http/static-fleet-ui.js";
import { OutboxRetryWorker } from "./workers/outbox-retry-worker.js";
import { FleetRecoveryWorker } from "./workers/fleet-recovery-worker.js";
import { MissionDispatchWorker } from "./workers/mission-dispatch-worker.js";

const persistenceConfig = loadPersistenceConfig();
const postgresSystem = persistenceConfig.mode === "postgres"
  ? await createPostgresDevelopmentSystem(persistenceConfig.database!)
  : null;
const system = postgresSystem ?? createDevelopmentSystem();
const { core, api } = system;
await core.start();
const outboxWorker = new OutboxRetryWorker(core);
outboxWorker.start();
const recoveryWorker = new FleetRecoveryWorker(core);
recoveryWorker.start();
const dispatchWorker = new MissionDispatchWorker(core);
dispatchWorker.start();

const port = Number(process.env.FLEET_PORT ?? 4273);
const server = createServer(async (incoming, outgoing) => {
  const pathname = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  if ((incoming.method === "GET" || incoming.method === "HEAD") && !pathname.startsWith("/api/")) {
    const response = await serveFleetUi(pathname, incoming.method);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const body = incoming.method === "GET" || incoming.method === "HEAD"
    ? undefined
    : Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    body,
    ...(body ? { duplex: "half" } : {}),
  } as RequestInit);
  const response = await api.fetch(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

async function shutdown(): Promise<void> {
  outboxWorker.stop();
  recoveryWorker.stop();
  dispatchWorker.stop();
  await core.stop();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await postgresSystem?.persistence.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

server.listen(port, "127.0.0.1", () => {
  console.log(
    `BRASH Fleet Control ready (${persistenceConfig.mode}): http://127.0.0.1:${port}`,
  );
});
