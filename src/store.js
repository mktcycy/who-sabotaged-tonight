'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tempPath = `${filePath}.tmp`;
    this.queue = Promise.resolve();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) this.write({ rooms: {} });
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new Error(`無法讀取遊戲資料：${error.message}`);
    }
  }

  write(data) {
    fs.writeFileSync(this.tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(this.tempPath, this.filePath);
  }

  getRoom(roomCode) {
    return this.read().rooms[roomCode] || null;
  }

  listRooms() {
    return Object.values(this.read().rooms);
  }

  updateRoom(roomCode, mutator) {
    const task = this.queue.then(async () => {
      const database = this.read();
      const room = database.rooms[roomCode];
      if (!room) throw new Error('找不到房間');
      const result = await mutator(room);
      room.updatedAt = Date.now();
      database.rooms[roomCode] = room;
      this.write(database);
      return result === undefined ? room : result;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  createRoom(room) {
    const task = this.queue.then(() => {
      const database = this.read();
      if (database.rooms[room.roomCode]) throw new Error('房號已存在');
      database.rooms[room.roomCode] = room;
      this.write(database);
      return room;
    });
    this.queue = task.catch(() => {});
    return task;
  }

  resetConnections() {
    const task = this.queue.then(() => {
      const database = this.read();
      for (const room of Object.values(database.rooms)) {
        room.players = room.players.map((player) => ({ ...player, connected: false }));
      }
      this.write(database);
    });
    this.queue = task.catch(() => {});
    return task;
  }
}

module.exports = { JsonStore };
