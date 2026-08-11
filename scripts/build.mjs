import { cp, mkdir, rm } from "node:fs/promises";

await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist/server/", import.meta.url), { recursive: true });
await mkdir(new URL("../dist/client/", import.meta.url), { recursive: true });
await cp(new URL("../public/", import.meta.url), new URL("../dist/client/", import.meta.url), { recursive: true });
await cp(new URL("../worker/site-worker.js", import.meta.url), new URL("../dist/server/index.js", import.meta.url));
console.log("BRASH Fleet deployment package is ready.");
