export const CAPTURE_WINDOW_MS = 30 * 60 * 1000;
export const NODE_COOLDOWN_MS = 2 * 60 * 60 * 1000;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function calculateAvoidedKwh({ powerBeforeKw, powerAfterKw, avoidedMinutes }) {
  const deltaKw = Math.max(0, Number(powerBeforeKw) - Number(powerAfterKw));
  return Number((deltaKw * (Math.max(0, Number(avoidedMinutes)) / 60)).toFixed(3));
}

export function calculatePlanetRelief(kwhSaved, activePeople = 1) {
  const worldPopulation = 8_200_000_000;
  const globalDailyElectricityKwh = 82_000_000_000;
  const perPerson = Number(kwhSaved) / Math.max(1, Number(activePeople));
  const globalEchoKwh = perPerson * worldPopulation;
  const fraction = globalEchoKwh / globalDailyElectricityKwh;
  return {
    fraction: Number(fraction.toFixed(4)),
    percentOfGlobalDay: Number((fraction * 100).toFixed(2)),
    globalEchoTwh: Number((globalEchoKwh / 1_000_000_000).toFixed(3)),
    label: `${(fraction * 100).toFixed(2)}% of a global electricity day`,
    methodology: "Motivational equivalent only. Uses configurable world population and global daily electricity reference values."
  };
}

export function territoryProgress(territory, missions, teamId, now = Date.now()) {
  const eligible = territory.nodeIds
    .map((id) => missions.find((mission) => mission.id === id))
    .filter(Boolean);
  const completed = eligible.filter((mission) => {
    const completion = mission.teamCompletions?.[teamId];
    return completion && now - new Date(completion.completedAt).getTime() <= CAPTURE_WINDOW_MS;
  });
  const verifiedKwh = completed.reduce((sum, mission) => {
    return sum + Number(mission.teamCompletions[teamId].kwhSaved || 0);
  }, 0);
  return {
    completedNodeIds: completed.map((mission) => mission.id),
    completed: completed.length,
    required: eligible.length,
    percent: eligible.length ? Math.round((completed.length / eligible.length) * 100) : 0,
    verifiedKwh: Number(verifiedKwh.toFixed(3))
  };
}

export function recalculateTerritories(state, actingTeamId, now = Date.now()) {
  const captures = [];
  for (const territory of state.territories) {
    territory.teamProgress ||= {};
    const progress = territoryProgress(territory, state.missions, actingTeamId, now);
    territory.teamProgress[actingTeamId] = progress;
    if (progress.required >= 3 && progress.completed === progress.required) {
      const previousOwnerTeamId = territory.ownerTeamId;
      territory.ownerTeamId = actingTeamId;
      territory.strength = 100;
      territory.capturedAt = new Date(now).toISOString();
      territory.previousOwnerTeamId = previousOwnerTeamId;
      captures.push({
        territoryId: territory.id,
        territoryName: territory.name,
        previousOwnerTeamId,
        ownerTeamId: actingTeamId
      });
    } else if (territory.ownerTeamId === actingTeamId) {
      territory.strength = clamp(progress.percent, 0, 100);
    }
  }
  return captures;
}

export function publicMission(mission, teamId, now = Date.now()) {
  const cooldownUntil = mission.cooldownUntil ? new Date(mission.cooldownUntil).getTime() : 0;
  return {
    ...mission,
    qrToken: undefined,
    teamCompletions: undefined,
    completedForTeam: Boolean(mission.teamCompletions?.[teamId]),
    cooldownActive: cooldownUntil > now,
    cooldownSeconds: cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0
  };
}
