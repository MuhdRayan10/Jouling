const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const SVG_NS = "http://www.w3.org/2000/svg";

const DEMO_TOKENS = {
  "mission-com3-projector": "qr_com3_projector_2026",
  "mission-study-lights": "qr_study_lights_2026",
  "mission-library-ac": "qr_library_ac_2026",
  "mission-utown-screen": "qr_utown_screen_2026",
  "mission-hall-sockets": "qr_hall_sockets_2026",
  "mission-innovation-door": "qr_innovation_door_2026"
};

let appState = null;
let verifierMode = "demo";
let selectedMission = null;
let activeAttempt = null;
let proofDataUrl = null;
let scannerStream = null;
let scannerTimer = null;
let toastTimer = null;

const userId = () => localStorage.getItem("ghostgrid.userId") || "u-demo";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function teamById(teamId) {
  return appState?.teams.find((team) => team.id === teamId);
}

function formatNumber(value, maximumFractionDigits = 1) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits });
}

function missionStatus(mission) {
  if (mission.completedForTeam) return "DONE";
  if (mission.cooldownActive) return "COOLDOWN";
  return mission.active ? "OPEN" : "LOCKED";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function timeAgo(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function showToast(message, icon = "✓") {
  clearTimeout(toastTimer);
  $("#toastIcon").textContent = icon;
  $("#toastText").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3000);
}

function navigate(view) {
  stopScanner();
  $$(".app-view").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "scan") setTimeout(() => $("#startScannerButton").focus(), 250);
}

function openSheet(sheet) {
  $$(".bottom-sheet").forEach((item) => item.classList.remove("show"));
  $(sheet).classList.add("show");
  $("#sheetBackdrop").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeSheets() {
  $$(".bottom-sheet").forEach((item) => item.classList.remove("show"));
  $("#sheetBackdrop").classList.remove("show");
  document.body.style.overflow = "";
}

function renderHeader() {
  const { user, team, teams } = appState;
  $("#streakValue").textContent = user.streak;
  $("#xpValue").textContent = formatNumber(user.xp, 0);
  $("#avatarValue").textContent = user.name.slice(0, 1).toUpperCase();
  $("#teamCrest").textContent = team.emblem;
  $("#teamCrest").style.background = team.color;
  $("#teamName").textContent = team.name;
  $("#teamScore").textContent = formatNumber(team.score, 0);
  const ranked = [...teams].sort((a, b) => b.score - a.score);
  const rank = ranked.findIndex((item) => item.id === team.id) + 1;
  $("#leaguePosition").textContent = `${ordinal(rank)} in Campus League`;
  const leaderScore = Math.max(1, ranked[0]?.score || team.score);
  $("#leagueProgress").style.width = `${Math.max(12, Math.round((team.score / leaderScore) * 100))}%`;
}

function ordinal(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function renderMap(filter = "all") {
  const territoryLayer = $("#territoryLayer");
  territoryLayer.replaceChildren();
  for (const territory of appState.territories) {
    const owner = teamById(territory.ownerTeamId) || appState.team;
    const polygon = document.createElementNS(SVG_NS, "polygon");
    polygon.setAttribute("points", territory.polygon.map(([x, y]) => `${x},${y}`).join(" "));
    polygon.setAttribute("fill", `${owner.color}38`);
    polygon.setAttribute("stroke", owner.darkColor || owner.color);
    polygon.setAttribute("class", "territory-polygon");
    polygon.dataset.territoryId = territory.id;
    territoryLayer.append(polygon);

    const centre = territory.polygon.reduce((acc, point) => [acc[0] + point[0] / territory.polygon.length, acc[1] + point[1] / territory.polygon.length], [0, 0]);
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", centre[0]);
    label.setAttribute("y", centre[1] + 2);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", owner.darkColor || owner.color);
    label.setAttribute("class", "territory-label-pill");
    label.textContent = owner.shortName.toUpperCase();
    territoryLayer.append(label);
  }

  const markerRoot = $("#missionMarkers");
  markerRoot.replaceChildren();
  const missions = appState.missions.filter((mission) => {
    if (filter === "high") return mission.estimatedKwh >= 0.8;
    if (filter === "nearby") return mission.map.x < 72;
    return true;
  });
  for (const mission of missions) {
    const button = document.createElement("button");
    const classes = ["mission-marker"];
    if (mission.featured) classes.push("featured");
    if (mission.completedForTeam) classes.push("completed");
    if (!mission.active || mission.cooldownActive) classes.push("locked");
    button.className = classes.join(" ");
    button.style.left = `${mission.map.x}%`;
    button.style.top = `${mission.map.y}%`;
    button.setAttribute("aria-label", `${mission.title}, ${mission.location}`);
    button.innerHTML = `
      ${mission.featured && !mission.completedForTeam ? `<span class="marker-bubble"><b>1 node to capture!</b><small>${escapeHtml(mission.shortTitle)} • ${formatNumber(mission.estimatedKwh, 3)} kWh</small></span>` : ""}
      <span class="marker-pin"><span>${escapeHtml(mission.icon)}</span></span>`;
    button.addEventListener("click", () => openMission(mission.id));
    markerRoot.append(button);
  }
}

function renderMissionCarousel() {
  const root = $("#missionCarousel");
  const missions = [...appState.missions]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.active) - Number(a.active))
    .slice(0, 5);
  root.innerHTML = missions.map((mission) => `
    <button class="mini-mission-card" data-mission-id="${escapeHtml(mission.id)}">
      <span class="mini-mission-top"><span class="mini-icon">${escapeHtml(mission.icon)}</span><span class="mini-copy"><strong>${escapeHtml(mission.title)}</strong><span>${escapeHtml(mission.location)}</span></span></span>
      <span class="mini-rewards"><b>ϟ ${mission.xp} XP</b><b>◒ ${formatNumber(mission.estimatedKwh, 3)} kWh</b><b>${missionStatus(mission)}</b></span>
    </button>`).join("");
  $$('[data-mission-id]', root).forEach((button) => button.addEventListener("click", () => openMission(button.dataset.missionId)));
}

