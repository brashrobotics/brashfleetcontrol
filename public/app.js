const fallbackTopology = {
  mapId: "plant-a@1",
  displayName: "BRASH Demo Plant · Floor 01",
  revision: 1,
  nodes: [
    { nodeId: "N-WAREHOUSE-A", label: "Warehouse A", kind: "STATION", stationId: "WAREHOUSE-A", x: 10, y: 5 },
    { nodeId: "N-NORTH-WEST", label: "North-west junction", kind: "INTERSECTION", x: 40, y: 5 },
    { nodeId: "N-NORTH-EAST", label: "North-east junction", kind: "INTERSECTION", x: 70, y: 5 },
    { nodeId: "N-ASSEMBLY-02", label: "Assembly 2", kind: "STATION", stationId: "ASSEMBLY-02", x: 72, y: 24 },
    { nodeId: "N-CENTER", label: "Central crossing", kind: "INTERSECTION", x: 46, y: 24 },
    { nodeId: "N-PRESS-A", label: "Press A", kind: "STATION", stationId: "PRESS-A", x: 30, y: 23 },
    { nodeId: "N-SOUTH-CENTER", label: "South crossing", kind: "INTERSECTION", x: 50, y: 65 },
    { nodeId: "N-WAREHOUSE-B", label: "Warehouse B", kind: "STATION", stationId: "WAREHOUSE-B", x: 24, y: 71 },
    { nodeId: "N-QUALITY", label: "Quality", kind: "STATION", stationId: "QUALITY", x: 73, y: 74 },
    { nodeId: "N-CHARGER-C-02", label: "Charger C-02", kind: "STATION", stationId: "CHARGER-C-02", x: 50, y: 84 },
  ],
  edges: [
    ["E-NORTH-01", "N-WAREHOUSE-A", "N-NORTH-WEST"], ["E-NORTH-02", "N-NORTH-WEST", "N-NORTH-EAST"],
    ["E-ASSEMBLY-IN", "N-NORTH-EAST", "N-ASSEMBLY-02"], ["E-CENTER-EAST", "N-ASSEMBLY-02", "N-CENTER"],
    ["E-CENTER-NORTH", "N-CENTER", "N-NORTH-WEST"], ["E-PRESS-IN", "N-CENTER", "N-PRESS-A"],
    ["E-CENTER-SOUTH", "N-CENTER", "N-SOUTH-CENTER"], ["E-WAREHOUSE-B-IN", "N-SOUTH-CENTER", "N-WAREHOUSE-B"],
    ["E-QUALITY-IN", "N-SOUTH-CENTER", "N-QUALITY"], ["E-CHARGER-IN", "N-SOUTH-CENTER", "N-CHARGER-C-02"],
    ["E-EAST-BYPASS", "N-ASSEMBLY-02", "N-QUALITY"],
  ].map(([edgeId, fromNodeId, toNodeId]) => ({ edgeId, fromNodeId, toNodeId, directed: false, lengthMeters: 20, travelTimeSeconds: 18 })),
};

const fallbackState = {
  robots: [
    { id: "BR-01", name: "Atlas", x: 22, y: 38, heading: 0, battery: 82, status: "moving", mission: "M-1042", target: "Assembly 2", speed: 1.1, capabilities: ["pallet_transport"], mapId: "plant-a@1", rawPose: { x: 22, y: 38 } },
    { id: "BR-02", name: "Nova", x: 55, y: 31, heading: 90, battery: 64, status: "moving", mission: "M-1043", target: "Quality", speed: 0.8, capabilities: ["box_transport"], mapId: "plant-a@1", rawPose: { x: 55, y: 31 } },
    { id: "BR-03", name: "Kite", x: 70, y: 63, heading: 180, battery: 26, status: "charging", mission: null, target: "Charger C-02", speed: 0, capabilities: ["pallet_transport"], mapId: "plant-a@1", rawPose: { x: 70, y: 63 } },
  ],
  missions: [],
  alerts: [],
  topology: structuredClone(fallbackTopology),
  traffic: { mapId: "plant-a@1", plans: [], reservations: [], updatedAt: new Date().toISOString() },
};

