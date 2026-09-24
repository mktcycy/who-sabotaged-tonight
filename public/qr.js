'use strict';

window.QR = (() => {
  const VERSION = 5;
  const SIZE = 17 + VERSION * 4;
  const DATA_CODEWORDS = 108;
  const ECC_CODEWORDS = 26;

  const exp = new Array(512).fill(0);
  const log = new Array(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index += 1) exp[index] = exp[index - 255];

  function multiply(left, right) {
    return left === 0 || right === 0 ? 0 : exp[log[left] + log[right]];
  }

  function polynomialMultiply(left, right) {
    const result = new Array(left.length + right.length - 1).fill(0);
    for (let i = 0; i < left.length; i += 1) {
      for (let j = 0; j < right.length; j += 1) result[i + j] ^= multiply(left[i], right[j]);
    }
    return result;
  }

  function reedSolomon(data) {
    let generator = [1];
    for (let index = 0; index < ECC_CODEWORDS; index += 1) generator = polynomialMultiply(generator, [1, exp[index]]);
    const remainder = new Array(ECC_CODEWORDS).fill(0);
    for (const byte of data) {
      const factor = byte ^ remainder[0];
      remainder.shift();
      remainder.push(0);
      for (let index = 0; index < ECC_CODEWORDS; index += 1) remainder[index] ^= multiply(generator[index + 1], factor);
    }
    return remainder;
  }

  function appendBits(target, number, length) {
    for (let bit = length - 1; bit >= 0; bit -= 1) target.push(((number >>> bit) & 1) !== 0);
  }

  function encodeBytes(text) {
    const bytes = [...new TextEncoder().encode(text)];
    if (bytes.length > 106) throw new Error('QR Code 內容過長');
    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, 8);
    bytes.forEach((byte) => appendBits(bits, byte, 8));
    const capacity = DATA_CODEWORDS * 8;
    for (let index = 0; index < Math.min(4, capacity - bits.length); index += 1) bits.push(false);
    while (bits.length % 8 !== 0) bits.push(false);
    const data = [];
    for (let index = 0; index < bits.length; index += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | Number(bits[index + bit]);
      data.push(byte);
    }
    for (let pad = 0; data.length < DATA_CODEWORDS; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
    return [...data, ...reedSolomon(data)];
  }

  function makeMatrix(text) {
    const modules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
    const functions = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
    const setFunction = (x, y, dark) => {
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
        modules[y][x] = dark;
        functions[y][x] = true;
      }
    };
    const finder = (centerX, centerY) => {
      for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    };
    finder(3, 3);
    finder(SIZE - 4, 3);
    finder(3, SIZE - 4);
    for (let index = 8; index < SIZE - 8; index += 1) {
      setFunction(6, index, index % 2 === 0);
      setFunction(index, 6, index % 2 === 0);
    }
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, false);
    setFunction(8, 7, false); setFunction(8, 8, false); setFunction(7, 8, false);
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, false);
    for (let index = 0; index < 8; index += 1) setFunction(SIZE - 1 - index, 8, false);
    for (let index = 8; index < 15; index += 1) setFunction(8, SIZE - 15 + index, false);
    setFunction(8, SIZE - 8, true);

    const codewords = encodeBytes(text);
    const dataBits = [];
    codewords.forEach((byte) => appendBits(dataBits, byte, 8));
    let bitIndex = 0;
    let upward = true;
    for (let right = SIZE - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let vertical = 0; vertical < SIZE; vertical += 1) {
        const y = upward ? SIZE - 1 - vertical : vertical;
        for (let offset = 0; offset < 2; offset += 1) {
          const x = right - offset;
          if (functions[y][x]) continue;
          const raw = bitIndex < dataBits.length ? dataBits[bitIndex] : false;
          modules[y][x] = raw !== ((x + y) % 2 === 0);
          bitIndex += 1;
        }
      }
      upward = !upward;
    }

    const formatBits = 0x77c4;
    const formatBit = (index) => ((formatBits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index += 1) setFunction(8, index, formatBit(index));
    setFunction(8, 7, formatBit(6)); setFunction(8, 8, formatBit(7)); setFunction(7, 8, formatBit(8));
    for (let index = 9; index < 15; index += 1) setFunction(14 - index, 8, formatBit(index));
    for (let index = 0; index < 8; index += 1) setFunction(SIZE - 1 - index, 8, formatBit(index));
    for (let index = 8; index < 15; index += 1) setFunction(8, SIZE - 15 + index, formatBit(index));
    setFunction(8, SIZE - 8, true);
    return modules;
  }

  function render(element, text) {
    const matrix = makeMatrix(text);
    const quiet = 4;
    const dimension = SIZE + quiet * 2;
    const path = [];
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      if (matrix[y][x]) path.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
    element.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" role="img" aria-label="加入房間 QR Code"><rect width="100%" height="100%" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`;
  }

  return { makeMatrix, render };
})();