function openMission(missionId) {
  const mission = appState.missions.find((item) => item.id === missionId);
  if (!mission) return showToast("Mission not found", "!");
  selectedMission = mission;
  const territory = appState.territories.find((item) => item.id === mission.territoryId);
  const progress = territory?.progress || { completed: 0, required: 3 };
  $("#missionBigIcon").textContent = mission.icon;
  $("#missionDifficulty").textContent = mission.difficulty.toUpperCase();
  $("#missionSheetTitle").textContent = mission.title;
  $("#missionLocation").textContent = mission.location;
  $("#missionInstruction").textContent = mission.instruction;
  $("#missionSafety").textContent = mission.safety;
  $("#missionXp").textContent = `+${mission.xp} XP`;
  $("#missionKwh").textContent = `${formatNumber(mission.estimatedKwh, 3)} kWh`;
  $("#missionCredit").textContent = `$${Number(mission.credit).toFixed(2)}`;
  $("#territoryPrompt").textContent = territory
    ? `${Math.max(0, progress.required - progress.completed)} node${progress.required - progress.completed === 1 ? "" : "s"} to capture ${territory.name}`
    : "Complete this team mission";
  $("#territoryNodeText").textContent = territory
    ? `Your team controls ${progress.completed} of ${progress.required} nodes`
    : "Every verified action counts";
  $("#territoryDots").innerHTML = Array.from({ length: progress.required || 3 }, (_, index) => `<i class="${index < progress.completed ? "done" : ""}"></i>`).join("");

  const begin = $("#beginMissionButton");
  const demo = $("#demoMissionButton");
  const unavailable = !mission.active || mission.cooldownActive || mission.completedForTeam;
  begin.disabled = unavailable;
  demo.disabled = unavailable;
  if (mission.completedForTeam) begin.textContent = "Completed by your team";
  else if (mission.cooldownActive) begin.textContent = "Location cooling down";
  else if (!mission.active) begin.textContent = mission.availableWindow;
  else begin.textContent = "Scan this mission";
  openSheet("#missionSheet");
}

function renderTeams() {
  const { team, teams, territories, activity } = appState;
  $("#largeTeamCrest").textContent = team.emblem;
  $("#largeTeamCrest").style.background = team.color;
  $("#heroTeamName").textContent = team.name;
  $("#teamMemberCount").textContent = team.memberCount;
  $("#teamStreak").textContent = team.streak;
  $("#heroTeamKwh").textContent = formatNumber(team.kwhSaved, 2);
  $("#heroTeamTerritories").textContent = territories.filter((territory) => territory.ownerTeamId === team.id).length;
  $("#heroTeamCredits").textContent = `$${Number(team.rewardCredits).toFixed(2)}`;

  $("#leaderboard").innerHTML = teams.map((item) => `
    <article class="team-row ${item.id === team.id ? "current" : ""}">
      <div class="rank-number">${item.rank}</div>
      <div class="row-crest" style="background:${item.color}">${escapeHtml(item.emblem)}</div>
      <div class="team-row-copy"><strong>${escapeHtml(item.name)}${item.id === team.id ? " • You" : ""}</strong><span>${item.memberCount} members • ${formatNumber(item.kwhSaved, 1)} kWh</span></div>
      <div class="row-score"><strong>${formatNumber(item.score, 0)}</strong><span>XP</span></div>
    </article>`).join("");

  $("#activityList").innerHTML = activity.map((item) => {
    const itemTeam = teamById(item.teamId) || team;
    return `<article class="activity-item"><span class="activity-emblem" style="background:${itemTeam.color}">${escapeHtml(itemTeam.emblem)}</span><div><p>${escapeHtml(item.text)}</p><time>${timeAgo(item.at)}</time></div></article>`;
  }).join("");
}

