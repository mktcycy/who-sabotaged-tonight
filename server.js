'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore } = require('./src/store');
const { EVENT_BY_ID, MISSION_BY_ID } = require('./src/content');
const {
  INITIAL_COMPANY,
  advancePhase,
  missionText,
  restartToLobby,
  startGame,
} = require('./src/game-engine');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const store = new JsonStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json'));
const streams = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function token() {
  return crypto.randomBytes(32).toString('base64url');
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function findViewer(room, rawToken) {
  const tokenHash = hash(rawToken || '');
  if (safeEqual(tokenHash, room.hostTokenHash)) return { type: 'HOST' };
  const player = room.players.find((candidate) => safeEqual(tokenHash, candidate.playerTokenHash));
  if (player) return { type: 'PLAYER', player };
  return null;
}

function publicEvent(room) {
  if (!room.game?.currentEventId) return null;
  const hiddenPhases = new Set(['ROLE', 'ROUND_START']);
  return hiddenPhases.has(room.phase) ? null : EVENT_BY_ID.get(room.game.currentEventId);
}

function publicResult(room) {
  const result = room.game?.currentResult;
  if (!result || !['RESULT', 'CHECK_COMPANY', 'GAME_OVER', 'FINAL'].includes(room.phase)) return null;
  return {
    round: result.round,
    eventId: result.eventId,
    voteCounts: result.voteCounts,
    abstainCount: result.abstainedPlayerIds.length,
    tiedOptionIds: result.tiedOptionIds,
    resolvedOptionId: result.resolvedOptionId,
    initialVoteResult: result.initialVoteResult ? {
      voteCounts: result.initialVoteResult.voteCounts,
      abstainCount: result.initialVoteResult.abstainedPlayerIds.length,
      tiedOptionIds: result.initialVoteResult.tiedOptionIds,
    } : null,
    revoteOptionIds: result.revoteOptionIds,
    statsBefore: result.statsBefore,
    statsAfter: result.statsAfter,
    baseEffects: result.baseEffects,
    conditionalApplied: result.conditionalApplied,
    conditionalDescription: result.conditionalDescription,
    conditionalEffects: result.conditionalEffects,
    deathReasons: result.deathReasons,
  };
}

function sanitizeRoom(room, viewer) {
  const votes = room.game?.votes || {};
  const player = viewer.type === 'PLAYER' ? viewer.player : null;
  const privateData = player && room.status !== 'LOBBY' ? {
    role: player.role,
    mission: player.secretMissionId ? missionText(MISSION_BY_ID.get(player.secretMissionId), room.players.length) : null,
    saboteurGoal: player.role === 'SABOTEUR' ? '讓公司以 Risk ≥ 70 存活，或在 Round 6–8 倒閉。' : null,
    partners: player.role === 'SABOTEUR'
      ? room.players.filter((candidate) => candidate.role === 'SABOTEUR' && candidate.id !== player.id).map((candidate) => candidate.name)
      : [],
    intel: ['INTEL', 'DISCUSSION', 'VOTE', 'REVOTE', 'RESULT', 'CHECK_COMPANY'].includes(room.phase)
      ? (room.game?.currentIntelAssignments[player.id] || null)
      : null,
    hasVoted: Object.hasOwn(votes, player.id),
    selectedOptionId: Object.hasOwn(votes, player.id) ? votes[player.id] : null,
  } : null;

  return {
    roomCode: room.roomCode,
    status: room.status,
    gameNumber: room.gameNumber,
    round: room.round,
    phase: room.phase,
    phaseVersion: room.phaseVersion,
    phaseStartedAt: room.phaseStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
    company: room.company,
    players: room.players.map(({ id, name, connected, seatOrder }) => ({ id, name, connected, seatOrder })),
    playerCount: room.players.length,
    event: publicEvent(room),
    voteProgress: {
      submitted: Object.keys(votes).length,
      total: room.players.length,
    },
    allowedVoteOptionIds: room.phase === 'REVOTE'
      ? [...(room.game?.revoteOptionIds || [])]
      : ['A', 'B', 'C'],
    result: publicResult(room),
    deathReasons: room.game?.deathReasons || [],
    finalResults: ['FINAL', 'GAME_OVER'].includes(room.phase) ? room.game?.finalResults : null,
    viewerType: viewer.type,
    playerId: player?.id || null,
    private: privateData,
    controls: viewer.type === 'HOST' ? {
      canStart: room.status === 'LOBBY' && room.players.length >= 4 && room.players.length <= 10,
      canAdvance: room.status === 'PLAYING',
      canRestart: room.status === 'FINISHED',
      canDisband: true,
    } : null,
  };
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('請求內容過大');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('JSON 格式錯誤');
  }
}

function generateRoomCode() {
  const existing = new Set(store.listRooms().map((room) => room.roomCode));
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const code = String(crypto.randomInt(0, 10_000)).padStart(4, '0');
    if (!existing.has(code)) return code;
  }
  throw new Error('目前沒有可用房號');
}

