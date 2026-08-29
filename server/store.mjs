import { randomUUID } from "node:crypto";
import {
  NODE_COOLDOWN_MS,
  calculateAvoidedKwh,
  calculatePlanetRelief,
  publicMission,
  recalculateTerritories,
  territoryProgress
} from "./logic.mjs";
import { createSeedState } from "./seed.mjs";

function clone(value) {
  return structuredClone(value);
}

export class JoulingStore {
  constructor(initialState = createSeedState()) {
    this.state = clone(initialState);
    this.persistenceMode = "memory";
  }

  findUser(userId = "u-demo") {
    const user = this.state.users.find((item) => item.id === userId);
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    return user;
  }

  findMission(missionId) {
    const mission = this.state.missions.find((item) => item.id === missionId);
    if (!mission) throw Object.assign(new Error("Mission not found"), { statusCode: 404 });
    return mission;
  }

  findTeam(teamId) {
    const team = this.state.teams.find((item) => item.id === teamId);
    if (!team) throw Object.assign(new Error("Team not found"), { statusCode: 404 });
    return team;
  }

  bootstrap(userId = "u-demo") {
    const user = this.findUser(userId);
    const team = this.findTeam(user.teamId);
    const now = Date.now();
    const territories = this.state.territories.map((territory) => ({
      ...territory,
      progress: territoryProgress(territory, this.state.missions, team.id, now)
    }));
    return {
      user: clone(user),
      team: clone(team),
      teams: this.leaderboard(),
      dailyMatchup: this.dailyMatchupFor(team.id),
      missions: this.state.missions.map((mission) => publicMission(clone(mission), team.id, now)),
      territories: clone(territories),
      activity: clone(this.state.activity.slice(0, 8)),
      rewardPool: Number(this.state.teams.reduce((sum, item) => sum + item.rewardCredits, 0).toFixed(2)),
      serverTime: new Date(now).toISOString()
    };
  }

  leaderboard() {
    return clone([...this.state.teams]
      .sort((a, b) => b.score - a.score)
      .map((team, index) => ({ ...team, rank: index + 1 })));
  }

  dailyMatchupFor(teamId) {
    const matchup = this.state.dailyMatchups?.find((item) => item.teamAId === teamId || item.teamBId === teamId);
    if (!matchup) return null;
    return clone({
      ...matchup,
      teamA: this.findTeam(matchup.teamAId),
      teamB: this.findTeam(matchup.teamBId)
    });
  }

  addDailyScore(teamId, points) {
    const matchup = this.state.dailyMatchups?.find((item) => item.teamAId === teamId || item.teamBId === teamId);
    if (!matchup) return;
    if (matchup.teamAId === teamId) matchup.teamAScore += points;
    else matchup.teamBScore += points;
  }

  createSession({ name, teamCode }) {
    const cleanName = String(name || "New player").trim().slice(0, 32) || "New player";
    const team = this.state.teams.find((item) => item.code === String(teamCode || "").trim().toUpperCase())
      || this.state.teams[0];
    const user = {
      id: `u-${randomUUID()}`,
      name: cleanName,
      avatar: "⚡",
      teamId: team.id,
      xp: 0,
      level: 1,
      streak: 1,
      weeklyMissions: 0,
      joinedAt: new Date().toISOString()
    };
    this.state.users.push(user);
    team.memberCount += 1;
    return this.bootstrap(user.id);
  }

  joinTeam({ userId, teamId, teamCode }) {
    const user = this.findUser(userId);
    const target = this.state.teams.find((team) => {
      return (teamId && team.id === teamId)
        || (teamCode && team.code === String(teamCode).trim().toUpperCase());
    });
    if (!target) throw Object.assign(new Error("Team code not recognised"), { statusCode: 404 });
    if (user.teamId !== target.id) {
      const previous = this.state.teams.find((team) => team.id === user.teamId);
      if (previous) previous.memberCount = Math.max(0, previous.memberCount - 1);
      target.memberCount += 1;
      user.teamId = target.id;
    }
    return this.bootstrap(user.id);
  }

  createTeam({ userId, name }) {
    const user = this.findUser(userId);
    const cleanName = String(name || "").trim().slice(0, 36);
    if (cleanName.length < 3) throw Object.assign(new Error("Team name must have at least 3 characters"), { statusCode: 400 });
    const palette = [
      ["#FF4B4B", "#B52D2D"],
      ["#FF9600", "#C76B00"],
      ["#00CD9C", "#008E6C"]
    ];
    const [color, darkColor] = palette[this.state.teams.length % palette.length];
    const team = {
      id: `team-${randomUUID()}`,
      code: randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(),
      name: cleanName,
      shortName: cleanName.split(/\s+/)[0].slice(0, 12),
      color,
      darkColor,
      emblem: "⚡",
      score: 0,
      kwhSaved: 0,
      wasteMinutesStopped: 0,
      rewardCredits: 0,
      memberCount: 0,
      streak: 1
    };
    this.state.teams.push(team);
    const opponent = [...this.state.teams]
      .filter((item) => item.id !== team.id)
      .sort((a, b) => a.score - b.score)[0];
    if (opponent) {
      const today = new Date();
      const startsAt = new Date(today.setHours(0, 0, 0, 0)).toISOString();
      const endsAt = new Date(today.setHours(24, 0, 0, 0)).toISOString();
      this.state.dailyMatchups ||= [];
      this.state.dailyMatchups.push({
        id: `daily-${team.id}-${opponent.id}`,
        teamAId: team.id,
        teamBId: opponent.id,
        teamAScore: 0,
        teamBScore: Math.max(120, Math.round(opponent.score * 0.14)),
        startsAt,
        endsAt,
        rewardXp: 180
      });
    }
    return this.joinTeam({ userId: user.id, teamId: team.id });
  }

