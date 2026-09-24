'use strict';

const { advancePhase, startGame } = require('../src/game-engine');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function players(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `玩家${index + 1}`,
    role: null,
    secretMissionId: null,
    connected: true,
  }));
}

function simulateGame(gameIndex, playerCount = 7) {
  const rng = seededRandom(gameIndex + 1);
  const room = {
    roomCode: 'SIM', status: 'LOBBY', gameNumber: 1, round: 0, phase: 'LOBBY', phaseVersion: 1,
    company: { money: 60, morale: 60, risk: 20 }, players: players(playerCount), game: null,
  };
  startGame(room, 0, rng);
  let transitions = 0;
  while (room.status === 'PLAYING') {
    if (transitions > 100) throw new Error(`狀態機疑似無限循環：game ${gameIndex}`);
    if (room.phase === 'VOTE') {
      for (const player of room.players) room.game.votes[player.id] = ['A', 'B', 'C'][Math.floor(rng() * 3)];
    }
    advancePhase(room, transitions + 1, rng);
    transitions += 1;
  }
  if (room.game.roundHistory.length !== room.round) throw new Error(`回合紀錄數量錯誤：game ${gameIndex}`);
  if (new Set(room.game.roundHistory.map((record) => record.eventId)).size !== room.game.roundHistory.length) {
    throw new Error(`同局事件重複：game ${gameIndex}`);
  }
  return room;
}

function run(totalGames = 10_000) {
  const summary = {
    games: totalGames,
    survived: 0,
    earlyDeathsRound1To2: 0,
    deathsRound1To5: 0,
    deathsRound6To8: 0,
    saboteurWins: 0,
    normalWins: 0,
    normalPlayers: 0,
    missionResults: {},
    deathRounds: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, 0])),
  };
  for (let index = 0; index < totalGames; index += 1) {
    const room = simulateGame(index);
    const died = room.phase === 'GAME_OVER';
    if (!died) summary.survived += 1;
    if (died) {
      summary.deathRounds[room.round] += 1;
      if (room.round <= 2) summary.earlyDeathsRound1To2 += 1;
      if (room.round <= 5) summary.deathsRound1To5 += 1;
      else summary.deathsRound6To8 += 1;
    }
    for (const result of room.game.finalResults) {
      if (result.role === 'SABOTEUR' && result.win) summary.saboteurWins += 1;
      if (result.role === 'NORMAL') {
        summary.normalPlayers += 1;
        if (result.win) summary.normalWins += 1;
        const mission = summary.missionResults[result.mission] || { assigned: 0, survivedAssigned: 0, wins: 0 };
        mission.assigned += 1;
        if (!died) mission.survivedAssigned += 1;
        if (result.win) mission.wins += 1;
        summary.missionResults[result.mission] = mission;
      }
    }
  }
  const percentage = (number, denominator = totalGames) => `${(number / denominator * 100).toFixed(2)}%`;
  const missionResults = Object.fromEntries(Object.entries(summary.missionResults)
    .map(([mission, result]) => [mission, {
      ...result,
      winRateAllGames: percentage(result.wins, result.assigned),
      winRateWhenCompanySurvives: percentage(result.wins, result.survivedAssigned),
    }])
    .sort((left, right) => Number.parseFloat(left[1].winRateWhenCompanySurvives) - Number.parseFloat(right[1].winRateWhenCompanySurvives)));
  return {
    ...summary,
    survivalRate: percentage(summary.survived),
    earlyDeathRate: percentage(summary.earlyDeathsRound1To2),
    saboteurWinRate: percentage(summary.saboteurWins),
    normalMissionWinRateAllGames: percentage(summary.normalWins, summary.normalPlayers),
    normalMissionWinRateSurvivedGames: percentage(summary.normalWins, summary.survived * 6),
    missionResults,
  };
}

if (require.main === module) console.log(JSON.stringify(run(Number(process.argv[2] || 10_000)), null, 2));

module.exports = { run, simulateGame };
