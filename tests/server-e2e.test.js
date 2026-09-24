'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let child;
let baseUrl;
let tempDirectory;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`測試伺服器意外結束：${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // 啟動期間尚未接受連線。
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('測試伺服器啟動逾時');
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function hostAction(roomCode, hostToken, view, action) {
  return api(`/api/rooms/${roomCode}/action`, {
    method: 'POST',
    body: { action, token: hostToken, expectedPhaseVersion: view.phaseVersion },
  });
}

function chooseSafestOption(view) {
  const before = view.company;
  const simulated = view.event.options.map((option) => {
    const conditional = option.conditionalEffect;
    let conditionalApplies = false;
    if (conditional) {
      const left = before[conditional.stat];
      conditionalApplies = conditional.operator === '<' ? left < conditional.value
        : conditional.operator === '<=' ? left <= conditional.value
          : conditional.operator === '>=' ? left >= conditional.value
            : conditional.operator === '>' ? left > conditional.value : false;
    }
    const effects = conditionalApplies ? conditional.effects : {};
    const after = {
      money: Math.max(0, Math.min(100, before.money + (option.effects.money || 0) + (effects.money || 0))),
      morale: Math.max(0, Math.min(100, before.morale + (option.effects.morale || 0) + (effects.morale || 0))),
      risk: Math.max(0, Math.min(100, before.risk + (option.effects.risk || 0) + (effects.risk || 0))),
    };
    const dead = after.money <= 0 || after.morale <= 0 || after.risk >= 100;
    const safety = Math.min(after.money, after.morale, 100 - after.risk);
    return { id: option.id, dead, safety };
  });
  simulated.sort((left, right) => Number(left.dead) - Number(right.dead) || right.safety - left.safety);
  return simulated[0].id;
}

test.before(async () => {
  const port = await freePort();
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'who-sabotaged-e2e-'));
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_FILE: path.join(tempDirectory, 'rooms.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(baseUrl);
});

test.after(() => {
  if (child && child.exitCode === null) child.kill();
  if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('7 名玩家可經 API 完成八回合，秘密資料不外洩且重複操作被阻擋', { timeout: 30_000 }, async () => {
  const created = await api('/api/rooms', { method: 'POST' });
  const joined = [];
  for (let index = 1; index <= 7; index += 1) {
    joined.push(await api(`/api/rooms/${created.roomCode}/join`, { method: 'POST', body: { name: `玩家${index}` } }));
  }

  let hostView = await api(`/api/rooms/${created.roomCode}/view?token=${created.hostToken}`);
  assert.equal(hostView.playerCount, 7);
  assert.equal(hostView.private, null);
  assert.deepEqual(Object.keys(hostView.players[0]).sort(), ['connected', 'id', 'name', 'seatOrder']);
  await hostAction(created.roomCode, created.hostToken, hostView, 'START');

  const playerView = await api(`/api/rooms/${created.roomCode}/view?token=${joined[0].playerToken}`);
  assert.ok(['NORMAL', 'SABOTEUR'].includes(playerView.private.role));
  assert.equal(playerView.players.some((player) => Object.hasOwn(player, 'role')), false);

  const resultRounds = new Set();
  const visitedPhases = new Set();
  let duplicateVoteBlocked = false;
  let staleAdvanceBlocked = false;

  for (let steps = 0; steps < 100 && hostView.status !== 'FINISHED'; steps += 1) {
    hostView = await api(`/api/rooms/${created.roomCode}/view?token=${created.hostToken}`);
    visitedPhases.add(hostView.phase);
    if (hostView.phase === 'RESULT') resultRounds.add(hostView.round);
    if (hostView.status === 'FINISHED') break;

    if (hostView.phase === 'VOTE') {
      const optionId = chooseSafestOption(hostView);
      for (const player of joined) {
        await api(`/api/rooms/${created.roomCode}/action`, {
          method: 'POST',
          body: { action: 'VOTE', optionId, token: player.playerToken, expectedPhaseVersion: hostView.phaseVersion },
        });
      }
      if (!duplicateVoteBlocked) {
        await assert.rejects(() => api(`/api/rooms/${created.roomCode}/action`, {
          method: 'POST',
          body: { action: 'VOTE', optionId, token: joined[0].playerToken, expectedPhaseVersion: hostView.phaseVersion },
        }), /已投票/);
        duplicateVoteBlocked = true;
      }
    }

    const versionBeforeAdvance = hostView.phaseVersion;
    await hostAction(created.roomCode, created.hostToken, hostView, 'ADVANCE');
    if (!staleAdvanceBlocked) {
      await assert.rejects(() => api(`/api/rooms/${created.roomCode}/action`, {
        method: 'POST',
        body: { action: 'ADVANCE', token: created.hostToken, expectedPhaseVersion: versionBeforeAdvance },
      }), /畫面狀態已更新/);
      staleAdvanceBlocked = true;
    }
  }

  hostView = await api(`/api/rooms/${created.roomCode}/view?token=${created.hostToken}`);
  assert.equal(hostView.status, 'FINISHED');
  assert.equal(hostView.round, 8);
  assert.equal(resultRounds.size, 8);
  for (const phase of ['ROLE', 'ROUND_START', 'EVENT', 'INTEL', 'DISCUSSION', 'VOTE', 'RESULT', 'CHECK_COMPANY', 'NEXT_ROUND']) {
    assert.equal(visitedPhases.has(phase), true, `缺少階段 ${phase}`);
  }
  assert.equal(hostView.finalResults.length, 7);
  assert.equal(hostView.finalResults.at(-1).role, 'SABOTEUR');
  assert.equal(duplicateVoteBlocked, true);
  assert.equal(staleAdvanceBlocked, true);
});

test('Host 解散房間後，房間與所有玩家 Token 立即失效', async () => {
  const created = await api('/api/rooms', { method: 'POST' });
  const joined = await api(`/api/rooms/${created.roomCode}/join`, { method: 'POST', body: { name: '測試玩家' } });
  const view = await api(`/api/rooms/${created.roomCode}/view?token=${created.hostToken}`);
  const result = await hostAction(created.roomCode, created.hostToken, view, 'DISBAND');
  assert.equal(result.disbanded, true);
  await assert.rejects(() => api(`/api/rooms/${created.roomCode}/view?token=${created.hostToken}`), (error) => error.status === 404);
  await assert.rejects(() => api(`/api/rooms/${created.roomCode}/view?token=${joined.playerToken}`), (error) => error.status === 404);
});
