import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createDevelopmentSystem } from "./bootstrap/create-development-system.js";

const { core, api } = createDevelopmentSystem();
await core.start();

const port = Number(process.env.FLEET_PORT ?? 4273);
const server = createServer(async (incoming, outgoing) => {
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
  await core.stop();
  server.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

server.listen(port, "127.0.0.1", () => {
  console.log(`BRASH Fleet Core ready: http://127.0.0.1:${port}/api/v1/health`);
});
