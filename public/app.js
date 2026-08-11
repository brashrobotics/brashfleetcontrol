const fallbackState = {
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

let state = structuredClone(fallbackState);
let selectedRobotId = "BR-01";
let robotFilter = "all";
let zoom = 1;
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const statusLabels = { moving: "GÖREVDE", idle: "BEKLİYOR", charging: "ŞARJ OLUYOR", blocked: "ENGELLENDİ", stopped: "DURDURULDU" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
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
    marker.setAttribute("aria-label", `${robot.id} ${robot.name}, ${statusLabels[robot.status]}, batarya yüzde ${Math.round(robot.battery)}`);
    marker.classList.toggle("selected", robot.id === selectedRobotId);
    const attention = ["blocked", "stopped"].includes(robot.status);
    marker.classList.toggle("filtered-out", robotFilter !== "all" && !(robotFilter === "moving" ? robot.status === "moving" : attention));
    existing.delete(robot.id);
  }
  for (const orphan of existing.values()) orphan.remove();
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
  $("#detail-mission").textContent = mission?.id || "GÖREV YOK";
  $("#detail-target").textContent = robot.target || "—";
  $("#mission-progress").style.width = `${mission?.progress || 0}%`;
  $("#detail-progress").textContent = mission ? `${Math.round(mission.progress)}% tamamlandı` : "Yeni görev bekleniyor";
  $("#detail-battery").textContent = `${Math.round(robot.battery)}%`;
  $("#battery-progress").style.width = `${robot.battery}%`;
  $("#detail-speed").innerHTML = `${Number(robot.speed).toFixed(1)} <small>m/s</small>`;
  $("#stop-button").textContent = robot.status === "stopped" ? "▶ Operasyona döndür" : "■ Güvenli durdur";
  $("#stop-button").classList.toggle("secondary-button", robot.status === "stopped");
  $("#stop-button").classList.toggle("danger-button", robot.status !== "stopped");
}

function renderMissions() {
  $("#mission-table").innerHTML = state.missions.map((mission) => `
    <tr>
      <td>${escapeHtml(mission.id)}</td>
      <td>${escapeHtml(mission.robot)}</td>
      <td>${escapeHtml(mission.from)}</td>
      <td>${escapeHtml(mission.to)}</td>
      <td><span class="status-badge ${mission.status}">${mission.status === "blocked" ? "Engellendi" : "Aktif"}</span></td>
      <td><span class="table-progress ${mission.status}"><i style="width:${Number(mission.progress)}%"></i></span>${Math.round(mission.progress)}%</td>
      <td>${escapeHtml(mission.createdAt)}</td>
    </tr>`).join("");
}

function renderAlerts() {
  $("#alert-count").textContent = state.alerts.length;
  $("#alert-list").innerHTML = state.alerts.slice(0, 6).map((alert) => `
    <article class="alert-item ${escapeHtml(alert.level)}"><i></i><div><strong>${escapeHtml(alert.robot)} · ${escapeHtml(alert.message)}</strong><p>${alert.level === "critical" ? "Operatör aksiyonu" : alert.level === "warning" ? "Rota yeniden planlanıyor" : "Sistem bildirimi"}</p></div><time>${escapeHtml(alert.time)}</time></article>`).join("") || '<p style="color:var(--muted);font-size:9px;padding:12px 0">Aktif olay bulunmuyor.</p>';
}

function renderKpis() {
  const moving = state.robots.filter((robot) => robot.status === "moving").length;
  const waiting = state.robots.filter((robot) => ["idle", "charging"].includes(robot.status)).length;
  const attention = state.robots.filter((robot) => ["blocked", "stopped"].includes(robot.status)).length;
  $("#active-count").textContent = state.robots.length;
  $("#moving-count").textContent = moving;
  $("#idle-count").textContent = waiting;
  $("#attention-count").textContent = attention;
}

function renderAll() {
  renderRobots();
  renderRobotDetail();
  renderMissions();
  renderAlerts();
  renderKpis();
  $("#last-update").textContent = "şimdi";
}

async function connectFleet() {
  try {
    const response = await fetch("/api/fleet/snapshot");
    if (!response.ok) throw new Error("snapshot unavailable");
    state = await response.json();
    renderAll();
    const source = new EventSource("/api/fleet/stream");
    source.addEventListener("snapshot", (event) => {
      state = JSON.parse(event.data);
      renderAll();
    });
    source.onerror = () => { $(".live-pill").innerHTML = "<i></i> YENİDEN BAĞLANIYOR"; };
    source.onopen = () => { $(".live-pill").innerHTML = "<i></i> CANLI"; };
  } catch {
    renderAll();
    showToast("Demo verisiyle çevrimdışı önizleme");
  }
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "İşlem tamamlanamadı");
  return result;
}

