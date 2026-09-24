'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadQr() {
  const context = { window: {}, TextEncoder };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'qr.js'), 'utf8'), context);
  return context.window.QR;
}

test('QR encoder 產生 Version 5 的 37×37 矩陣與三個定位圖形', () => {
  const matrix = loadQr().makeMatrix('http://192.168.1.20:3000/play.html?room=1234');
  assert.equal(matrix.length, 37);
  assert.ok(matrix.every((row) => row.length === 37));
  for (const [x, y] of [[3, 3], [33, 3], [3, 33]]) {
    assert.equal(matrix[y][x], true);
    assert.equal(matrix[y - 2][x], false);
    assert.equal(matrix[y - 3][x], true);
  }
});

test('QR encoder 拒絕超過固定版本容量的內容', () => {
  const qr = loadQr();
  assert.throws(() => qr.makeMatrix('x'.repeat(107)), /內容過長/);
});
