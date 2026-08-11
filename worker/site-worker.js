const initialState = {
  robots: [
    { id: "BR-01", name: "Atlas", x: 22, y: 38, heading: 0, battery: 82, status: "moving", mission: "M-1042", target: "Montaj 2", speed: 1.1 },
    { id: "BR-02", name: "Nova", x: 55, y: 31, heading: 90, battery: 64, status: "moving", mission: "M-1043", target: "Kalite", speed: 0.8 },
    { id: "BR-03", name: "Kite", x: 70, y: 63, heading: 180, battery: 26, status: "charging", mission: null, target: "Şarj C-02", speed: 0 },
    { id: "BR-04", name: "Milo", x: 41, y: 69, heading: 270, battery: 91, status: "idle", mission: null, target: "Bekleme B-01", speed: 0 },
    { id: "BR-05", name: "Echo", x: 79, y: 42, heading: 180, battery: 47, status: "blocked", mission: "M-1044", target: "Depo B", speed: 0 },
    { id: "BR-06", name: "Pico", x: 18, y: 74, heading: 90, battery: 73, status: "moving", mission: "M-1041", target: "Pres A", speed: 0.7 },
  ],
  missions: [
    { id: "M-1044", robot: "BR-05", from: "Montaj 1", to: "Depo B", status: "blocked", progress: 42, createdAt: "14:29" },
    { id: "M-1043", robot: "BR-02", from: "Depo A", to: "Kalite", status: "active", progress: 68, createdAt: "14:26" },
    { id: "M-1042", robot: "BR-01", from: "Pres A", to: "Montaj 2", status: "active", progress: 37, createdAt: "14:23" },
    { id: "M-1041", robot: "BR-06", from: "Depo B", to: "Pres A", status: "active", progress: 81, createdAt: "14:18" },
  ],
  alerts: [
    { id: "A-014", level: "warning", robot: "BR-05", message: "Koridor 3 geçici engel", time: "14:32" },
    { id: "A-013", level: "info", robot: "BR-03", message: "Şarj işlemi başladı", time: "14:28" },
  ],
};

let state = structuredClone(initialState);

function snapshot() {
  const phase = Date.now() / 1200;
  return {
    ...state,
    robots: state.robots.map((robot, index) => robot.status === "moving" ? {
      ...robot,
      x: Math.max(10, Math.min(88, robot.x + Math.cos(phase * 0.08 + index) * 0.8)),
      y: Math.max(13, Math.min(83, robot.y + Math.sin(phase * 0.08 + index) * 0.6)),
      heading: Math.round((phase * 4 + index * 55) % 360),
    } : robot),
    updatedAt: new Date().toISOString(),
  };
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, service: "brash-fleet-demo", robots: state.robots.length });
    if (request.method === "GET" && url.pathname === "/api/fleet/snapshot") return json(snapshot());
    if (request.method === "GET" && url.pathname === "/api/fleet/stream") {
      return new Response(`retry: 1200\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/missions") {
      const input = await request.json();
      const robot = state.robots.find((item) => item.id === input.robotId);
      if (!robot || !input.destination) return json({ error: "Robot ve hedef zorunludur." }, 400);
      const mission = { id: `M-${1041 + state.missions.length}`, robot: robot.id, from: robot.target || "Bekleme", to: input.destinationLabel || input.destination, status: "active", progress: 0, createdAt: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) };
      robot.status = "moving";
      robot.mission = mission.id;
      robot.target = mission.to;
      state.missions.unshift(mission);
      return json(mission, 201);
    }
    const action = url.pathname.match(/^\/api\/robots\/([^/]+)\/(stop|resume)$/);
    if (request.method === "POST" && action) {
      const robot = state.robots.find((item) => item.id === action[1]);
      if (!robot) return json({ error: "Robot bulunamadı." }, 404);
      robot.status = action[2] === "stop" ? "stopped" : (robot.mission ? "moving" : "idle");
      robot.speed = action[2] === "stop" ? 0 : 0.6;
      state.alerts.unshift({ id: `A-${15 + state.alerts.length}`, level: action[2] === "stop" ? "critical" : "info", robot: robot.id, message: action[2] === "stop" ? "Operatör güvenli durdurma uyguladı" : "Robot operasyona döndü", time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) });
      return json(robot);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("BRASH Fleet static assets unavailable", { status: 404 });
  },
};