function renderImpact() {
  const team = appState.team;
  const dailyReferenceFraction = ((team.kwhSaved / Math.max(1, team.memberCount)) * 8_200_000_000) / 82_000_000_000;
  $("#planetReliefValue").textContent = `${(dailyReferenceFraction * 100).toFixed(2)}%`;
  $("#impactKwh").textContent = formatNumber(team.kwhSaved, 2);
  $("#impactMinutes").textContent = formatNumber(Math.round(team.kwhSaved * 61.3), 0);
  $("#impactCredits").textContent = Number(team.rewardCredits).toFixed(2);
  $("#impactBaseline").textContent = `${Math.min(48, Math.max(9, Math.round(team.kwhSaved * 1.3)))}%`;
  $("#walletBalance").textContent = `$${Number(team.rewardCredits).toFixed(2)}`;
  $("#rewardProgress").style.width = `${Math.min(100, (team.rewardCredits / 20) * 100)}%`;
}

function renderAll() {
  renderHeader();
  renderMap($(".filter-pill.active")?.dataset.filter || "all");
  renderMissionCarousel();
  renderTeams();
  renderImpact();
}

async function loadState() {
  const [state, health] = await Promise.all([
    api(`/api/state?userId=${encodeURIComponent(userId())}`),
    api("/api/health").catch(() => ({ verifierMode: "demo" }))
  ]);
  appState = state;
  verifierMode = health.verifierMode;
  renderAll();
  if (verifierMode === "openai") {
    $("#samplePhotoButton").textContent = "Generate UI sample (live verifier may reject)";
  }
  await handleDeepLink();
}

async function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const missionId = params.get("mission");
  const token = params.get("token");
  if (!missionId) return;
  const mission = appState.missions.find((item) => item.id === missionId);
  if (!mission) return;
  selectedMission = mission;
  if (token) {
    history.replaceState({}, "", location.pathname);
    await validateQr(missionId, token);
  } else {
    openMission(missionId);
  }
}

function parseQrPayload(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) throw new Error("QR code was empty");
  if (value.startsWith("ghostgrid://mission/")) {
    const url = new URL(value);
    return { missionId: url.pathname.replace(/^\//, ""), token: url.searchParams.get("token") };
  }
  try {
    const url = new URL(value);
    return { missionId: url.searchParams.get("mission"), token: url.searchParams.get("token") };
  } catch {
    const mission = appState.missions.find((item) => item.code.toUpperCase() === value.toUpperCase());
    if (mission) return { missionId: mission.id, token: DEMO_TOKENS[mission.id] };
  }
  throw new Error("That is not a GhostGrid mission QR");
}

async function validateQr(missionId, token) {
  stopScanner();
  const mission = appState.missions.find((item) => item.id === missionId);
  if (!mission || !token) return showToast("This QR is missing mission data", "!");
  try {
    const result = await api(`/api/missions/${encodeURIComponent(missionId)}/scan`, {
      method: "POST",
      body: JSON.stringify({ userId: userId(), qrToken: token })
    });
    activeAttempt = result.attempt;
    selectedMission = result.mission;
    $("#proofExpected").textContent = selectedMission.expectedVisualEvidence;
    proofDataUrl = null;
    $("#photoDrop").classList.remove("has-photo");
    $("#proofPreview").removeAttribute("src");
    $("#verifyPhotoButton").disabled = true;
    openSheet("#proofSheet");
    if (navigator.vibrate) navigator.vibrate(45);
  } catch (error) {
    showToast(error.message, "!");
  }
}

async function startScanner() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    return showToast("Camera scanning needs HTTPS or localhost. Use the mission code below.", "!");
  }
  if (!("BarcodeDetector" in window)) {
    return showToast("This browser lacks native QR detection. Use a mission link or code.", "!");
  }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = $("#scannerVideo");
    video.srcObject = scannerStream;
    await video.play();
    $("#scannerWindow").classList.add("streaming");
    $("#startScannerButton").textContent = "Scanning…";
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const scanFrame = async () => {
      if (!scannerStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) {
          const parsed = parseQrPayload(codes[0].rawValue);
          await validateQr(parsed.missionId, parsed.token);
          return;
        }
      } catch (error) {
        console.debug("QR frame skipped", error);
      }
      scannerTimer = setTimeout(scanFrame, 420);
    };
    scanFrame();
  } catch (error) {
    showToast(error.name === "NotAllowedError" ? "Camera permission was not granted" : "Unable to start the camera", "!");
  }
}

