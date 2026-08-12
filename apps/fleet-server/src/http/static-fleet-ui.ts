import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const publicDirectory = resolve(process.cwd(), "public");

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

export async function serveFleetUi(pathname: string, method: string): Promise<Response> {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(publicDirectory, requestedPath);
  const isInsidePublicDirectory = candidate === publicDirectory || candidate.startsWith(`${publicDirectory}${sep}`);
  const filePath = isInsidePublicDirectory ? candidate : resolve(publicDirectory, "index.html");

  try {
    const content = await readFile(filePath);
    return new Response(method === "HEAD" ? null : content, {
      headers: {
        "cache-control": "no-cache",
        "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      },
    });
  } catch {
    const content = await readFile(resolve(publicDirectory, "index.html"));
    return new Response(method === "HEAD" ? null : content, {
      headers: {
        "cache-control": "no-cache",
        "content-type": "text/html; charset=utf-8",
      },
    });
  }
}
