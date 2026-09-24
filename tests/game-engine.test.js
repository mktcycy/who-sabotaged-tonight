'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS, EVENT_BY_ID, MISSIONS } = require('../src/content');
const {
  advancePhase,
  applyDecision,
  assignIntel,
  assignRolesAndMissions,
  buildEventDeck,
  buildFinalResults,
  deathReasons,
  evaluateMission,
  minorityOptions,
  missionRequiredCount,
  missionText,
  PHASE_DURATIONS,
  resolveVotes,
  restartToLobby,
  saboteurCount,
  startGame,
} = require('../src/game-engine');

const fixedRng = (value = 0) => () => value;
const players = (count) => Array.from({ length: count }, (_, index) => ({
  id: `p${index + 1}`,
  name: `玩家${index + 1}`,
  role: null,
  secretMissionId: null,
  connected: true,
}));

function roomWith(playerCount = 7) {
  return {
    roomCode: '1234', status: 'LOBBY', gameNumber: 1, round: 0, phase: 'LOBBY', phaseVersion: 1,
    company: { money: 60, morale: 60, risk: 20 }, players: players(playerCount), game: null,
  };
}

test('內容池包含 18 個事件、三階段各 6 個，且每事件固定三選項', () => {
  assert.equal(EVENTS.length, 18);
  for (const stage of ['EARLY', 'MID', 'LATE']) assert.equal(EVENTS.filter((event) => event.stage === stage).length, 6);
  for (const event of EVENTS) {
    assert.equal(event.options.length, 3);
    assert.deepEqual(event.options.map((option) => option.id), ['A', 'B', 'C']);
    assert.ok(event.options.every((option) => !option.conditionalEffect || typeof option.conditionalEffect === 'object'));
  }
  assert.equal(MISSIONS.length, 20);
});

test('每個事件的基本效果都不存在全面劣於另一選項的方案', () => {
  for (const event of EVENTS) {
    for (const candidate of event.options) {
      const dominated = event.options.some((other) => other !== candidate
        && other.effects.money >= candidate.effects.money
        && other.effects.morale >= candidate.effects.morale
        && other.effects.risk <= candidate.effects.risk
        && (other.effects.money > candidate.effects.money
          || other.effects.morale > candidate.effects.morale
          || other.effects.risk < candidate.effects.risk));
      assert.equal(dominated, false, `${event.id} 的 ${candidate.id} 為全面劣勢選項`);
    }
  }
});

test('4–7 人一名搞事仔，8–10 人兩名', () => {
  for (let count = 4; count <= 7; count += 1) assert.equal(saboteurCount(count), 1);
  for (let count = 8; count <= 10; count += 1) assert.equal(saboteurCount(count), 2);
  assert.throws(() => saboteurCount(3));
  assert.throws(() => saboteurCount(11));
});

test('角色與任務分配數量正確，搞事仔沒有無效秘密任務', () => {
  for (const count of [4, 7, 8, 10]) {
    const assigned = assignRolesAndMissions(players(count), fixedRng(0.42));
    assert.equal(assigned.filter((player) => player.role === 'SABOTEUR').length, count >= 8 ? 2 : 1);
    assert.ok(assigned.filter((player) => player.role === 'SABOTEUR').every((player) => player.secretMissionId === null));
    const normalMissions = assigned.filter((player) => player.role === 'NORMAL').map((player) => player.secretMissionId);
    assert.equal(new Set(normalMissions).size, normalMissions.length);
  }
});

test('牌組固定 Early 2、Mid 3、Late 3 且同局不重複', () => {
  const deck = buildEventDeck(fixedRng(0.31));
  assert.equal(deck.length, 8);
  assert.equal(new Set(deck).size, 8);
  assert.ok(deck.slice(0, 2).every((id) => EVENT_BY_ID.get(id).stage === 'EARLY'));
  assert.ok(deck.slice(2, 5).every((id) => EVENT_BY_ID.get(id).stage === 'MID'));
  assert.ok(deck.slice(5, 8).every((id) => EVENT_BY_ID.get(id).stage === 'LATE'));
});

