import { parseJoulingQrPayload } from "./qr-protocol.js";
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, ScaleControl } from "/vendor/maplibre-gl/maplibre-gl.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const NUS_CAMPUS_CENTER = [103.7749, 1.2989];
const NEARBY_RADIUS_METRES = 800;
const MAP_STYLE = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }]
};

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
let resultRetryAllowed = false;
let matchCountdownTimer = null;
let lastImpactTrigger = null;
let campusMap = null;
let mapStyleReady = false;
let mapMarkers = [];
let userLocationMarker = null;
let lastKnownLocation = null;
let activeMapFilter = "all";

const userId = () => localStorage.getItem("jouling.userId") || localStorage.getItem("ghostgrid.userId") || "u-demo";

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
  closeImpactDetail(false);
  $$(".app-view").forEach((element) => element.classList.toggle("active", element.dataset.view === view));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "scan") setTimeout(() => $("#startScannerButton").focus(), 250);
  if (view === "map") setTimeout(() => campusMap?.resize(), 80);
}

function formatCountdown(endsAt) {
  const milliseconds = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  if (milliseconds === 0) return "Match complete";
  return `${hours}h ${String(minutes).padStart(2, "0")}m left`;
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

function missionCoordinates(mission) {
  return [Number(mission.map.longitude), Number(mission.map.latitude)];
}

function distanceMetres([fromLongitude, fromLatitude], [toLongitude, toLatitude]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filteredMissions(filter = activeMapFilter) {
  const origin = lastKnownLocation || NUS_CAMPUS_CENTER;
  return appState.missions.filter((mission) => {
    if (filter === "high") return mission.estimatedKwh >= 0.8;
    if (filter === "nearby") return distanceMetres(origin, missionCoordinates(mission)) <= NEARBY_RADIUS_METRES;
    return true;
  });
}

function territoryGeoJson() {
  return {
    type: "FeatureCollection",
    features: appState.territories.map((territory) => {
      const owner = teamById(territory.ownerTeamId) || appState.team;
      const ring = territory.polygon.map(([longitude, latitude]) => [Number(longitude), Number(latitude)]);
      if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
      return {
        type: "Feature",
        id: territory.id,
        properties: {
          name: territory.name,
          owner: owner.shortName.toUpperCase(),
          color: owner.color,
          stroke: owner.darkColor || owner.color
        },
        geometry: { type: "Polygon", coordinates: [ring] }
      };
    })
  };
}

function addTerritoryLayers() {
  campusMap.addSource("territories", { type: "geojson", data: territoryGeoJson() });
  campusMap.addLayer({
    id: "territory-fills",
    type: "fill",
    source: "territories",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.22
    }
  });
  campusMap.addLayer({
    id: "territory-outlines",
    type: "line",
    source: "territories",
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": 3,
      "line-dasharray": [2, 1.5]
    }
  });
}

