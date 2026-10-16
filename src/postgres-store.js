'use strict';

// Each mutation uses an optimistic compare-and-swap in Postgres. This protects
// votes and phase changes across concurrent Vercel function instances.
class PostgresStore {
  constructor(url, sql) {
    this.url = url;
    this.sql = sql;
    this.ready = null;
  }

  async query(text, params = []) {
    if (!this.sql) {
      const { neon } = require('@neondatabase/serverless');
      this.sql = neon(this.url);
    }
    return this.sql.query(text, params);
  }

  async init() {
    if (!this.ready) {
      this.ready = this.query(`CREATE TABLE IF NOT EXISTS game_rooms (
        code text PRIMARY KEY,
        data jsonb NOT NULL,
        revision integer NOT NULL DEFAULT 0
      )`).catch((error) => { this.ready = null; throw error; });
    }
    await this.ready;
  }

  async getRoom(code) {
    await this.init();
    const rows = await this.query('SELECT data FROM game_rooms WHERE code = $1', [code]);
    return rows[0]?.data || null;
  }

  async listRooms() {
    await this.init();
    const rows = await this.query('SELECT data FROM game_rooms');
    return rows.map((row) => row.data);
  }

  async createRoom(room) {
    await this.init();
    const rows = await this.query(
      'INSERT INTO game_rooms (code, data) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING RETURNING code',
      [room.roomCode, JSON.stringify(room)]);
    if (!rows.length) throw new Error('房號已存在');
    return room;
  }

  async updateRoom(code, mutator) {
    await this.init();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const rows = await this.query('SELECT data, revision FROM game_rooms WHERE code = $1', [code]);
      if (!rows.length) throw new Error('找不到房間');
      const room = rows[0].data;
      const before = JSON.stringify(room);
      const result = await mutator(room);
      if (JSON.stringify(room) === before) return result === undefined ? room : result;
      room.updatedAt = Date.now();
      const written = await this.query(
        'UPDATE game_rooms SET data = $2::jsonb, revision = revision + 1 WHERE code = $1 AND revision = $3 RETURNING code',
        [code, JSON.stringify(room), rows[0].revision]);
      if (written.length) return result === undefined ? room : result;
      await new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 100)));
    }
    throw new Error('房間忙碌，請重試');
  }

  async deleteRoom(code, validator) {
    await this.init();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const rows = await this.query('SELECT data, revision FROM game_rooms WHERE code = $1', [code]);
      if (!rows.length) throw new Error('找不到房間');
      const room = rows[0].data;
      if (validator) await validator(room);
      const deleted = await this.query('DELETE FROM game_rooms WHERE code = $1 AND revision = $2 RETURNING code', [code, rows[0].revision]);
      if (deleted.length) return room;
    }
    throw new Error('房間忙碌，請重試');
  }
}
module.exports = { PostgresStore };