const destinationStations = {
  "press-a": { stationId: "PRESS-A", label: "Press A", x: 30, y: 23, zoneId: "production" },
  "assembly-2": { stationId: "ASSEMBLY-02", label: "Assembly 2", x: 72, y: 24, zoneId: "production" },
  quality: { stationId: "QUALITY", label: "Quality", x: 73, y: 74, zoneId: "quality" },
  "warehouse-b": { stationId: "WAREHOUSE-B", label: "Warehouse B", x: 24, y: 71, zoneId: "warehouse" },
  charging: { stationId: "CHARGER-C-02", label: "Charger C-02", x: 50, y: 84, zoneId: "warehouse" },
};

let state = structuredClone(fallbackState);
let selectedRobotId = "BR-01";
let robotFilter = "all";
let zoom = 1;
let toastTimer;
let fleetMode = "preview";
let pollTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const statusLabels = { moving: "ON MISSION", idle: "IDLE", charging: "CHARGING", blocked: "NEEDS ATTENTION", stopped: "OFFLINE" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function clampMapCoordinate(value, minimum = 8, maximum = 92) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 50));
}

function coreRobotStatus(robot) {
  if (robot.state.connection !== "ONLINE") return "stopped";
  if (robot.state.availability === "CHARGING") return "charging";
  if (["ERROR", "MANUAL"].includes(robot.state.availability)) return "blocked";
  if (["RESERVED", "EXECUTING"].includes(robot.state.availability)) return "moving";
  return "idle";
}

function missionStatus(stateName) {
  if (["FAILED", "CANCELLED"].includes(stateName)) return "blocked";
  if (["COMPLETED"].includes(stateName)) return "completed";
  if (stateName === "QUEUED") return "queued";
  return "active";
}

function missionProgress(stateName) {
  return ({ QUEUED: 5, ASSIGNED: 15, DISPATCHED: 35, EXECUTING: 65, CANCELLING: 80, COMPLETED: 100, FAILED: 0, CANCELLED: 0 })[stateName] ?? 0;
}