test('條件效果依 statsBefore 判斷，結算後 clamp 至 0–100', () => {
  const choice = {
    effects: { money: -20, morale: 5, risk: 15 },
    conditionalEffect: { stat: 'money', operator: '<', value: 40, effects: { risk: 20 }, description: 'test' },
  };
  const result = applyDecision({ money: 35, morale: 98, risk: 90 }, choice);
  assert.equal(result.conditionalApplied, true);
  assert.deepEqual(result.statsAfter, { money: 15, morale: 100, risk: 100 });
  assert.deepEqual(result.deathReasons, ['EXPLOSION']);
});

test('同時死亡條件全部保留', () => {
  assert.deepEqual(deathReasons({ money: 0, morale: 0, risk: 100 }), ['BANKRUPT', 'MASS_RESIGNATION', 'EXPLOSION']);
});

test('單一最高票、最高票平票與全員棄權皆正確', () => {
  const ids = ['p1', 'p2', 'p3', 'p4'];
  assert.equal(resolveVotes({ p1: 'A', p2: 'A', p3: 'B' }, ids, fixedRng(0)).resolvedOptionId, 'A');
  const tie = resolveVotes({ p1: 'A', p2: 'B' }, ids, fixedRng(0.99));
  assert.deepEqual(tie.tiedOptionIds, ['A', 'B']);
  assert.equal(tie.resolvedOptionId, 'B');
  assert.deepEqual(tie.abstainedPlayerIds, ['p3', 'p4']);
  const allAbstain = resolveVotes({}, ids, fixedRng(0.99));
  assert.deepEqual(allAbstain.tiedOptionIds, ['A', 'B', 'C']);
  assert.equal(allAbstain.resolvedOptionId, 'C');
  const restricted = resolveVotes({ p1: 'A', p2: 'B' }, ids, fixedRng(0.99), ['A', 'B']);
  assert.deepEqual(restricted.tiedOptionIds, ['A', 'B']);
});

test('討論階段不限時間，首次平票進入一次 10 秒快速重投', () => {
  assert.equal(PHASE_DURATIONS.DISCUSSION, null);
  assert.equal(PHASE_DURATIONS.REVOTE, 10_000);
  const room = roomWith(4);
  startGame(room, 1000, fixedRng(0.2));
  room.phase = 'VOTE';
  room.game.currentEventId = room.game.eventDeck[0];
  room.game.votes = { p1: 'A', p2: 'A', p3: 'B', p4: 'B' };
  advancePhase(room, 2000, fixedRng(0));
  assert.equal(room.phase, 'REVOTE');
  assert.equal(room.phaseEndsAt, 12_000);
  assert.deepEqual(room.game.revoteOptionIds, ['A', 'B']);
  assert.deepEqual(room.game.votes, {});

  room.game.votes = { p1: 'A', p2: 'A', p3: 'B', p4: 'B' };
  advancePhase(room, 3000, fixedRng(0.99));
  assert.equal(room.phase, 'RESULT');
  assert.equal(room.game.currentResult.resolvedOptionId, 'B');
  assert.deepEqual(room.game.currentResult.initialVoteResult.tiedOptionIds, ['A', 'B']);
});

test('少數選項排除零票、棄權及全同票', () => {
  assert.deepEqual(minorityOptions({ A: 3, B: 1, C: 0 }), ['B']);
  assert.deepEqual(minorityOptions({ A: 2, B: 1, C: 1 }), ['B', 'C']);
  assert.deepEqual(minorityOptions({ A: 1, B: 1, C: 1 }), []);
  assert.deepEqual(minorityOptions({ A: 3, B: 0, C: 0 }), []);
});

test('7 人局情報通常分配 2–3 人且未獲得者為 null', () => {
  const assignedLow = assignIntel(players(7), EVENTS[0], fixedRng(0));
  assert.equal(Object.values(assignedLow).filter(Boolean).length, 2);
  const assignedHigh = assignIntel(players(7), EVENTS[0], fixedRng(0.99));
  assert.equal(Object.values(assignedHigh).filter(Boolean).length, 3);
});