function sendStream(response, eventName, payload) {
  response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function broadcast(roomCode) {
  const room = store.getRoom(roomCode);
  if (!room) return;
  for (const client of streams.get(roomCode) || []) {
    const viewer = findViewer(room, client.token);
    if (!viewer) {
      client.response.end();
      continue;
    }
    sendStream(client.response, 'state', sanitizeRoom(room, viewer));
  }
}

function broadcastDisbanded(roomCode) {
  for (const client of streams.get(roomCode) || []) {
    sendStream(client.response, 'disbanded', { roomCode, message: 'Host 已解散遊戲' });
    client.response.end();
  }
  streams.delete(roomCode);
}

function activeConnections(roomCode, rawToken) {
  return [...(streams.get(roomCode) || [])].filter((client) => client.token === rawToken).length;
}

async function setPlayerConnection(roomCode, rawToken, connected) {
  try {
    await store.updateRoom(roomCode, (room) => {
      const viewer = findViewer(room, rawToken);
      if (viewer?.type !== 'PLAYER') return;
      viewer.player.connected = connected;
      viewer.player.lastSeenAt = Date.now();
    });
    await broadcast(roomCode);
  } catch {
    // 房間若已不存在，關閉連線時不需額外處理。
  }
}

async function handleCreateRoom(response) {
  const roomCode = generateRoomCode();
  const hostToken = token();
  const now = Date.now();
  await store.createRoom({
    roomCode,
    hostTokenHash: hash(hostToken),
    status: 'LOBBY',
    gameNumber: 1,
    round: 0,
    phase: 'LOBBY',
    phaseVersion: 1,
    phaseStartedAt: now,
    phaseEndsAt: null,
    company: { ...INITIAL_COMPANY },
    players: [],
    game: null,
    createdAt: now,
    updatedAt: now,
  });
  json(response, 201, { roomCode, hostToken, hostUrl: `/host.html?room=${roomCode}` });
}

async function handleJoin(roomCode, request, response) {
  const body = await readBody(request);
  const suppliedToken = typeof body.playerToken === 'string' ? body.playerToken : null;
  let returnedToken = suppliedToken;
  let playerId = null;

  await store.updateRoom(roomCode, (room) => {
    if (suppliedToken) {
      const viewer = findViewer(room, suppliedToken);
      if (viewer?.type === 'PLAYER') {
        playerId = viewer.player.id;
        return;
      }
    }
    if (room.status !== 'LOBBY') throw new Error('遊戲已開始，只允許原玩家恢復連線');
    if (room.players.length >= 10) throw new Error('房間已滿');
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 16) throw new Error('暱稱長度須為 1–16 個字元');
    if (room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error('此暱稱已被使用');
    }
    returnedToken = token();
    const newPlayer = {
      id: crypto.randomUUID(),
      playerTokenHash: hash(returnedToken),
      name,
      seatOrder: room.players.length + 1,
      role: null,
      secretMissionId: null,
      connected: false,
      lastSeenAt: Date.now(),
      joinedAt: Date.now(),
    };
    room.players.push(newPlayer);
    playerId = newPlayer.id;
  });
  await broadcast(roomCode);
  json(response, 200, { roomCode, playerId, playerToken: returnedToken, playUrl: `/play.html?room=${roomCode}` });
}

async function handleView(roomCode, rawToken, response) {
  const room = store.getRoom(roomCode);
  if (!room) return json(response, 404, { error: '找不到房間' });
  const viewer = findViewer(room, rawToken);
  if (!viewer) return json(response, 401, { error: '驗證失敗' });
  return json(response, 200, sanitizeRoom(room, viewer));
}