function stopScanner() {
  clearTimeout(scannerTimer);
  scannerTimer = null;
  scannerStream?.getTracks().forEach((track) => track.stop());
  scannerStream = null;
  const video = $("#scannerVideo");
  if (video) video.srcObject = null;
  $("#scannerWindow")?.classList.remove("streaming");
  if ($("#startScannerButton")) $("#startScannerButton").textContent = "Start camera";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const source = await readFileAsDataUrl(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = source;
  });
  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function createSampleProof() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 960, 720);
  gradient.addColorStop(0, "#d8e8db");
  gradient.addColorStop(1, "#5c6f62");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 960, 720);
  ctx.fillStyle = "#f9fbf8";
  ctx.roundRect(240, 120, 480, 420, 34);
  ctx.fill();
  ctx.fillStyle = "#26362d";
  ctx.font = "800 38px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(selectedMission?.shortTitle || "APPROVED DEVICE", 480, 205);
  ctx.fillStyle = "#e7eee8";
  ctx.roundRect(330, 250, 300, 160, 24);
  ctx.fill();
  ctx.fillStyle = "#58cc02";
  ctx.font = "1000 88px system-ui";
  ctx.fillText("OFF", 480, 360);
  ctx.fillStyle = "#536159";
  ctx.font = "700 24px system-ui";
  ctx.fillText("GhostGrid demo proof • room clear", 480, 485);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function setProofPhoto(dataUrl) {
  proofDataUrl = dataUrl;
  $("#proofPreview").src = dataUrl;
  $("#photoDrop").classList.add("has-photo");
  $("#verifyPhotoButton").disabled = false;
}

async function verifyProof() {
  if (!activeAttempt || !proofDataUrl) return;
  closeSheets();
  $("#verifyingOverlay").classList.add("show");
  const statusMessages = ["Matching the device and completed state", "Checking the approved safety rule", "Calculating territory impact"];
  let messageIndex = 0;
  const statusTimer = setInterval(() => {
    messageIndex = (messageIndex + 1) % statusMessages.length;
    $("#verificationStatus").textContent = statusMessages[messageIndex];
    $$(".verification-steps i").forEach((element, index) => element.classList.toggle("active", index === messageIndex));
  }, 850);
  try {
    const result = await api(`/api/attempts/${encodeURIComponent(activeAttempt.id)}/verify`, {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: proofDataUrl })
    });
    clearInterval(statusTimer);
    $("#verifyingOverlay").classList.remove("show");
    if (result.accepted) {
      appState = result.state;
      renderAll();
      showResult(result);
    } else {
      showRejectedResult(result.verification);
    }
  } catch (error) {
    clearInterval(statusTimer);
    $("#verifyingOverlay").classList.remove("show");
    showToast(error.message, "!");
    openSheet("#proofSheet");
  }
}

