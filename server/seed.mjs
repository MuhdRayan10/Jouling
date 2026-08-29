const now = Date.now();
const recent = (minutesAgo) => new Date(now - minutesAgo * 60 * 1000).toISOString();

export function createSeedState() {
  return {
    users: [
      {
        id: "u-demo",
        name: "Ari",
        avatar: "⚡",
        teamId: "team-green",
        xp: 860,
        level: 7,
        streak: 4,
        weeklyMissions: 4,
        joinedAt: recent(240)
      }
    ],
    teams: [
      {
        id: "team-green",
        code: "GREEN7",
        name: "Green Circuit",
        shortName: "Circuit",
        color: "#58CC02",
        darkColor: "#3D9200",
        emblem: "⚡",
        score: 2840,
        kwhSaved: 18.6,
        wasteMinutesStopped: 1140,
        rewardCredits: 12.4,
        memberCount: 8,
        streak: 6
      },
      {
        id: "team-gold",
        code: "SOLAR9",
        name: "Solar Sprinters",
        shortName: "Solar",
        color: "#FFC800",
        darkColor: "#C69600",
        emblem: "☀",
        score: 3110,
        kwhSaved: 20.8,
        wasteMinutesStopped: 1275,
        rewardCredits: 14.15,
        memberCount: 10,
        streak: 8
      },
      {
        id: "team-blue",
        code: "WATTS4",
        name: "Watt Watchers",
        shortName: "Watts",
        color: "#1CB0F6",
        darkColor: "#087DB4",
        emblem: "◉",
        score: 2475,
        kwhSaved: 16.1,
        wasteMinutesStopped: 987,
        rewardCredits: 10.8,
        memberCount: 7,
        streak: 5
      },
      {
        id: "team-purple",
        code: "NOVA3",
        name: "Nova Grid",
        shortName: "Nova",
        color: "#CE82FF",
        darkColor: "#8E45B8",
        emblem: "✦",
        score: 1980,
        kwhSaved: 12.7,
        wasteMinutesStopped: 779,
        rewardCredits: 8.3,
        memberCount: 6,
        streak: 3
      }
    ],
    missions: [
      {
        id: "mission-com3-projector",
        code: "COM3-AV",
        qrToken: "qr_com3_projector_2026",
        territoryId: "territory-central",
        title: "Projector power-down",
        shortTitle: "Projector",
        location: "COM3 • Seminar Room 2",
        type: "screen",
        icon: "▰",
        map: { x: 28, y: 57 },
        instruction: "Power off the labelled projector after the room is empty.",
        safety: "Only use the wall controller marked with the Jouling QR code.",
        expectedVisualEvidence: "A projector or controller visibly showing an off, standby, or black-screen state in an empty room.",
        powerBeforeKw: 0.42,
        powerAfterKw: 0.03,
        avoidedMinutes: 90,
        estimatedKwh: 0.585,
        xp: 60,
        credit: 0.45,
        difficulty: "Quick win",
        active: true,
        availableWindow: "After class",
        teamCompletions: {
          "team-green": { completedAt: recent(10), kwhSaved: 0.585, confidence: 0.94 }
        }
      },
      {
        id: "mission-study-lights",
        code: "LIB-LUX",
        qrToken: "qr_study_lights_2026",
        territoryId: "territory-central",
        title: "Lights out, level 2",
        shortTitle: "Lights",
        location: "Central Library • Study Zone",
        type: "lighting",
        icon: "✦",
        map: { x: 49, y: 35 },
        instruction: "Switch off the labelled row of lights once the zone is empty.",
        safety: "The QR is attached only to the approved lighting switch.",
        expectedVisualEvidence: "The labelled study-zone lights are visibly off and no one is using the zone.",
        powerBeforeKw: 0.76,
        powerAfterKw: 0,
        avoidedMinutes: 75,
        estimatedKwh: 0.95,
        xp: 80,
        credit: 0.7,
        difficulty: "Team task",
        active: true,
        availableWindow: "Quiet hours",
        teamCompletions: {
          "team-green": { completedAt: recent(7), kwhSaved: 0.95, confidence: 0.92 }
        }
      },
      {
        id: "mission-library-ac",
        code: "CLB-25C",
        qrToken: "qr_library_ac_2026",
        territoryId: "territory-central",
        title: "Close the cooling loop",
        shortTitle: "Cooling",
        location: "Central Library • Project Room",
        type: "cooling",
        icon: "❄",
        map: { x: 68, y: 59 },
        instruction: "When the room is empty, switch off the labelled air-conditioning controller and close the door.",
        safety: "Mission is active only outside booked hours. Do not touch the electrical panel.",
        expectedVisualEvidence: "The approved air-conditioning controller visibly reads off and the project-room door is closed.",
        powerBeforeKw: 1.2,
        powerAfterKw: 0.06,
        avoidedMinutes: 45,
        estimatedKwh: 0.855,
        xp: 120,
        credit: 1.25,
        difficulty: "Territory capture",
        active: true,
        availableWindow: "Now • no booking",
        featured: true,
        teamCompletions: {}
      },
      {
        id: "mission-utown-screen",
        code: "UTN-SCR",
        qrToken: "qr_utown_screen_2026",
        territoryId: "territory-utown",
        title: "Sleep the display wall",
        shortTitle: "Displays",
        location: "UTown • Collaboration Hub",
        type: "screen",
        icon: "▣",
        map: { x: 80, y: 26 },
        instruction: "Put the approved display wall into sleep mode after the event.",
        safety: "Use only the controller beside this QR code.",
        expectedVisualEvidence: "The display wall is dark or visibly in sleep mode, with the event area empty.",
        powerBeforeKw: 0.68,
        powerAfterKw: 0.04,
        avoidedMinutes: 120,
        estimatedKwh: 1.28,
        xp: 135,
        credit: 1.4,
        difficulty: "High impact",
        active: true,
        availableWindow: "After 6:00 PM",
        teamCompletions: {
          "team-gold": { completedAt: recent(18), kwhSaved: 1.28, confidence: 0.96 }
        }
      },
      {
        id: "mission-hall-sockets",
        code: "HALL-PLG",
        qrToken: "qr_hall_sockets_2026",
        territoryId: "territory-utown",
        title: "Stop standby drain",
        shortTitle: "Sockets",
        location: "Hall 4 • Common Lounge",
        type: "standby",
        icon: "⌁",
        map: { x: 72, y: 16 },
        instruction: "Switch off the labelled socket bank after the common lounge closes.",
        safety: "Only the green-labelled entertainment socket bank is included.",
        expectedVisualEvidence: "The green-labelled socket bank switch is visibly off and attached devices are not in active use.",
        powerBeforeKw: 0.18,
        powerAfterKw: 0.01,
        avoidedMinutes: 360,
        estimatedKwh: 1.02,
        xp: 105,
        credit: 0.95,
        difficulty: "Evening mission",
        active: true,
        availableWindow: "After 11:00 PM",
        teamCompletions: {
          "team-gold": { completedAt: recent(15), kwhSaved: 1.02, confidence: 0.9 }
        }
      },
      {
        id: "mission-innovation-door",
        code: "INN-DOOR",
        qrToken: "qr_innovation_door_2026",
        territoryId: "territory-utown",
        title: "Seal the cool air",
        shortTitle: "Door",
        location: "Innovation 4.0 • Studio",
        type: "cooling",
        icon: "↥",
        map: { x: 91, y: 43 },
        instruction: "Close the approved studio door while air-conditioning is running.",
        safety: "Do not lock the door or obstruct access routes.",
        expectedVisualEvidence: "The named studio door is fully closed while the room remains safely accessible.",
        powerBeforeKw: 1.48,
        powerAfterKw: 1.2,
        avoidedMinutes: 90,
        estimatedKwh: 0.42,
        xp: 70,
        credit: 0.35,
        difficulty: "Quick win",
        active: false,
        availableWindow: "Class in progress",
        teamCompletions: {}
      }
    ],
    territories: [
      {
        id: "territory-central",
        name: "Central Commons",
        areaSqFt: 18500,
        nodeIds: ["mission-com3-projector", "mission-study-lights", "mission-library-ac"],
        polygon: [[28, 57], [49, 35], [68, 59]],
        ownerTeamId: "team-gold",
        previousOwnerTeamId: "team-blue",
        strength: 61,
        capturedAt: recent(95),
        teamProgress: {
          "team-green": {
            completedNodeIds: ["mission-com3-projector", "mission-study-lights"],
            completed: 2,
            required: 3,
            percent: 67,
            verifiedKwh: 1.535
          }
        }
      },
      {
        id: "territory-utown",
        name: "UTown Triangle",
        areaSqFt: 22400,
        nodeIds: ["mission-utown-screen", "mission-hall-sockets", "mission-innovation-door"],
        polygon: [[80, 26], [72, 16], [91, 43]],
        ownerTeamId: "team-gold",
        previousOwnerTeamId: "team-purple",
        strength: 78,
        capturedAt: recent(64),
        teamProgress: {}
      }
    ],
    dailyMatchups: [
      {
        id: "daily-green-blue",
        teamAId: "team-green",
        teamBId: "team-blue",
        teamAScore: 460,
        teamBScore: 405,
        startsAt: new Date(new Date(now).setHours(0, 0, 0, 0)).toISOString(),
        endsAt: new Date(new Date(now).setHours(24, 0, 0, 0)).toISOString(),
        rewardXp: 180
      },
      {
        id: "daily-gold-purple",
        teamAId: "team-gold",
        teamBId: "team-purple",
        teamAScore: 510,
        teamBScore: 438,
        startsAt: new Date(new Date(now).setHours(0, 0, 0, 0)).toISOString(),
        endsAt: new Date(new Date(now).setHours(24, 0, 0, 0)).toISOString(),
        rewardXp: 180
      }
    ],
    attempts: [],
    activity: [
      { id: "a1", teamId: "team-gold", text: "Solar Sprinters defended UTown Triangle", at: recent(9) },
      { id: "a2", teamId: "team-green", text: "Green Circuit stabilised Library Lights", at: recent(7) },
      { id: "a3", teamId: "team-blue", text: "Watt Watchers saved 0.8 kWh at Engineering", at: recent(14) }
    ]
  };
}
