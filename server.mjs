import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./public/", import.meta.url));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const destinations = {
  "press-a": { x: 31, y: 23 },
  "assembly-2": { x: 72, y: 26 },
  "quality": { x: 74, y: 71 },
  "warehouse-b": { x: 24, y: 71 },
  "charging": { x: 49, y: 82 },
};

export function createInitialState() {
  return {
    robots: [
      { id: "BR-01", name: "Atlas", x: 22, y: 38, heading: 0, battery: 82, status: "moving", mission: "M-1042", target: "Assembly 2", speed: 1.1 },
      { id: "BR-02", name: "Nova", x: 55, y: 31, heading: 90, battery: 64, status: "moving", mission: "M-1043", target: "Quality", speed: 0.8 },
      { id: "BR-03", name: "Kite", x: 70, y: 63, heading: 180, battery: 26, status: "charging", mission: null, target: "Charger C-02", speed: 0 },
      { id: "BR-04", name: "Milo", x: 41, y: 69, heading: 270, battery: 91, status: "idle", mission: null, target: "Waiting B-01", speed: 0 },
      { id: "BR-05", name: "Echo", x: 79, y: 42, heading: 180, battery: 47, status: "blocked", mission: "M-1044", target: "Warehouse B", speed: 0 },
      { id: "BR-06", name: "Pico", x: 18, y: 74, heading: 90, battery: 73, status: "moving", mission: "M-1041", target: "Press A", speed: 0.7 },
    ],
    missions: [
      { id: "M-1044", robot: "BR-05", from: "Assembly 1", to: "Warehouse B", status: "blocked", progress: 42, createdAt: "14:29" },
      { id: "M-1043", robot: "BR-02", from: "Warehouse A", to: "Quality", status: "active", progress: 68, createdAt: "14:26" },
      { id: "M-1042", robot: "BR-01", from: "Press A", to: "Assembly 2", status: "active", progress: 37, createdAt: "14:23" },
      { id: "M-1041", robot: "BR-06", from: "Warehouse B", to: "Press A", status: "active", progress: 81, createdAt: "14:18" },
    ],
    alerts: [
      { id: "A-014", level: "warning", robot: "BR-05", message: "Temporary obstruction in Corridor 3", time: "14:32" },
      { id: "A-013", level: "info", robot: "BR-03", message: "Charging started", time: "14:28" },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createFleetServer(state = createInitialState()) {
  const streams = new Set();
  let tick = 0;

  const sendSnapshot = () => {
    state.updatedAt = new Date().toISOString();
    const payload = `event: snapshot\ndata: ${JSON.stringify(state)}\n\n`;
    for (const res of streams) res.write(payload);
  };

  const timer = setInterval(() => {
    tick += 1;
    for (const [index, robot] of state.robots.entries()) {
      if (robot.status !== "moving") continue;
      const angle = (tick * 0.075) + (index * 1.9);
      robot.x = Math.max(10, Math.min(88, robot.x + Math.cos(angle) * 0.18));
      robot.y = Math.max(13, Math.min(83, robot.y + Math.sin(angle) * 0.13));
      robot.heading = Math.round((angle * 180 / Math.PI) % 360);
      robot.battery = Math.max(8, Math.round((robot.battery - 0.004) * 10) / 10);
    }
    for (const mission of state.missions) {
      if (mission.status === "active") mission.progress = Math.min(99, mission.progress + 0.15);
    }
    sendSnapshot();
  }, 1200);
  timer.unref();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === "GET" && pathname === "/api/health") {
      return json(res, 200, { ok: true, service: "brash-fleet-simulator", robots: state.robots.length });
    }
    if (req.method === "GET" && pathname === "/api/fleet/snapshot") {
      return json(res, 200, state);
    }
    if (req.method === "GET" && pathname === "/api/fleet/stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      streams.add(res);
      res.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (req.method === "POST" && pathname === "/api/missions") {
      try {
        const input = await bodyJson(req);
        const robot = state.robots.find((item) => item.id === input.robotId);
        if (!robot || !input.destination) return json(res, 400, { error: "Robot and destination are required." });
        if (robot.status === "stopped") return json(res, 409, { error: "A mission cannot be assigned to a stopped robot." });
        const destination = destinations[input.destination] || { x: robot.x, y: robot.y };
        const id = `M-${1041 + state.missions.length}`;
        const mission = {
          id,
          robot: robot.id,
          from: robot.target || "Waiting",
          to: input.destinationLabel || input.destination,
          status: "active",
          progress: 0,
          createdAt: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        };
        robot.status = "moving";
        robot.mission = id;
        robot.target = mission.to;
        robot.x += (destination.x - robot.x) * 0.02;
        robot.y += (destination.y - robot.y) * 0.02;
        state.missions.unshift(mission);
        sendSnapshot();
        return json(res, 201, mission);
      } catch {
        return json(res, 400, { error: "Invalid mission data." });
      }
    }
    const robotAction = pathname.match(/^\/api\/robots\/([^/]+)\/(stop|resume)$/);
    if (req.method === "POST" && robotAction) {
      const [, robotId, action] = robotAction;
      const robot = state.robots.find((item) => item.id === robotId);
      if (!robot) return json(res, 404, { error: "Robot not found." });
      robot.status = action === "stop" ? "stopped" : (robot.mission ? "moving" : "idle");
      robot.speed = action === "stop" ? 0 : 0.6;
      state.alerts.unshift({
        id: `A-${String(15 + state.alerts.length).padStart(3, "0")}`,
        level: action === "stop" ? "critical" : "info",
        robot: robot.id,
        message: action === "stop" ? "Operator requested a controlled stop" : "Robot returned to operation",
        time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      });
      sendSnapshot();
      return json(res, 200, robot);
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });

    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = normalize(join(root, requested));
    if (!filePath.startsWith(root)) return json(res, 403, { error: "Forbidden" });
    try {
      const content = await readFile(filePath);
      res.writeHead(200, {
        "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      try {
        const content = await readFile(join(root, "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(content);
      } catch {
        json(res, 404, { error: "Not found" });
      }
    }
  });

  server.on("close", () => {
    clearInterval(timer);
    for (const stream of streams) stream.end();
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 4173);
  const server = createFleetServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`BRASH Fleet ready: http://127.0.0.1:${port}`);
  });
}