function adaptCoreSnapshot(snapshot, topology, traffic) {
  const activeMissions = new Map(snapshot.missions.filter((mission) => mission.assignedRobotId).map((mission) => [mission.assignedRobotId, mission]));
  const routesByMission = new Map(traffic.plans.map((plan) => [plan.missionId, plan]));
  return {
    robots: snapshot.robots.map((robot) => {
      const mission = activeMissions.get(robot.robotId);
      return {
        id: robot.robotId,
        name: robot.displayName,
        x: clampMapCoordinate(robot.state.pose.x),
        y: clampMapCoordinate(robot.state.pose.y),
        heading: robot.state.pose.yaw,
        battery: robot.state.batteryPercent,
        status: coreRobotStatus(robot),
        mission: mission?.missionId ?? null,
        target: mission?.dropoff.stationId ?? "Ready for dispatch",
        speed: robot.state.availability === "EXECUTING" ? 0.8 : 0,
        capabilities: robot.capabilities.actions,
        mapId: robot.state.pose.mapId,
        rawPose: { x: robot.state.pose.x, y: robot.state.pose.y },
      };
    }),
    missions: snapshot.missions.map((mission) => ({
      id: mission.missionId,
      robot: mission.assignedRobotId ?? "Unassigned",
      from: mission.pickup.stationId,
      to: mission.dropoff.stationId,
      status: missionStatus(mission.state),
      state: mission.state,
      progress: missionProgress(mission.state),
      route: routesByMission.get(mission.missionId) ?? null,
      createdAt: new Date(mission.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    })),
    alerts: snapshot.missions
      .filter((mission) => mission.state === "FAILED")
      .map((mission) => ({ id: mission.missionId, level: "critical", robot: mission.assignedRobotId ?? "FLEET", message: mission.failureReason ?? "Mission failed", time: new Date(mission.updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) })),
    topology,
    traffic,
  };
}

function normalizePreviewSnapshot(snapshot) {
  const traffic = buildPreviewTraffic(snapshot);
  const routesByMission = new Map(traffic.plans.map((plan) => [plan.missionId, plan]));
  return {
    ...snapshot,
    missions: (snapshot.missions ?? []).map((mission) => ({ ...mission, route: routesByMission.get(mission.id) ?? null })),
    topology: snapshot.topology ?? structuredClone(fallbackTopology),
    traffic: snapshot.traffic ?? traffic,
  };
}

function buildPreviewTraffic(snapshot) {
  const now = Date.now();
  const activeMissions = (snapshot.missions ?? []).filter((mission) => mission.status === "active").slice(0, 3);
  const edgeGroups = [
    ["E-NORTH-01", "E-CENTER-NORTH", "E-CENTER-EAST"],
    ["E-CENTER-EAST", "E-CENTER-SOUTH", "E-QUALITY-IN"],
    ["E-WAREHOUSE-B-IN", "E-CENTER-SOUTH", "E-PRESS-IN"],
  ];
  const plans = activeMissions.map((mission, index) => {
    const scheduled = new Date(now + 5_000 + index * 14_000);
    const edges = edgeGroups[index % edgeGroups.length];
    const segments = edges.map((edgeId, segmentIndex) => ({
      sequence: segmentIndex + 1,
      phase: segmentIndex === 0 ? "TO_PICKUP" : "TO_DROPOFF",
      edgeId,
      fromNodeId: "preview",
      toNodeId: "preview",
      lengthMeters: 20,
      enterAt: new Date(scheduled.getTime() + segmentIndex * 18_000).toISOString(),
      exitAt: new Date(scheduled.getTime() + (segmentIndex + 1) * 18_000).toISOString(),
    }));
    return {
      routeId: `ROUTE-${mission.id}`,
      missionId: mission.id,
      robotId: mission.robot,
      mapId: "plant-a@1",
      status: "ACTIVE",
      scheduledStartAt: scheduled.toISOString(),
      expectedArrivalAt: new Date(scheduled.getTime() + edges.length * 18_000).toISOString(),
      totalDistanceMeters: edges.length * 20,
      totalWaitSeconds: index * 14,
      segments,
    };
  });
  return {
    mapId: "plant-a@1",
    updatedAt: new Date(now).toISOString(),
    plans,
    reservations: plans.flatMap((plan) => plan.segments.map((segment) => ({
      reservationId: `${plan.routeId}:${segment.edgeId}`,
      routeId: plan.routeId,
      missionId: plan.missionId,
      robotId: plan.robotId,
      mapId: plan.mapId,
      resourceId: `edge:${segment.edgeId}`,
      resourceType: "EDGE",
      startsAt: segment.enterAt,
      endsAt: new Date(new Date(segment.exitAt).getTime() + 1_000).toISOString(),
      state: "ACTIVE",
    }))),
  };
}

function missionForRobot(id) {
  return state.missions.find((mission) => mission.robot === id && ["active", "blocked"].includes(mission.status));
}

function renderRobots() {
  const layer = $("#robot-layer");
  const existing = new Map($$(".robot-marker").map((node) => [node.dataset.id, node]));
  for (const robot of state.robots) {
    let marker = existing.get(robot.id);
    if (!marker) {
      marker = document.createElement("button");
      marker.className = "robot-marker";
      marker.dataset.id = robot.id;
      marker.innerHTML = '<span class="robot-body"></span><span class="robot-label"></span>';
      marker.addEventListener("click", () => selectRobot(robot.id));
      layer.appendChild(marker);
    }
    marker.dataset.status = robot.status;
    marker.style.setProperty("--x", robot.x);
    marker.style.setProperty("--y", robot.y);
    marker.style.setProperty("--heading", robot.heading);
    marker.querySelector(".robot-label").textContent = `${robot.id} · ${Math.round(robot.battery)}%`;
    marker.setAttribute("aria-label", `${robot.id} ${robot.name}, ${statusLabels[robot.status]}, battery ${Math.round(robot.battery)} percent`);
    marker.classList.toggle("selected", robot.id === selectedRobotId);
    const attention = ["blocked", "stopped"].includes(robot.status);
    marker.classList.toggle("filtered-out", robotFilter !== "all" && !(robotFilter === "moving" ? robot.status === "moving" : attention));
    existing.delete(robot.id);
  }
  for (const orphan of existing.values()) orphan.remove();
}

function renderTrafficTopology() {
  const topology = state.topology;
  const canvas = $("#traffic-topology-canvas");
  const nodeLayer = $("#topology-node-layer");
  if (!topology || !canvas || !nodeLayer) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const nodes = new Map(topology.nodes.map((node) => [node.nodeId, node]));
  const reservationsByEdge = new Map();
  for (const reservation of state.traffic?.reservations ?? []) {
    if (reservation.state !== "ACTIVE" || reservation.resourceType !== "EDGE") continue;
    const edgeId = reservation.resourceId.replace(/^edge:/, "");
    const entries = reservationsByEdge.get(edgeId) ?? [];
    entries.push(reservation);
    reservationsByEdge.set(edgeId, entries);
  }
  const point = (node) => ({ x: rect.width * node.x / 100, y: rect.height * node.y / 100 });

  for (const edge of topology.edges) {
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from || !to) continue;
    const start = point(from);
    const end = point(to);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = "rgba(96, 130, 109, .52)";
    context.lineWidth = 1;
    context.setLineDash([4, 5]);
    context.stroke();

    const reservations = reservationsByEdge.get(edge.edgeId) ?? [];
    if (!reservations.length) continue;
    const isUpcoming = reservations.every((reservation) => new Date(reservation.startsAt).getTime() > Date.now());
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = isUpcoming ? "rgba(242, 184, 75, .95)" : "rgba(200, 240, 61, .95)";
    context.lineWidth = 4;
    context.setLineDash([]);
    context.shadowBlur = 10;
    context.shadowColor = isUpcoming ? "rgba(242, 184, 75, .45)" : "rgba(200, 240, 61, .45)";
    context.stroke();
    context.shadowBlur = 0;
  }

  nodeLayer.innerHTML = topology.nodes.map((node) => `
    <span class="topology-node ${node.kind === "STATION" ? "station-node stations" : "junction-node"}" style="--x:${Number(node.x)};--y:${Number(node.y)}" title="${escapeHtml(node.label)}">
      <i></i>${node.kind === "STATION" ? `<b>${escapeHtml(node.label)}</b>` : ""}
    </span>`).join("");
}