function populateRobotSelect() {
  $("#mission-robot").innerHTML = state.robots
    .filter((robot) => !["stopped", "blocked"].includes(robot.status))
    .map((robot) => `<option value="${escapeHtml(robot.id)}">${escapeHtml(robot.id)} · ${escapeHtml(robot.name)} · ${Math.round(robot.battery)}%</option>`).join("");
}

$("#new-mission-button").addEventListener("click", () => { populateRobotSelect(); $("#mission-dialog").showModal(); });
$("#close-dialog").addEventListener("click", () => $("#mission-dialog").close());
$("#cancel-dialog").addEventListener("click", () => $("#mission-dialog").close());
$("#mission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const destinationSelect = $("#mission-destination");
  const payload = { robotId: $("#mission-robot").value, destination: destinationSelect.value, destinationLabel: destinationSelect.selectedOptions[0].textContent };
  try {
    const mission = await post("/api/missions", payload);
    $("#mission-dialog").close();
    showToast(`${mission.id} görevi başlatıldı`);
  } catch (error) { showToast(error.message); }
});

$("#stop-button").addEventListener("click", async () => {
  const robot = state.robots.find((item) => item.id === selectedRobotId);
  if (!robot) return;
  const action = robot.status === "stopped" ? "resume" : "stop";
  if (action === "stop" && !confirm(`${robot.id} güvenli şekilde durdurulsun mu?`)) return;
  try {
    await post(`/api/robots/${robot.id}/${action}`);
    showToast(action === "stop" ? `${robot.id} durduruldu` : `${robot.id} operasyona döndü`);
  } catch (error) { showToast(error.message); }
});

$("#locate-button").addEventListener("click", () => {
  zoom = 1.18;
  $("#factory-map").style.transform = `scale(${zoom})`;
  const marker = document.querySelector(`.robot-marker[data-id="${selectedRobotId}"]`);
  marker?.focus();
  showToast(`${selectedRobotId} haritada işaretlendi`);
});
$("#close-detail").addEventListener("click", () => { $("#robot-detail").hidden = true; });

$$('[data-filter]').forEach((button) => button.addEventListener("click", () => {
  robotFilter = button.dataset.filter;
  $$('[data-filter]').forEach((item) => item.classList.toggle("active", item === button));
  renderRobots();
}));

$("#layers-button").addEventListener("click", () => { $("#layer-popover").hidden = !$("#layer-popover").hidden; });
$("#close-layers").addEventListener("click", () => { $("#layer-popover").hidden = true; });
$$('[data-layer]').forEach((checkbox) => checkbox.addEventListener("change", () => {
  $$(`.map-layer.${checkbox.dataset.layer}`).forEach((element) => { element.hidden = !checkbox.checked; });
}));

function applyZoom(next) { zoom = Math.max(.78, Math.min(1.35, next)); $("#factory-map").style.transform = `scale(${zoom})`; }
$("#zoom-in").addEventListener("click", () => applyZoom(zoom + .1));
$("#zoom-out").addEventListener("click", () => applyZoom(zoom - .1));
$("#fit-map").addEventListener("click", () => applyZoom(1));
$("#collapse-missions").addEventListener("click", () => $("#mission-drawer").classList.toggle("collapsed"));
$("#show-all-missions").addEventListener("click", () => { $("#mission-drawer").classList.remove("collapsed"); $("#mission-drawer").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#clear-events").addEventListener("click", () => { state.alerts = []; renderAlerts(); showToast("Olay görünümü temizlendi"); });
$("#notification-button").addEventListener("click", () => $(".alerts-card").scrollIntoView({ behavior: "smooth", block: "center" }));
$("#plant-select").addEventListener("change", (event) => showToast(`${event.target.value} görünümüne geçildi`));
$$('.rail-item[data-view]').forEach((button) => button.addEventListener("click", () => {
  $$('.rail-item[data-view]').forEach((item) => item.classList.toggle("active", item === button));
  const view = button.dataset.view;
  if (view === "missions") $("#mission-drawer").scrollIntoView({ behavior: "smooth" });
  else if (view === "robots") $("#robot-detail").scrollIntoView({ behavior: "smooth" });
  else if (view === "analytics") showToast("Analiz modülü ikinci sürüm kapsamındadır");
  else $("#map-stage").scrollIntoView({ behavior: "smooth", block: "center" });
}));

setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString("tr-TR", { hour12: false }); }, 1000);
connectFleet();