function initCampusMap() {
  if (campusMap) return;
  const loading = $("#mapLoading");
  try {
    campusMap = new MapLibreMap({
      container: "mapCanvas",
      style: MAP_STYLE,
      center: NUS_CAMPUS_CENTER,
      zoom: 14.25,
      minZoom: 10,
      maxZoom: 19,
      pitchWithRotate: false,
      dragRotate: false,
      cooperativeGestures: false,
      attributionControl: true
    });
    campusMap.addControl(new NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
    campusMap.addControl(new ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-right");
    campusMap.on("load", () => {
      addTerritoryLayers();
      mapStyleReady = true;
      loading.classList.add("hidden");
      loading.setAttribute("aria-hidden", "true");
      renderMap(activeMapFilter);
    });
    campusMap.on("error", (event) => {
      if (!mapStyleReady && event?.error) {
        loading.classList.add("error");
        loading.querySelector("span").textContent = "Basemap unavailable — mission nodes are still active";
      }
    });
  } catch (error) {
    console.error(error);
    loading.classList.add("error");
    loading.querySelector("span").textContent = "This browser could not start the interactive map";
  }
}

function clearMapMarkers() {
  for (const marker of mapMarkers) marker.remove();
  mapMarkers = [];
}

function territoryCentre(polygon) {
  return polygon.reduce((centre, [longitude, latitude]) => [
    centre[0] + Number(longitude) / polygon.length,
    centre[1] + Number(latitude) / polygon.length
  ], [0, 0]);
}

function renderMap(filter = "all") {
  activeMapFilter = filter;
  initCampusMap();
  if (!mapStyleReady) return;

  campusMap.getSource("territories")?.setData(territoryGeoJson());
  clearMapMarkers();

  for (const territory of appState.territories) {
    const owner = teamById(territory.ownerTeamId) || appState.team;
    const label = document.createElement("div");
    label.className = "territory-map-label";
    label.style.setProperty("--territory-color", owner.darkColor || owner.color);
    label.textContent = owner.shortName.toUpperCase();
    mapMarkers.push(new Marker({ element: label, anchor: "center" })
      .setLngLat(territoryCentre(territory.polygon))
      .addTo(campusMap));
  }

  for (const mission of filteredMissions(filter)) {
    const button = document.createElement("button");
    const classes = ["mission-marker"];
    if (mission.featured) classes.push("featured");
    if (mission.completedForTeam) classes.push("completed");
    if (!mission.active || mission.cooldownActive) classes.push("locked");
    button.className = classes.join(" ");
    button.setAttribute("aria-label", `${mission.title}, ${mission.location}`);
    button.innerHTML = `
      ${mission.featured && !mission.completedForTeam ? `<span class="marker-bubble"><b>1 node to capture!</b><small>${escapeHtml(mission.shortTitle)} • ${formatNumber(mission.estimatedKwh, 3)} kWh</small></span>` : ""}
      <span class="marker-pin"><span>${escapeHtml(mission.icon)}</span></span>`;
    button.addEventListener("click", () => openMission(mission.id));
    mapMarkers.push(new Marker({ element: button, anchor: "bottom" })
      .setLngLat(missionCoordinates(mission))
      .addTo(campusMap));
  }
}

function fitMissionBounds(missions = filteredMissions()) {
  if (!campusMap || !missions.length) return;
  if (missions.length === 1) {
    campusMap.flyTo({ center: missionCoordinates(missions[0]), zoom: 17, duration: 650 });
    return;
  }
  const bounds = new LngLatBounds();
  missions.forEach((mission) => bounds.extend(missionCoordinates(mission)));
  campusMap.fitBounds(bounds, { padding: { top: 70, right: 55, bottom: 65, left: 55 }, maxZoom: 16.2, duration: 650 });
}

function locateUser() {
  $$(".filter-pill").forEach((item) => item.classList.toggle("active", item.dataset.filter === "nearby"));
  if (!navigator.geolocation) {
    lastKnownLocation = NUS_CAMPUS_CENTER;
    renderMap("nearby");
    fitMissionBounds();
    return showToast("Location is unavailable — showing missions near central campus", "◎");
  }
  showToast("Finding your campus position…", "◎");
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    lastKnownLocation = [coords.longitude, coords.latitude];
    userLocationMarker?.remove();
    const marker = document.createElement("div");
    marker.className = "user-location-marker";
    marker.setAttribute("aria-label", "Your location");
    userLocationMarker = new Marker({ element: marker }).setLngLat(lastKnownLocation).addTo(campusMap);
    renderMap("nearby");
    campusMap.flyTo({ center: lastKnownLocation, zoom: 16.2, duration: 700 });
    showToast(`${filteredMissions("nearby").length} missions within 800 m`, "◎");
  }, () => {
    lastKnownLocation = NUS_CAMPUS_CENTER;
    renderMap("nearby");
    fitMissionBounds();
    showToast("Location permission was not available — using central campus", "◎");
  }, { enableHighAccuracy: true, timeout: 7000, maximumAge: 60_000 });
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

  renderDailyMatch();

  $("#leaderboard").innerHTML = teams.map((item) => `
    <article class="team-row rank-${item.rank} ${item.id === team.id ? "current" : ""}">
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

function renderDailyMatch() {
  const matchup = appState.dailyMatchup;
  const card = $("#dailyMatchCard");
  if (!matchup) {
    card.hidden = true;
    $("#dailyMatchTimer").textContent = "Pairing soon";
    return;
  }
  card.hidden = false;
  const { teamA, teamB } = matchup;
  $("#matchTeamACrest").textContent = teamA.emblem;
  $("#matchTeamACrest").style.background = teamA.color;
  $("#matchTeamAName").textContent = teamA.name;
  $("#matchTeamAScore").textContent = `${formatNumber(matchup.teamAScore, 0)} XP`;
  $("#matchTeamBCrest").textContent = teamB.emblem;
  $("#matchTeamBCrest").style.background = teamB.color;
  $("#matchTeamBName").textContent = teamB.name;
  $("#matchTeamBScore").textContent = `${formatNumber(matchup.teamBScore, 0)} XP`;
  $("#dailyMatchReward").textContent = `Winning team earns a ${formatNumber(matchup.rewardXp, 0)} XP boost`;
  const scoreTotal = Math.max(1, matchup.teamAScore + matchup.teamBScore);
  $("#dailyMatchProgress").style.width = `${Math.round((matchup.teamAScore / scoreTotal) * 100)}%`;
  const updateTimer = () => { $("#dailyMatchTimer").textContent = formatCountdown(matchup.endsAt); };
  clearInterval(matchCountdownTimer);
  updateTimer();
  matchCountdownTimer = setInterval(updateTimer, 60_000);
}

function renderImpact() {
  const team = appState.team;
  const dailyReferenceFraction = ((team.kwhSaved / Math.max(1, team.memberCount)) * 8_200_000_000) / 82_000_000_000;
  $("#planetReliefValue").textContent = `${(dailyReferenceFraction * 100).toFixed(2)}%`;
  $("#impactKwh").textContent = formatNumber(team.kwhSaved, 2);
  $("#impactMinutes").textContent = formatNumber(team.wasteMinutesStopped ?? Math.round(team.kwhSaved * 61.3), 0);
  const conqueredSqFt = appState.territories
    .filter((territory) => territory.ownerTeamId === team.id)
    .reduce((total, territory) => total + Number(territory.areaSqFt || 0), 0);
  $("#impactAreas").textContent = `${formatNumber(conqueredSqFt, 0)} sq ft`;
  $("#impactBaseline").textContent = `${Math.min(48, Math.max(9, Math.round(team.kwhSaved * 1.3)))}%`;
  $("#walletBalance").textContent = `$${Number(team.rewardCredits).toFixed(2)}`;
  $("#rewardProgress").style.width = `${Math.min(100, (team.rewardCredits / 20) * 100)}%`;
}

function impactSummary() {
  const team = appState.team;
  const totalMinutes = team.wasteMinutesStopped ?? Math.round(team.kwhSaved * 61.3);
  const conquered = appState.territories.filter((territory) => territory.ownerTeamId === team.id);
  const conqueredSqFt = conquered.reduce((total, territory) => total + Number(territory.areaSqFt || 0), 0);
  const baselinePercent = Math.min(48, Math.max(9, Math.round(team.kwhSaved * 1.3)));
  const completedMissions = appState.missions.filter((mission) => mission.completedForTeam);
  return { team, totalMinutes, conquered, conqueredSqFt, baselinePercent, completedMissions };
}

function detailStatGrid(items) {
  return `<div class="detail-stat-grid">${items.map(([value, label]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("")}</div>`;
}

function detailBars(items) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return `<div class="detail-bars">${items.map((item) => `
    <div><div class="detail-bar-label"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.display)}</b></div><div class="detail-bar-track"><i style="width:${Math.max(8, Math.round((item.value / max) * 100))}%"></i></div></div>`).join("")}</div>`;
}

function openImpactDetail(type, trigger = null) {
  if (!appState) return;
  const { team, totalMinutes, conquered, conqueredSqFt, baselinePercent, completedMissions } = impactSummary();
  const memberCount = Math.max(1, team.memberCount);
  const visibleMissions = completedMissions.length ? completedMissions : appState.missions;
  const energyByType = Object.values(visibleMissions.reduce((groups, mission) => {
    const key = mission.type || "other";
    groups[key] ||= { label: key[0].toUpperCase() + key.slice(1), value: 0 };
    groups[key].value += Number(mission.estimatedKwh || 0);
    return groups;
  }, {})).map((item) => ({ ...item, display: `${formatNumber(item.value, 3)} kWh` }));
  const portfolioArea = appState.territories.reduce((sum, territory) => sum + Number(territory.areaSqFt || 0), 0);
  const baselineTarget = team.kwhSaved / (1 + baselinePercent / 100);
  const details = {
    kwh: {
      accent: "linear-gradient(145deg,#2d8c00,#58cc02)", eyebrow: "VERIFIED ENERGY", title: "Every saved kilowatt-hour",
      intro: "Only AI-verified, approved missions feed this total—so the team can trust what moved the number.", icon: "ϟ", value: `${formatNumber(team.kwhSaved, 2)} kWh`, label: "team total",
      body: `${detailStatGrid([[`${formatNumber(team.kwhSaved / memberCount, 2)} kWh`, "per team member"], [String(appState.user.weeklyMissions), "your missions this week"], [formatNumber(team.score, 0), "team XP"], [String(completedMissions.length), "visible verified nodes"]])}<section class="detail-card"><h3>Visible mission mix</h3>${detailBars(energyByType)}</section>`
    },
    minutes: {
      accent: "linear-gradient(145deg,#087db4,#1cb0f6)", eyebrow: "WASTE INTERRUPTED", title: "Time that power stopped leaking",
      intro: "Waste-minutes translate avoided electricity into a clock: how long unnecessary devices would otherwise have kept running.", icon: "◷", value: `${formatNumber(totalMinutes, 0)} min`, label: "waste-minutes stopped",
      body: `${detailStatGrid([[`${formatNumber(totalMinutes / 60, 1)} h`, "combined waste time"], [`${formatNumber(totalMinutes / memberCount, 0)} min`, "per team member"], [`${formatNumber(totalMinutes / Math.max(1, appState.user.weeklyMissions), 0)} min`, "per weekly mission"], [`${formatNumber(team.kwhSaved, 2)} kWh`, "verified source total"]])}<section class="detail-card"><h3>What this metric means</h3><p>For each completed mission, Jouling combines the approved device’s avoidable load with its prevented run-time. The result remains anchored to verified kWh while making the avoided duration easier to feel.</p></section>`
    },
    area: {
      accent: "linear-gradient(145deg,#087db4,#5950d8)", eyebrow: "TEAM TERRITORY", title: "Space your team has conquered",
      intro: "A zone counts only while your team owns every required mission node. Rival teams can take it back by completing the same approved network.", icon: "⌖", value: `${formatNumber(conqueredSqFt, 0)} sq ft`, label: "currently controlled",
      body: `${detailStatGrid([[String(conquered.length), "zones controlled"], [`${portfolioArea ? Math.round((conqueredSqFt / portfolioArea) * 100) : 0}%`, "mapped campus share"], [String(appState.territories.length), "zones in play"], [`${formatNumber(portfolioArea, 0)} sq ft`, "mapped portfolio"]])}<section class="detail-card"><h3>Controlled zones</h3>${conquered.length ? conquered.map((territory) => `<div class="detail-zone"><span>⌖</span><div><strong>${escapeHtml(territory.name)}</strong><small>${territory.progress.completed} of ${territory.progress.required} nodes verified</small></div><b>${formatNumber(territory.areaSqFt, 0)} sq ft</b></div>`).join("") : "<p>Complete every node in a territory to put its area on the board.</p>"}</section>`
    },
    baseline: {
      accent: "linear-gradient(145deg,#8e45b8,#ce82ff)", eyebrow: "PACE VS BASELINE", title: "Ahead of the expected saving pace",
      intro: "This compares the team’s verified energy-saving pace with the institution’s reference target for the same period.", icon: "▲", value: `${baselinePercent}%`, label: "better than baseline",
      body: `${detailStatGrid([[`${formatNumber(baselineTarget, 2)} kWh`, "reference target"], [`+${formatNumber(team.kwhSaved - baselineTarget, 2)} kWh`, "above target"], [`${formatNumber(team.kwhSaved, 2)} kWh`, "verified pace"], [String(team.streak), "day team streak"]])}<section class="detail-card"><h3>Why it matters</h3><p>The comparison is anchored to an institutional target, while mission photos and cooldowns protect the verified total from duplicate or unsupported claims.</p></section>`
    }
  };
  const detail = details[type];
  if (!detail) return;
  lastImpactTrigger = trigger || document.activeElement;
  $("#impactDetailEyebrow").textContent = detail.eyebrow;
  $("#impactDetailTitle").textContent = detail.title;
  $("#impactDetailIntro").textContent = detail.intro;
  $(".impact-detail-header").style.background = detail.accent;
  $("#impactDetailContent").innerHTML = `<section class="detail-hero-stat"><div><span>${escapeHtml(detail.label)}</span><strong>${escapeHtml(detail.value)}</strong></div><div class="detail-hero-icon">${escapeHtml(detail.icon)}</div></section>${detail.body}`;
  const overlay = $("#impactDetailOverlay");
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  $("#impactDetailClose").focus();
}

function closeImpactDetail(restoreFocus = true) {
  const overlay = $("#impactDetailOverlay");
  if (!overlay) return;
  const wasOpen = overlay.classList.contains("show");
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  if (wasOpen) document.body.style.overflow = "";
  if (wasOpen && restoreFocus && lastImpactTrigger?.focus) lastImpactTrigger.focus();
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
    $("#samplePhotoButton").hidden = true;
    $("#photoRequirementText").textContent = "A new photo is mandatory. Make the labelled device and completed room state clearly visible.";
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
  const payload = parseJoulingQrPayload(value);
  if (payload) return payload;
  throw new Error("That is not a Jouling mission QR");
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
    return showToast("Camera scanning needs HTTPS or localhost. Open Jouling on your phone at the mission spot.", "!");
  }
  if (!("BarcodeDetector" in window)) {
    return showToast("This browser lacks built-in QR detection. Open Jouling in Chrome or Edge on your phone.", "!");
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
  ctx.fillText("Jouling demo proof • room clear", 480, 485);
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
      showRejectedResult(result.verification, result.retryAllowed);
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
  resultRetryAllowed = false;
  $("#resultContinueButton").textContent = "See the map";
  $("#resultOverlay").classList.remove("rejected");
  $("#resultBadge").textContent = "✓";
  $("#resultEyebrow").textContent = capture ? "TERRITORY CAPTURED" : "MISSION VERIFIED";
  $("#resultTitle").textContent = capture ? `${capture.territoryName} is yours!` : "Node stabilised!";
  $("#resultReason").textContent = capture
    ? `${appState.team.name} completed all three verified nodes and took the zone.`
    : result.verification.reason;
  $("#resultGuidance").textContent = "Your verified impact has been added to the team total.";
  $("#resultXp").textContent = `+${result.impact.xpEarned}`;
  $("#resultKwh").textContent = formatNumber(result.impact.kwhSaved, 3);
  $("#resultCredit").textContent = Number(result.impact.creditEarned).toFixed(2);
  createConfetti();
  $("#resultOverlay").classList.add("show");
  if (navigator.vibrate) navigator.vibrate([60, 45, 90]);
}

function showRejectedResult(verification, retryAllowed = true) {
  const messages = {
    room_still_active: ["The energy use is still on", "Switch off only the labelled device after the space is empty, then photograph the completed state."],
    camera_obscured: ["The camera view is blocked", "Keep fingers away from the lens, clean it if needed, and retake the full scene."],
    image_unclear: ["We can’t see the result clearly", "Use better lighting, hold still, and include both the labelled device and its visible state."],
    wrong_device_or_location: ["This does not match the mission", "Return to the QR-labelled location and photograph the exact device named in the task."],
    required_state_missing: ["Part of the task is not visible", "Include every required condition—for example, both the OFF controller and the closed door."],
    unsafe_action: ["Stop—this action may be unsafe", "Do not continue or touch electrical panels. Follow the approved mission instructions or contact site staff."],
    unknown: ["We couldn’t verify this photo", "Retake a clear photo showing the approved device and completed energy-saving state."]
  };
  const failureCode = verification.failureCode || "unknown";
  const [title, fallbackGuidance] = messages[failureCode] || messages.unknown;
  resultRetryAllowed = Boolean(retryAllowed) && failureCode !== "unsafe_action";
  $("#resultOverlay").classList.add("rejected");
  $("#resultBadge").textContent = "!";
  $("#resultEyebrow").textContent = failureCode === "unsafe_action" ? "SAFETY CHECK" : "PHOTO NOT VERIFIED";
  $("#resultTitle").textContent = title;
  $("#resultReason").textContent = verification.reason;
  $("#resultGuidance").textContent = verification.userGuidance || fallbackGuidance;
  $("#resultXp").textContent = "+0";
  $("#resultKwh").textContent = "0";
  $("#resultCredit").textContent = "0";
  $("#confetti").replaceChildren();
  $("#resultContinueButton").textContent = resultRetryAllowed ? "Retake photo" : "Back to the map";
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
  const text = `Join ${appState.team.name} on Jouling with code ${appState.team.code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Join my Jouling team", text });
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
      closeImpactDetail();
    }
  });
  $$(".filter-pill").forEach((button) => button.addEventListener("click", () => {
    $$(".filter-pill").forEach((item) => item.classList.toggle("active", item === button));
    renderMap(button.dataset.filter);
  }));
  $("#locateButton").addEventListener("click", locateUser);
  $("#viewAllMissions").addEventListener("click", () => {
    $$(".filter-pill").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
    renderMap("all");
    fitMissionBounds(appState.missions);
    showToast(`${appState.missions.filter((item) => item.active).length} missions available now`, "⌖");
  });
  $("#beginMissionButton").addEventListener("click", () => { closeSheets(); navigate("scan"); });
  $("#demoMissionButton").addEventListener("click", () => selectedMission && validateQr(selectedMission.id, DEMO_TOKENS[selectedMission.id]));
  $("#startScannerButton").addEventListener("click", startScanner);
  $("#demoScanButton").addEventListener("click", () => {
    const mission = appState.missions.find((item) => item.featured) || appState.missions[0];
    validateQr(mission.id, DEMO_TOKENS[mission.id]);
  });
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
    $("#photoDrop").classList.remove("has-photo");
    $("#proofPreview").removeAttribute("src");
    $("#verifyPhotoButton").disabled = true;
    if (resultRetryAllowed) {
      resultRetryAllowed = false;
      openSheet("#proofSheet");
    } else {
      activeAttempt = null;
      $("#resultContinueButton").textContent = "See the map";
      navigate("map");
    }
  });
  $("#openJoinTeamButton").addEventListener("click", () => openSheet("#teamSheet"));
  $("#joinTeamForm").addEventListener("submit", joinTeam);
  $("#createTeamForm").addEventListener("submit", createTeam);
  $("#shareTeamButton").addEventListener("click", shareTeam);
  $$('[data-impact-detail]').forEach((button) => button.addEventListener("click", () => openImpactDetail(button.dataset.impactDetail, button)));
  $("#impactDetailClose").addEventListener("click", () => closeImpactDetail());
  $("#impactDetailOverlay").addEventListener("click", (event) => {
    if (event.target === $("#impactDetailOverlay")) closeImpactDetail();
  });
}

bindEvents();
loadState().catch((error) => {
  console.error(error);
  showToast("Jouling could not load. Is the server running?", "!");
});