function renderTrafficSchedule() {
  const plans = (state.traffic?.plans ?? []).filter((plan) => plan.status === "ACTIVE");
  const reservations = (state.traffic?.reservations ?? []).filter((reservation) => reservation.state === "ACTIVE");
  $("#active-route-count").textContent = plans.length;
  $("#reserved-resource-count").textContent = new Set(reservations.map((reservation) => reservation.resourceId)).size;
  $("#traffic-delay").textContent = `${Math.round(Math.max(0, ...plans.map((plan) => plan.totalWaitSeconds ?? 0)))}s`;
  $("#traffic-plan-list").innerHTML = plans
    .sort((left, right) => new Date(left.scheduledStartAt) - new Date(right.scheduledStartAt))
    .slice(0, 4)
    .map((plan) => `
      <article class="traffic-plan ${plan.totalWaitSeconds > 0 ? "delayed" : ""}">
        <i></i><div><strong>${escapeHtml(plan.robotId)}</strong><p>${escapeHtml(plan.routeId)}</p></div>
        <div><time>${escapeHtml(formatShortTime(plan.scheduledStartAt))}</time><small>${plan.totalWaitSeconds > 0 ? `+${Math.round(plan.totalWaitSeconds)}s wait` : "reserved"}</small></div>
      </article>`).join("") || '<p class="traffic-empty">No active traffic reservations.</p>';
}

function formatShortTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function selectRobot(id) {
  selectedRobotId = id;
  $("#robot-detail").hidden = false;
  renderRobots();
  renderRobotDetail();
}

function renderRobotDetail() {
  const robot = state.robots.find((item) => item.id === selectedRobotId) || state.robots[0];
  if (!robot) return;
  const mission = missionForRobot(robot.id);
  $("#detail-name").textContent = robot.name;
  $("#detail-id").textContent = robot.id;
  $("#detail-status").textContent = statusLabels[robot.status] || robot.status;
  $("#detail-status-dot").style.color = robot.status === "blocked" ? "var(--amber)" : robot.status === "stopped" ? "var(--red)" : robot.status === "charging" ? "var(--cyan)" : robot.status === "idle" ? "var(--blue)" : "var(--acid)";
  $("#detail-mission").textContent = mission?.id || "NO MISSION";
  $("#detail-origin").textContent = mission?.from || "—";
  $("#detail-target").textContent = robot.target || "—";
  $("#mission-progress").style.width = `${mission?.progress || 0}%`;
  $("#detail-progress").textContent = mission ? `${Math.round(mission.progress)}% complete` : "Waiting for a new mission";
  $("#detail-battery").textContent = `${Math.round(robot.battery)}%`;
  $("#battery-progress").style.width = `${robot.battery}%`;
  $("#detail-speed").innerHTML = `${Number(robot.speed).toFixed(1)} <small>m/s</small>`;
  const isCore = fleetMode === "core";
  $("#stop-button").textContent = isCore ? "■ Controlled stop unavailable" : robot.status === "stopped" ? "▶ Resume operation" : "■ Controlled stop";
  $("#stop-button").classList.toggle("secondary-button", isCore || robot.status === "stopped");
  $("#stop-button").classList.toggle("danger-button", !isCore && robot.status !== "stopped");
}