function createConfetti() {
  const root = $("#confetti");
  root.replaceChildren();
  const colors = ["#58cc02", "#1cb0f6", "#ffc800", "#ce82ff", "#ff4b4b"];
  for (let i = 0; i < 55; i += 1) {
    const piece = document.createElement("i");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 1.1}s`;
    piece.style.animationDuration = `${2.1 + Math.random() * 1.5}s`;
    root.append(piece);
  }
}

function showResult(result) {
  const capture = result.captures?.[0];
  $("#resultOverlay").classList.remove("rejected");
  $("#resultBadge").textContent = "✓";
  $("#resultEyebrow").textContent = capture ? "TERRITORY CAPTURED" : "MISSION VERIFIED";
  $("#resultTitle").textContent = capture ? `${capture.territoryName} is yours!` : "Node stabilised!";
  $("#resultReason").textContent = capture
    ? `${appState.team.name} completed all three verified nodes and took the zone.`
    : result.verification.reason;
  $("#resultXp").textContent = `+${result.impact.xpEarned}`;
  $("#resultKwh").textContent = formatNumber(result.impact.kwhSaved, 3);
  $("#resultCredit").textContent = Number(result.impact.creditEarned).toFixed(2);
  createConfetti();
  $("#resultOverlay").classList.add("show");
  if (navigator.vibrate) navigator.vibrate([60, 45, 90]);
}

function showRejectedResult(verification) {
  $("#resultOverlay").classList.add("rejected");
  $("#resultBadge").textContent = "!";
  $("#resultEyebrow").textContent = "TRY ANOTHER PHOTO";
  $("#resultTitle").textContent = "Not clear enough yet";
  $("#resultReason").textContent = verification.reason;
  $("#resultXp").textContent = "+0";
  $("#resultKwh").textContent = "0";
  $("#resultCredit").textContent = "0";
  $("#confetti").replaceChildren();
  $("#resultOverlay").classList.add("show");
}

async function joinTeam(event) {
  event.preventDefault();
  const code = $("#teamCodeInput").value.trim();
  if (!code) return showToast("Enter a team invite code", "!");
  try {
    appState = await api("/api/teams/join", { method: "POST", body: JSON.stringify({ userId: userId(), teamCode: code }) });
    renderAll();
    closeSheets();
    showToast(`Joined ${appState.team.name}`);
  } catch (error) {
    showToast(error.message, "!");
  }
}

async function createTeam(event) {
  event.preventDefault();
  const name = $("#newTeamNameInput").value.trim();
  if (name.length < 3) return showToast("Use at least 3 characters", "!");
  try {
    appState = await api("/api/teams", { method: "POST", body: JSON.stringify({ userId: userId(), name }) });
    renderAll();
    closeSheets();
    showToast(`${appState.team.name} is ready to compete`);
  } catch (error) {
    showToast(error.message, "!");
  }
}

async function shareTeam() {
  const text = `Join ${appState.team.name} on GhostGrid with code ${appState.team.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Join my GhostGrid team", text });
    else {
      await navigator.clipboard.writeText(appState.team.code);
      showToast(`Copied team code ${appState.team.code}`);
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast(`Team code: ${appState.team.code}`, "ϟ");
  }
}

function bindEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  $$('[data-close-sheet]').forEach((button) => button.addEventListener("click", closeSheets));
  $("#sheetBackdrop").addEventListener("click", closeSheets);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSheets();
      $("#resultOverlay").classList.remove("show");
    }
  });
  $$(".filter-pill").forEach((button) => button.addEventListener("click", () => {
    $$(".filter-pill").forEach((item) => item.classList.toggle("active", item === button));
    renderMap(button.dataset.filter);
  }));
  $("#locateButton").addEventListener("click", () => {
    $$(".filter-pill").forEach((item) => item.classList.toggle("active", item.dataset.filter === "nearby"));
    renderMap("nearby");
    showToast("Showing missions along your campus route", "◎");
  });
  $("#viewAllMissions").addEventListener("click", () => showToast(`${appState.missions.filter((item) => item.active).length} missions available now`, "⌖"));
  $("#beginMissionButton").addEventListener("click", () => { closeSheets(); navigate("scan"); });
  $("#demoMissionButton").addEventListener("click", () => selectedMission && validateQr(selectedMission.id, DEMO_TOKENS[selectedMission.id]));
  $("#startScannerButton").addEventListener("click", startScanner);
  $("#demoScanButton").addEventListener("click", () => {
    const mission = appState.missions.find((item) => item.featured) || appState.missions[0];
    validateQr(mission.id, DEMO_TOKENS[mission.id]);
  });
  $("#manualCodeButton").addEventListener("click", () => {
    try {
      const parsed = parseQrPayload($("#missionCodeInput").value);
      validateQr(parsed.missionId, parsed.token);
    } catch (error) { showToast(error.message, "!"); }
  });
  $("#missionCodeInput").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#manualCodeButton").click(); });
  $("#proofPhotoInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setProofPhoto(await compressImage(file));
    } catch { showToast("That photo could not be opened", "!"); }
  });
  $("#samplePhotoButton").addEventListener("click", () => setProofPhoto(createSampleProof()));
  $("#verifyPhotoButton").addEventListener("click", verifyProof);
  $("#resultContinueButton").addEventListener("click", () => {
    $("#resultOverlay").classList.remove("show", "rejected");
    proofDataUrl = null;
    activeAttempt = null;
    navigate("map");
  });
  $("#openJoinTeamButton").addEventListener("click", () => openSheet("#teamSheet"));
  $("#joinTeamForm").addEventListener("submit", joinTeam);
  $("#createTeamForm").addEventListener("submit", createTeam);
  $("#shareTeamButton").addEventListener("click", shareTeam);
}

bindEvents();
loadState().catch((error) => {
  console.error(error);
  showToast("GhostGrid could not load. Is the server running?", "!");
});