test('行為型任務按最終選項與嚴格少數定義計算', () => {
  const history = [
    { round: 6, votes: { p1: 'A' }, resolvedOptionId: 'A', voteCounts: { A: 3, B: 1, C: 0 } },
    { round: 7, votes: { p1: 'B' }, resolvedOptionId: 'B', voteCounts: { A: 2, B: 2, C: 0 } },
    { round: 8, votes: { p1: 'C' }, resolvedOptionId: 'A', voteCounts: { A: 3, B: 2, C: 1 } },
  ];
  const finalChoice = { type: 'FINAL_CHOICE', rounds: [6, 7, 8], count: 2 };
  const minority = { type: 'MINORITY', rounds: [6, 7, 8], count: 1 };
  assert.equal(evaluateMission(finalChoice, 'p1', {}, history).success, true);
  assert.equal(evaluateMission(minority, 'p1', {}, history).success, true);
});

test('B03 行為任務依玩家人數調整所需次數', () => {
  const mission = MISSIONS.find((item) => item.id === 'B03');
  assert.equal(missionRequiredCount(mission, 4), 5);
  assert.equal(missionRequiredCount(mission, 6), 5);
  assert.equal(missionRequiredCount(mission, 7), 4);
  assert.equal(missionRequiredCount(mission, 10), 4);
  assert.match(missionText(mission, 4), /5次/);
  assert.match(missionText(mission, 10), /4次/);
  const history = Array.from({ length: 4 }, (_, index) => ({
    round: index + 1, votes: { p1: 'A' }, resolvedOptionId: 'A', voteCounts: { A: 4, B: 0, C: 0 },
  }));
  assert.equal(evaluateMission(mission, 'p1', {}, history, 4).success, false);
  assert.equal(evaluateMission(mission, 'p1', {}, history, 7).success, true);
});

test('完整狀態機跑完 8 回合且每回合只留一筆紀錄', () => {
  const room = roomWith(7);
  startGame(room, 1000, fixedRng(0.2));
  assert.equal(room.phase, 'ROLE');
  while (room.status === 'PLAYING') {
    if (room.phase === 'VOTE') {
      for (const player of room.players) room.game.votes[player.id] = 'B';
    }
    advancePhase(room, (room.phaseStartedAt || 0) + 1000, fixedRng(0));
  }
  assert.equal(room.round, 8);
  assert.equal(room.phase, 'FINAL');
  assert.equal(room.game.roundHistory.length, 8);
  assert.equal(room.game.finalResults.at(-1).role, 'SABOTEUR');
});

test('Round 1–5 死亡全員失敗；Round 6–8 死亡搞事仔勝利', () => {
  for (const round of [5, 6]) {
    const room = roomWith(7);
    room.players = assignRolesAndMissions(room.players, fixedRng(0));
    room.round = round;
    room.company = { money: 0, morale: 50, risk: 80 };
    room.game = { roundHistory: [] };
    const results = buildFinalResults(room);
    const saboteur = results.find((result) => result.role === 'SABOTEUR');
    assert.equal(saboteur.win, round >= 6);
    assert.ok(results.filter((result) => result.role === 'NORMAL').every((result) => !result.win));
  }
});

test('Round 8 存活時 Risk 69 搞事仔敗，Risk 70 勝', () => {
  for (const risk of [69, 70]) {
    const room = roomWith(7);
    room.players = assignRolesAndMissions(room.players, fixedRng(0));
    room.round = 8;
    room.company = { money: 50, morale: 50, risk };
    room.game = { roundHistory: [] };
    const saboteur = buildFinalResults(room).find((result) => result.role === 'SABOTEUR');
    assert.equal(saboteur.win, risk === 70);
  }
});

test('再玩一場保留玩家但清空角色、任務與上一局資料', () => {
  const room = roomWith(7);
  startGame(room, 1000, fixedRng(0));
  room.status = 'FINISHED';
  room.phase = 'FINAL';
  const ids = room.players.map((player) => player.id);
  restartToLobby(room, 2000);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.game, null);
  assert.deepEqual(room.players.map((player) => player.id), ids);
  assert.ok(room.players.every((player) => player.role === null && player.secretMissionId === null));
});