  scanMission({ userId, missionId, qrToken }) {
    const user = this.findUser(userId);
    const mission = this.findMission(missionId);
    if (!mission.active) throw Object.assign(new Error(`Mission unavailable: ${mission.availableWindow}`), { statusCode: 409 });
    if (mission.qrToken !== qrToken) throw Object.assign(new Error("This QR token is invalid or expired"), { statusCode: 403 });
    if (mission.cooldownUntil && new Date(mission.cooldownUntil).getTime() > Date.now()) {
      throw Object.assign(new Error("This location is cooling down after a verified mission"), { statusCode: 409 });
    }
    const attempt = {
      id: `attempt-${randomUUID()}`,
      missionId,
      userId,
      teamId: user.teamId,
      status: "awaiting_photo",
      scannedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
    this.state.attempts.push(attempt);
    return { attempt: clone(attempt), mission: publicMission(clone(mission), user.teamId) };
  }

  getAttempt(attemptId) {
    const attempt = this.state.attempts.find((item) => item.id === attemptId);
    if (!attempt) throw Object.assign(new Error("Mission attempt not found"), { statusCode: 404 });
    return attempt;
  }

  completeAttempt(attemptId, verification) {
    const attempt = this.getAttempt(attemptId);
    const mission = this.findMission(attempt.missionId);
    const user = this.findUser(attempt.userId);
    const team = this.findTeam(attempt.teamId);
    if (attempt.status !== "awaiting_photo") {
      throw Object.assign(new Error("This attempt has already been resolved"), { statusCode: 409 });
    }
    if (new Date(attempt.expiresAt).getTime() < Date.now()) {
      attempt.status = "expired";
      throw Object.assign(new Error("This attempt expired. Scan the QR again."), { statusCode: 410 });
    }
    attempt.lastVerification = clone(verification);
    attempt.verificationAttempts = (attempt.verificationAttempts || 0) + 1;
    if (!verification.completed || verification.safetyConcern) {
      const retryAllowed = !verification.safetyConcern && new Date(attempt.expiresAt).getTime() > Date.now();
      attempt.status = retryAllowed ? "awaiting_photo" : "rejected";
      return { accepted: false, retryAllowed, verification: clone(verification), attempt: clone(attempt) };
    }

    const kwhSaved = mission.estimatedKwh || calculateAvoidedKwh(mission);
    const completedAt = new Date().toISOString();
    mission.teamCompletions ||= {};
    mission.teamCompletions[team.id] = {
      completedAt,
      kwhSaved,
      confidence: verification.confidence,
      attemptId: attempt.id
    };
    mission.cooldownUntil = new Date(Date.now() + NODE_COOLDOWN_MS).toISOString();
    attempt.status = "accepted";
    attempt.verification = clone(verification);
    attempt.completedAt = completedAt;
    attempt.kwhSaved = kwhSaved;

    user.xp += mission.xp;
    user.weeklyMissions += 1;
    user.level = Math.max(1, Math.floor(user.xp / 180) + 1);
    const currentWasteMinutes = Number.isFinite(team.wasteMinutesStopped)
      ? team.wasteMinutesStopped
      : Math.round(team.kwhSaved * 61.3);
    team.score += mission.xp;
    this.addDailyScore(team.id, mission.xp);
    team.kwhSaved = Number((team.kwhSaved + kwhSaved).toFixed(3));
    team.wasteMinutesStopped = currentWasteMinutes + mission.avoidedMinutes;
    team.rewardCredits = Number((team.rewardCredits + mission.credit).toFixed(2));
    const captures = recalculateTerritories(this.state, team.id);
    for (const capture of captures) {
      team.score += 250;
      this.addDailyScore(team.id, 250);
      this.state.activity.unshift({
        id: `activity-${randomUUID()}`,
        teamId: team.id,
        text: `${team.name} captured ${capture.territoryName}`,
        at: completedAt
      });
    }
    if (!captures.length) {
      this.state.activity.unshift({
        id: `activity-${randomUUID()}`,
        teamId: team.id,
        text: `${team.name} stabilised ${mission.shortTitle}`,
        at: completedAt
      });
    }

    return {
      accepted: true,
      verification: clone(verification),
      attempt: clone(attempt),
      impact: {
        kwhSaved,
        wasteMinutesStopped: mission.avoidedMinutes,
        xpEarned: mission.xp,
        creditEarned: mission.credit,
        planetRelief: calculatePlanetRelief(kwhSaved, 1)
      },
      captures,
      state: this.bootstrap(user.id)
    };
  }
}
