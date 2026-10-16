'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresStore } = require('../src/postgres-store');
const { refreshCloudRoom } = require('../server');
const { startGame } = require('../src/game-engine');

function database() {
  const rows = new Map();
  let conflicts = 0;
  return {
    get conflicts() { return conflicts; },
    async query(text, args = []) {
      await new Promise((resolve) => setImmediate(resolve));
      if (text.startsWith('CREATE')) return [];
      const row = rows.get(args[0]);
      if (text.startsWith('INSERT')) {
        if (row) return [];
        rows.set(args[0], { data: JSON.parse(args[1]), revision: 0 });
        return [{ code: args[0] }];
      }
      if (text.startsWith('SELECT')) return row ? [structuredClone(row)] : [];
      if (text.startsWith('UPDATE')) {
        if (!row || row.revision !== args[2]) { conflicts++; return []; }
        rows.set(args[0], { data: JSON.parse(args[1]), revision: row.revision + 1 });
        return [{ code: args[0] }];
      }
      if (text.startsWith('DELETE')) {
        if (!row || row.revision !== args[1]) return [];
        rows.delete(args[0]);
        return [{ code: args[0] }];
      }
      throw Error('Unexpected query');
    },
  };
}

test('independent function instances preserve all ten concurrent votes', async () => {
  const db = database();
  const stores = Array.from({ length: 10 }, () => new PostgresStore('test', db));
  await stores[0].createRoom({ roomCode: '1234', votes: {} });
  await Promise.all(stores.map((store, index) => store.updateRoom('1234', (room) => {
    room.votes[index] = 'ABC'[index % 3];
  })));
  const room = await new PostgresStore('test', db).getRoom('1234');
  assert.equal(Object.keys(room.votes).length, 10);
  assert.ok(db.conflicts > 0);
  await assert.rejects(stores[0].updateRoom('1234', (room) => {
    room.votes = {};
    throw Error('invalid action');
  }));
  assert.equal(Object.keys((await stores[0].getRoom('1234')).votes).length, 10);
});

test('failed host validation cannot delete a room', async () => {
  const store = new PostgresStore('test', database());
  await store.createRoom({ roomCode: '1234', secret: 1 });
  await assert.rejects(store.deleteRoom('1234', () => { throw Error('not host'); }));
  assert.ok(await store.getRoom('1234'));
  await store.deleteRoom('1234', () => {});
  assert.equal(await store.getRoom('1234'), null);
});

test('cloud polling catches up expired stages and preserves untimed discussion', () => {
  const room = {
    roomCode: '1234', phaseVersion: 1, gameNumber: 1, status: 'LOBBY',
    players: Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: 'P' + i, lastSeenAt: 0 })),
  };
  startGame(room, 1000);
  refreshCloudRoom(room, { player: room.players[0] }, 1000000);
  assert.equal(room.phase, 'DISCUSSION');
  assert.equal(room.phaseEndsAt, null);
  assert.equal(room.players[0].connected, true);
  assert.equal(room.players[1].connected, false);
  const version = room.phaseVersion;
  refreshCloudRoom(room, { type: 'HOST' }, 2000000);
  assert.equal(room.phaseVersion, version);
});