function renderMissions() {
  $("#mission-table").innerHTML = state.missions.map((mission) => `
    <tr class="mission-row" data-mission-id="${escapeHtml(mission.id)}" tabindex="0" aria-label="Open timeline for mission ${escapeHtml(mission.id)}">
      <td>${escapeHtml(mission.id)}</td>
      <td>${escapeHtml(mission.robot)}</td>
      <td>${escapeHtml(mission.from)}</td>
      <td>${escapeHtml(mission.to)}</td>
      <td><span class="status-badge ${mission.status}">${escapeHtml(mission.state ?? mission.status)}</span></td>
      <td><span class="table-progress ${mission.status}"><i style="width:${Number(mission.progress)}%"></i></span>${Math.round(mission.progress)}%</td>
      <td><span class="traffic-slot ${mission.route?.totalWaitSeconds > 0 ? "delayed" : ""}">${mission.route ? escapeHtml(formatShortTime(mission.route.scheduledStartAt)) : "—"}</span></td>
      <td>${escapeHtml(mission.createdAt)}</td>
    </tr>`).join("") || '<tr><td colspan="8" style="color:var(--muted)">No missions yet. Create the first transport mission.</td></tr>';
}

function formatEventType(type) {
  return String(type).toLowerCase().split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

async function showMissionTimeline(missionId) {
  if (fleetMode !== "core") {
    showToast("Mission timelines are available when Fleet Core is connected");
    return;
  }
  const dialog = $("#timeline-dialog");
  $("#timeline-title").textContent = missionId;
  $("#timeline-list").innerHTML = '<p class="timeline-empty">Loading mission events…</p>';
  dialog.showModal();
  try {
    const response = await fetch(`/api/v1/missions/${encodeURIComponent(missionId)}/events`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Mission timeline unavailable");
    $("#timeline-list").innerHTML = result.events.map((event) => `
      <article class="timeline-event">
        <i></i>
        <div>
          <div class="timeline-event-head"><strong>${escapeHtml(formatEventType(event.type))}</strong><span>${escapeHtml(event.state)}</span></div>
          <p>${escapeHtml(event.message)}</p>
          <small>${escapeHtml(event.robotId || "Fleet Core")}${event.commandId ? ` · ${escapeHtml(event.commandId)}` : ""}</small>
        </div>
        <time>${escapeHtml(new Date(event.occurredAt).toLocaleString("en-GB"))}</time>
      </article>`).join("") || '<p class="timeline-empty">No events have been recorded for this mission.</p>';
  } catch (error) {
    $("#timeline-list").innerHTML = `<p class="timeline-empty">${escapeHtml(error.message)}</p>`;
  }
}

function renderAlerts() {
  $("#alert-count").textContent = state.alerts.length;
  $("#alert-list").innerHTML = state.alerts.slice(0, 6).map((alert) => `
    <article class="alert-item ${escapeHtml(alert.level)}"><i></i><div><strong>${escapeHtml(alert.robot)} · ${escapeHtml(alert.message)}</strong><p>${alert.level === "critical" ? "Operator action required" : alert.level === "warning" ? "Route needs attention" : "System notification"}</p></div><time>${escapeHtml(alert.time)}</time></article>`).join("") || '<p style="color:var(--muted);font-size:9px;padding:12px 0">No active events.</p>';
}

function renderKpis() {
  const moving = state.robots.filter((robot) => robot.status === "moving").length;
  const waiting = state.robots.filter((robot) => ["idle", "charging"].includes(robot.status)).length;
  const attention = state.robots.filter((robot) => ["blocked", "stopped"].includes(robot.status)).length;
  $("#active-count").textContent = state.robots.length;
  $("#online-count").textContent = state.robots.filter((robot) => robot.status !== "stopped").length;
  $("#moving-count").textContent = moving;
  $("#idle-count").textContent = waiting;
  $("#attention-count").textContent = attention;
  $("#attention-note").textContent = attention ? "Review robot state" : "Fleet nominal";
  $(".segmented [data-filter='all'] b").textContent = state.robots.length;
}

function renderAll() {
  if (!state.robots.some((robot) => robot.id === selectedRobotId)) selectedRobotId = state.robots[0]?.id ?? "";
  renderRobots();
  renderRobotDetail();
  renderMissions();
  renderAlerts();
  renderKpis();
  renderTrafficTopology();
  renderTrafficSchedule();
  $("#last-update").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function refreshCoreSnapshot() {
  const response = await fetch("/api/v1/fleet/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error("Fleet Core snapshot unavailable");
  const snapshot = await response.json();
  const mapId = snapshot.robots[0]?.state?.pose?.mapId ?? snapshot.missions[0]?.pickup?.mapId ?? "plant-a@1";
  const [topologyResponse, scheduleResponse] = await Promise.all([
    fetch(`/api/v1/maps/${encodeURIComponent(mapId)}/topology`, { cache: "no-store" }),
    fetch(`/api/v1/traffic/schedule?mapId=${encodeURIComponent(mapId)}`, { cache: "no-store" }),
  ]);
  if (!topologyResponse.ok || !scheduleResponse.ok) throw new Error("Traffic scheduler state unavailable");
  const [{ topology }, { schedule }] = await Promise.all([topologyResponse.json(), scheduleResponse.json()]);
  state = adaptCoreSnapshot(snapshot, topology, schedule);
  renderAll();
}

async function connectFleet() {
  try {
    const health = await fetch("/api/v1/health", { cache: "no-store" });
    if (health.ok) {
      fleetMode = "core";
      await refreshCoreSnapshot();
      pollTimer = setInterval(() => void refreshCoreSnapshot().catch(() => { $(".live-pill").innerHTML = "<i></i> RECONNECTING"; }), 2_000);
      $(".live-pill").innerHTML = "<i></i> LIVE CORE";
      return;
    }

    const response = await fetch("/api/fleet/snapshot");
    if (!response.ok) throw new Error("snapshot unavailable");
    state = normalizePreviewSnapshot(await response.json());
    renderAll();
    const source = new EventSource("/api/fleet/stream");
    source.addEventListener("snapshot", (event) => { state = normalizePreviewSnapshot(JSON.parse(event.data)); renderAll(); });
    source.onerror = () => { $(".live-pill").innerHTML = "<i></i> RECONNECTING"; };
    source.onopen = () => { $(".live-pill").innerHTML = "<i></i> LIVE DEMO"; };
  } catch {
    renderAll();
    showToast("Fleet API unavailable; showing preview data");
  }
}

async function post(path, payload) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.error || "The operation could not be completed");
  return result;
}

function populateRobotSelect() {
  const candidates = state.robots.filter((robot) => robot.status === "idle");
  $("#mission-robot").innerHTML = candidates.map((robot) => `<option value="${escapeHtml(robot.id)}">${escapeHtml(robot.id)} · ${escapeHtml(robot.name)} · ${Math.round(robot.battery)}%</option>`).join("");
  if (!candidates.length) showToast("No available robot is ready for a new mission");
}

$("#new-mission-button").addEventListener("click", () => { populateRobotSelect(); if ($("#mission-robot").options.length) $("#mission-dialog").showModal(); });
$("#close-dialog").addEventListener("click", () => $("#mission-dialog").close());
$("#cancel-dialog").addEventListener("click", () => $("#mission-dialog").close());
$("#close-timeline").addEventListener("click", () => $("#timeline-dialog").close());
$("#mission-table").addEventListener("click", (event) => {
  const row = event.target.closest(".mission-row");
  if (row) void showMissionTimeline(row.dataset.missionId);
});
$("#mission-table").addEventListener("keydown", (event) => {
  const row = event.target.closest(".mission-row");
  if (row && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    void showMissionTimeline(row.dataset.missionId);
  }
});
$("#mission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedRobot = state.robots.find((robot) => robot.id === $("#mission-robot").value);
  const destination = destinationStations[$("#mission-destination").value];
  if (!selectedRobot || !destination) return;
  try {
    if (fleetMode === "core") {
      const payload = {
        type: "TRANSPORT",
        externalReference: `UI-${Date.now()}`,
        priority: $("#mission-priority").checked ? 90 : 60,
        requiredCapabilities: selectedRobot.capabilities.length ? [selectedRobot.capabilities[0]] : ["pallet_transport"],
        payloadKg: 0,
        pickup: { stationId: `${selectedRobot.id}-CURRENT`, mapId: selectedRobot.mapId, x: selectedRobot.rawPose.x, y: selectedRobot.rawPose.y },
        dropoff: { ...destination, mapId: selectedRobot.mapId },
      };
      const result = await post("/api/v1/missions", payload);
      $("#mission-dialog").close();
      showToast(`${result.mission.missionId} ${result.mission.state.toLowerCase()}`);
      await refreshCoreSnapshot();
    } else {
      const payload = { robotId: selectedRobot.id, destination: $("#mission-destination").value, destinationLabel: destination.label };
      const mission = await post("/api/missions", payload);
      $("#mission-dialog").close();
      showToast(`${mission.id} started`);
    }
  } catch (error) { showToast(error.message); }
});

$("#stop-button").addEventListener("click", async () => {
  const robot = state.robots.find((item) => item.id === selectedRobotId);
  if (!robot) return;
  if (fleetMode === "core") {
    showToast("Controlled stop requires a robot adapter command API; it is intentionally not simulated here");
    return;
  }
  const action = robot.status === "stopped" ? "resume" : "stop";
  if (action === "stop" && !confirm(`Request a controlled stop for ${robot.id}?`)) return;
  try { await post(`/api/robots/${robot.id}/${action}`); showToast(action === "stop" ? `${robot.id} stopped` : `${robot.id} resumed operation`); } catch (error) { showToast(error.message); }
});

$("#locate-button").addEventListener("click", () => { zoom = 1.18; $("#factory-map").style.transform = `scale(${zoom})`; document.querySelector(`.robot-marker[data-id="${selectedRobotId}"]`)?.focus(); showToast(`${selectedRobotId} highlighted on the map`); });
$("#close-detail").addEventListener("click", () => { $("#robot-detail").hidden = true; });
$$('[data-filter]').forEach((button) => button.addEventListener("click", () => { robotFilter = button.dataset.filter; $$('[data-filter]').forEach((item) => item.classList.toggle("active", item === button)); renderRobots(); }));
$("#layers-button").addEventListener("click", () => { $("#layer-popover").hidden = !$("#layer-popover").hidden; });
$("#close-layers").addEventListener("click", () => { $("#layer-popover").hidden = true; });
$$('[data-layer]').forEach((checkbox) => checkbox.addEventListener("change", () => {
  const selector = checkbox.dataset.layer === "stations" ? ".topology-node.stations" : `.map-layer.${checkbox.dataset.layer}`;
  $$(selector).forEach((element) => { element.hidden = !checkbox.checked; });
}));
function applyZoom(next) { zoom = Math.max(.78, Math.min(1.35, next)); $("#factory-map").style.transform = `scale(${zoom})`; }
$("#zoom-in").addEventListener("click", () => applyZoom(zoom + .1));
$("#zoom-out").addEventListener("click", () => applyZoom(zoom - .1));
$("#fit-map").addEventListener("click", () => applyZoom(1));
$("#collapse-missions").addEventListener("click", () => $("#mission-drawer").classList.toggle("collapsed"));
$("#show-all-missions").addEventListener("click", () => { $("#mission-drawer").classList.remove("collapsed"); $("#mission-drawer").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#clear-events").addEventListener("click", () => { state.alerts = []; renderAlerts(); showToast("Event view cleared"); });
$("#notification-button").addEventListener("click", () => $(".alerts-card").scrollIntoView({ behavior: "smooth", block: "center" }));
$("#plant-select").addEventListener("change", (event) => showToast(`Switched to ${event.target.value}`));
$$('.rail-item[data-view]').forEach((button) => button.addEventListener("click", () => { $$('.rail-item[data-view]').forEach((item) => item.classList.toggle("active", item === button)); const view = button.dataset.view; if (view === "missions") $("#mission-drawer").scrollIntoView({ behavior: "smooth" }); else if (view === "robots") $("#robot-detail").scrollIntoView({ behavior: "smooth" }); else if (view === "analytics") showToast("The analytics module is planned for the second release"); else $("#map-stage").scrollIntoView({ behavior: "smooth", block: "center" }); }));
setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false }); }, 1000);
window.addEventListener("resize", () => renderTrafficTopology());
window.addEventListener("beforeunload", () => clearInterval(pollTimer));
connectFleet();