async function handleAction(roomCode, request, response) {
  const body = await readBody(request);
  const action = String(body.action || '');
  const rawToken = String(body.token || '');
  if (action === 'DISBAND') {
    await store.deleteRoom(roomCode, (room) => {
      const viewer = findViewer(room, rawToken);
      if (viewer?.type !== 'HOST') throw new Error('只有 Host 可以解散遊戲');
      if (Number(body.expectedPhaseVersion) !== room.phaseVersion) {
        throw new Error('畫面狀態已更新，請依最新狀態操作');
      }
    });
    broadcastDisbanded(roomCode);
    return json(response, 200, { ok: true, disbanded: true });
  }
  await store.updateRoom(roomCode, (room) => {
    const viewer = findViewer(room, rawToken);
    if (!viewer) throw new Error('驗證失敗');
    if (Number(body.expectedPhaseVersion) !== room.phaseVersion) {
      throw new Error('畫面狀態已更新，請依最新狀態操作');
    }
    if (action === 'VOTE') {
      if (viewer.type !== 'PLAYER') throw new Error('只有玩家可以投票');
      if (room.status !== 'PLAYING' || !['VOTE', 'REVOTE'].includes(room.phase)) throw new Error('目前不是投票階段');
      if (Object.hasOwn(room.game.votes, viewer.player.id)) throw new Error('本回合已投票');
      const optionId = String(body.optionId || '');
      const event = EVENT_BY_ID.get(room.game.currentEventId);
      const allowedOptionIds = room.phase === 'REVOTE' ? room.game.revoteOptionIds : event.options.map((choice) => choice.id);
      if (!allowedOptionIds.includes(optionId)) throw new Error('無效選項');
      room.game.votes[viewer.player.id] = optionId;
      const onlinePlayers = room.players.filter((player) => player.connected);
      const allOnlineVoted = onlinePlayers.length > 0
        && onlinePlayers.every((player) => Object.hasOwn(room.game.votes, player.id));
      if (allOnlineVoted && !room.game.voteGraceApplied) {
        room.game.voteGraceApplied = true;
        room.phaseEndsAt = Math.min(room.phaseEndsAt, Date.now() + 3_000);
      }
      return;
    }
    if (viewer.type !== 'HOST') throw new Error('只有 Host 可以執行此操作');
    if (action === 'START') startGame(room);
    else if (action === 'ADVANCE') advancePhase(room);
    else if (action === 'RESTART') restartToLobby(room);
    else throw new Error('未知操作');
  });
  await broadcast(roomCode);
  return json(response, 200, { ok: true });
}

async function handleStream(roomCode, rawToken, request, response) {
  const room = store.getRoom(roomCode);
  if (!room) return json(response, 404, { error: '找不到房間' });
  const viewer = findViewer(room, rawToken);
  if (!viewer) return json(response, 401, { error: '驗證失敗' });
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Referrer-Policy': 'no-referrer',
  });
  response.write('retry: 1500\n\n');
  const client = { response, token: rawToken };
  if (!streams.has(roomCode)) streams.set(roomCode, new Set());
  streams.get(roomCode).add(client);
  sendStream(response, 'state', sanitizeRoom(room, viewer));
  if (viewer.type === 'PLAYER') await setPlayerConnection(roomCode, rawToken, true);

  request.on('close', () => {
    streams.get(roomCode)?.delete(client);
    if (streams.get(roomCode)?.size === 0) streams.delete(roomCode);
    if (viewer.type === 'PLAYER' && activeConnections(roomCode, rawToken) === 0) {
      setPlayerConnection(roomCode, rawToken, false);
    }
  });
}

function serveStatic(urlPath, response) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const decoded = decodeURIComponent(requested);
  const filePath = path.resolve(PUBLIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return json(response, 403, { error: '禁止存取' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return json(response, 404, { error: '找不到頁面' });
  response.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const roomMatch = url.pathname.match(/^\/api\/rooms\/(\d{4})(?:\/(join|view|action|events))?$/);
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' });
    if (request.method === 'POST' && url.pathname === '/api/rooms') return await handleCreateRoom(response);
    if (roomMatch) {
      const [, roomCode, operation] = roomMatch;
      if (request.method === 'POST' && operation === 'join') return await handleJoin(roomCode, request, response);
      if (request.method === 'GET' && operation === 'view') return await handleView(roomCode, url.searchParams.get('token'), response);
      if (request.method === 'POST' && operation === 'action') return await handleAction(roomCode, request, response);
      if (request.method === 'GET' && operation === 'events') return await handleStream(roomCode, url.searchParams.get('token'), request, response);
    }
    if (request.method === 'GET') return serveStatic(url.pathname, response);
    return json(response, 404, { error: '找不到 API' });
  } catch (error) {
    const status = error.message === '找不到房間' ? 404 : error.message === '驗證失敗' ? 401 : 400;
    return json(response, status, { error: error.message || '伺服器錯誤' });
  }
});

async function schedulerTick() {
  for (const snapshot of store.listRooms()) {
    if (snapshot.status !== 'PLAYING' || snapshot.phaseEndsAt === null || snapshot.phaseEndsAt > Date.now()) continue;
    try {
      await store.updateRoom(snapshot.roomCode, (room) => {
        if (room.status === 'PLAYING' && room.phaseEndsAt !== null && room.phaseEndsAt <= Date.now()) {
          advancePhase(room);
        }
      });
      await broadcast(snapshot.roomCode);
    } catch (error) {
      console.error(`[scheduler:${snapshot.roomCode}]`, error);
    }
  }
}

async function main() {
  await store.resetConnections();
  setInterval(schedulerTick, 500).unref();
  setInterval(() => {
    for (const clients of streams.values()) {
      for (const client of clients) client.response.write(': heartbeat\n\n');
    }
  }, 15_000).unref();
  server.listen(PORT, HOST, () => {
    console.log(`《今晚誰搞事？》已啟動：http://localhost:${PORT}`);
  });
}

if (require.main === module) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { server, sanitizeRoom, findViewer, hash };
