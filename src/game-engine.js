'use strict';

const crypto = require('node:crypto');
const { EVENTS, EVENT_BY_ID, MISSIONS, MISSION_BY_ID } = require('./content');

const INITIAL_COMPANY = Object.freeze({ money: 60, morale: 60, risk: 20 });
const PHASE_DURATIONS = Object.freeze({
  ROLE: 15_000,
  ROUND_START: 5_000,
  EVENT: 10_000,
  INTEL: 15_000,
  DISCUSSION: 120_000,
  VOTE: 45_000,
  RESULT: 15_000,
  CHECK_COMPANY: 0,
  NEXT_ROUND: 5_000,
});

function defaultRng() {
  return crypto.randomInt(0, 0x100000000) / 0x100000000;
}

function shuffle(items, rng = defaultRng) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function compare(left, operator, right) {
  if (operator === '<') return left < right;
  if (operator === '<=') return left <= right;
  if (operator === '>') return left > right;
  if (operator === '>=') return left >= right;
  if (operator === '===') return left === right;
  throw new Error(`不支援的比較運算子：${operator}`);
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

function saboteurCount(playerCount) {
  if (playerCount < 4 || playerCount > 10) throw new Error('玩家人數必須為 4–10 人');
  return playerCount >= 8 ? 2 : 1;
}

function buildEventDeck(rng = defaultRng) {
  const early = shuffle(EVENTS.filter((event) => event.stage === 'EARLY'), rng).slice(0, 2);
  const mid = shuffle(EVENTS.filter((event) => event.stage === 'MID'), rng).slice(0, 3);
  const late = shuffle(EVENTS.filter((event) => event.stage === 'LATE'), rng).slice(0, 3);
  return [...early, ...mid, ...late].map((event) => event.id);
}

function assignRolesAndMissions(players, rng = defaultRng) {
  const shuffledPlayers = shuffle(players, rng);
  const saboteurIds = new Set(shuffledPlayers.slice(0, saboteurCount(players.length)).map((player) => player.id));
  const shuffledMissions = shuffle(MISSIONS, rng);
  let missionIndex = 0;

  return players.map((player) => {
    const isSaboteur = saboteurIds.has(player.id);
    return {
      ...player,
      role: isSaboteur ? 'SABOTEUR' : 'NORMAL',
      secretMissionId: isSaboteur ? null : shuffledMissions[missionIndex++].id,
    };
  });
}

function effectText(effects) {
  const labels = { money: 'Money', morale: 'Morale', risk: 'Risk' };
  return Object.entries(effects)
    .filter(([, value]) => value !== 0)
    .map(([stat, value]) => `${labels[stat]} ${value > 0 ? '+' : ''}${value}`)
    .join('、');
}

function buildIntel(event) {
  const intel = [];
  for (const choice of event.options) {
    intel.push(`${choice.id}｜${choice.title}的基本效果是：${effectText(choice.effects)}。`);
    if (choice.conditionalEffect) {
      intel.push(`${choice.id}｜${choice.title}有額外條件：${choice.conditionalEffect.description}`);
    }
  }
  return intel;
}

function assignIntel(players, event, rng = defaultRng) {
  const percentage = 0.3 + rng() * 0.1;
  const recipientCount = Math.max(1, Math.min(players.length, Math.round(players.length * percentage)));
  const recipients = shuffle(players.map((player) => player.id), rng).slice(0, recipientCount);
  const intelPool = shuffle(buildIntel(event), rng);
  const assignments = Object.fromEntries(players.map((player) => [player.id, null]));
  recipients.forEach((playerId, index) => {
    assignments[playerId] = intelPool[index % intelPool.length];
  });
  return assignments;
}

function conditionalMatches(conditional, statsBefore) {
  if (!conditional) return false;
  return compare(statsBefore[conditional.stat], conditional.operator, conditional.value);
}

function deathReasons(company) {
  const reasons = [];
  if (company.money <= 0) reasons.push('BANKRUPT');
  if (company.morale <= 0) reasons.push('MASS_RESIGNATION');
  if (company.risk >= 100) reasons.push('EXPLOSION');
  return reasons;
}

function applyDecision(company, choice) {
  const statsBefore = { ...company };
  const conditionalApplied = conditionalMatches(choice.conditionalEffect, statsBefore);
  const conditionalEffects = conditionalApplied ? choice.conditionalEffect.effects : {};
  const rawAfter = {};
  for (const stat of ['money', 'morale', 'risk']) {
    rawAfter[stat] = statsBefore[stat] + (choice.effects[stat] || 0) + (conditionalEffects[stat] || 0);
  }
  const statsAfter = {
    money: clamp(rawAfter.money),
    morale: clamp(rawAfter.morale),
    risk: clamp(rawAfter.risk),
  };
  return {
    statsBefore,
    statsAfter,
    baseEffects: { ...choice.effects },
    conditionalApplied,
    conditionalDescription: conditionalApplied ? choice.conditionalEffect.description : null,
    conditionalEffects: { ...conditionalEffects },
    deathReasons: deathReasons(statsAfter),
  };
}

function countVotes(votes) {
  const counts = { A: 0, B: 0, C: 0 };
  for (const optionId of Object.values(votes)) {
    if (Object.hasOwn(counts, optionId)) counts[optionId] += 1;
  }
  return counts;
}

function resolveVotes(votes, playerIds, rng = defaultRng) {
  const counts = countVotes(votes);
  const submittedIds = new Set(Object.keys(votes));
  const abstainedPlayerIds = playerIds.filter((id) => !submittedIds.has(id));
  const highest = Math.max(counts.A, counts.B, counts.C);
  const tiedOptionIds = highest === 0
    ? ['A', 'B', 'C']
    : Object.entries(counts).filter(([, count]) => count === highest).map(([id]) => id);
  const resolvedOptionId = tiedOptionIds[Math.floor(rng() * tiedOptionIds.length)];
  return { counts, abstainedPlayerIds, tiedOptionIds, resolvedOptionId };
}

function minorityOptions(counts) {
  const positive = Object.entries(counts).filter(([, count]) => count > 0);
  if (positive.length < 2) return [];
  const minimum = Math.min(...positive.map(([, count]) => count));
  const maximum = Math.max(...positive.map(([, count]) => count));
  if (minimum === maximum) return [];
  return positive.filter(([, count]) => count === minimum).map(([id]) => id);
}

function evaluateMission(mission, playerId, company, roundHistory) {
  if (!mission) return { success: false, actual: '沒有秘密任務' };
  let success = false;
  let actual = '';

  if (mission.type === 'STAT') {
    success = compare(company[mission.stat], mission.operator, mission.value);
    actual = `${mission.stat} = ${company[mission.stat]}`;
  } else if (mission.type === 'RANGE') {
    success = company[mission.stat] >= mission.min && company[mission.stat] <= mission.max;
    actual = `${mission.stat} = ${company[mission.stat]}`;
  } else if (mission.type === 'ALL_STATS') {
    success = mission.rules.every((rule) => compare(company[rule.stat], rule.operator, rule.value));
    actual = mission.rules.map((rule) => `${rule.stat} = ${company[rule.stat]}`).join('、');
  } else if (mission.type === 'ALL_RANGE') {
    success = ['money', 'morale', 'risk'].every((stat) => company[stat] >= mission.min && company[stat] <= mission.max);
    actual = `Money ${company.money}／Morale ${company.morale}／Risk ${company.risk}`;
  } else if (mission.type === 'SUM') {
    const sum = mission.stats.reduce((total, stat) => total + company[stat], 0);
    success = compare(sum, mission.operator, mission.value);
    actual = `${mission.stats.join(' + ')} = ${sum}`;
  } else if (mission.type === 'FINAL_CHOICE') {
    const matching = roundHistory.filter((record) => mission.rounds.includes(record.round)
      && record.votes[playerId] === record.resolvedOptionId).length;
    success = matching >= mission.count;
    actual = `完成 ${matching} 次／需要 ${mission.count} 次`;
  } else if (mission.type === 'MINORITY') {
    const allowedRounds = mission.rounds || roundHistory.map((record) => record.round);
    const matching = roundHistory.filter((record) => allowedRounds.includes(record.round)
      && minorityOptions(record.voteCounts).includes(record.votes[playerId])).length;
    success = matching >= mission.count;
    actual = `完成 ${matching} 次／需要 ${mission.count} 次`;
  }
  return { success, actual };
}

function buildFinalResults(room) {
  const companyAlive = deathReasons(room.company).length === 0 && room.round === 8;
  const lateDeath = !companyAlive && room.round >= 6;
  const saboteurSuccess = (companyAlive && room.company.risk >= 70) || lateDeath;
  const normalResults = room.players.filter((player) => player.role === 'NORMAL').map((player) => {
    const mission = MISSION_BY_ID.get(player.secretMissionId);
    const evaluation = companyAlive
      ? evaluateMission(mission, player.id, room.company, room.game.roundHistory)
      : { success: false, actual: '公司未能活過 Round 8' };
    return {
      playerId: player.id,
      name: player.name,
      role: player.role,
      mission: mission.text,
      actual: evaluation.actual,
      win: companyAlive && evaluation.success,
    };
  });
  const saboteurResults = room.players.filter((player) => player.role === 'SABOTEUR').map((player) => ({
    playerId: player.id,
    name: player.name,
    role: player.role,
    mission: '讓公司以 Risk ≥ 70 存活，或在 Round 6–8 倒閉',
    actual: companyAlive ? `公司存活，最終 Risk = ${room.company.risk}` : `公司於 Round ${room.round} 倒閉`,
    win: saboteurSuccess,
  }));
  return [...normalResults, ...saboteurResults];
}

function setPhase(room, phase, now) {
  room.phase = phase;
  room.phaseVersion = (room.phaseVersion || 0) + 1;
  room.phaseStartedAt = now;
  const duration = PHASE_DURATIONS[phase];
  room.phaseEndsAt = Number.isFinite(duration) ? now + duration : null;
}

function startGame(room, now = Date.now(), rng = defaultRng) {
  if (room.status !== 'LOBBY') throw new Error('遊戲已經開始');
  if (room.players.length < 4 || room.players.length > 10) throw new Error('需要 4–10 名玩家才能開始');
  room.players = assignRolesAndMissions(room.players, rng);
  room.company = { ...INITIAL_COMPANY };
  room.round = 1;
  room.status = 'PLAYING';
  room.game = {
    eventDeck: buildEventDeck(rng),
    currentEventId: null,
    currentIntelAssignments: {},
    votes: {},
    voteGraceApplied: false,
    currentResult: null,
    roundHistory: [],
    finalResults: null,
    deathReasons: [],
  };
  setPhase(room, 'ROLE', now);
  return room;
}

function resolveCurrentVote(room, rng) {
  const event = EVENT_BY_ID.get(room.game.currentEventId);
  const voteResult = resolveVotes(room.game.votes, room.players.map((player) => player.id), rng);
  const choice = event.options.find((item) => item.id === voteResult.resolvedOptionId);
  const effectResult = applyDecision(room.company, choice);
  room.company = effectResult.statsAfter;
  const record = {
    round: room.round,
    eventId: event.id,
    votes: { ...room.game.votes },
    voteCounts: voteResult.counts,
    abstainedPlayerIds: voteResult.abstainedPlayerIds,
    tiedOptionIds: voteResult.tiedOptionIds,
    resolvedOptionId: voteResult.resolvedOptionId,
    ...effectResult,
  };
  room.game.currentResult = record;
  room.game.roundHistory.push(record);
}

function advancePhase(room, now = Date.now(), rng = defaultRng) {
  if (room.status !== 'PLAYING') throw new Error('遊戲目前不在進行中');
  switch (room.phase) {
    case 'ROLE':
      room.game.currentEventId = room.game.eventDeck[room.round - 1];
      setPhase(room, 'ROUND_START', now);
      break;
    case 'ROUND_START':
      setPhase(room, 'EVENT', now);
      break;
    case 'EVENT': {
      const event = EVENT_BY_ID.get(room.game.currentEventId);
      room.game.currentIntelAssignments = assignIntel(room.players, event, rng);
      setPhase(room, 'INTEL', now);
      break;
    }
    case 'INTEL':
      setPhase(room, 'DISCUSSION', now);
      break;
    case 'DISCUSSION':
      room.game.votes = {};
      room.game.voteGraceApplied = false;
      setPhase(room, 'VOTE', now);
      break;
    case 'VOTE':
      resolveCurrentVote(room, rng);
      setPhase(room, 'RESULT', now);
      break;
    case 'RESULT':
      setPhase(room, 'CHECK_COMPANY', now);
      break;
    case 'CHECK_COMPANY': {
      const reasons = deathReasons(room.company);
      room.game.deathReasons = reasons;
      if (reasons.length > 0) {
        room.status = 'FINISHED';
        room.game.finalResults = buildFinalResults(room);
        setPhase(room, 'GAME_OVER', now);
      } else if (room.round === 8) {
        room.status = 'FINISHED';
        room.game.finalResults = buildFinalResults(room);
        setPhase(room, 'FINAL', now);
      } else {
        setPhase(room, 'NEXT_ROUND', now);
      }
      break;
    }
    case 'NEXT_ROUND':
      room.round += 1;
      room.game.currentEventId = room.game.eventDeck[room.round - 1];
      room.game.currentIntelAssignments = {};
      room.game.votes = {};
      room.game.currentResult = null;
      setPhase(room, 'ROUND_START', now);
      break;
    default:
      throw new Error(`階段 ${room.phase} 不可繼續推進`);
  }
  return room;
}

function restartToLobby(room, now = Date.now()) {
  if (room.status !== 'FINISHED') throw new Error('遊戲尚未結束');
  room.status = 'LOBBY';
  room.gameNumber = (room.gameNumber || 1) + 1;
  room.round = 0;
  room.phase = 'LOBBY';
  room.phaseVersion = (room.phaseVersion || 0) + 1;
  room.phaseStartedAt = now;
  room.phaseEndsAt = null;
  room.company = { ...INITIAL_COMPANY };
  room.game = null;
  room.players = room.players.map((player) => ({ ...player, role: null, secretMissionId: null }));
  return room;
}

module.exports = {
  INITIAL_COMPANY,
  PHASE_DURATIONS,
  advancePhase,
  applyDecision,
  assignIntel,
  assignRolesAndMissions,
  buildEventDeck,
  buildFinalResults,
  compare,
  countVotes,
  deathReasons,
  evaluateMission,
  minorityOptions,
  resolveVotes,
  restartToLobby,
  saboteurCount,
  setPhase,
  shuffle,
  startGame,
};
