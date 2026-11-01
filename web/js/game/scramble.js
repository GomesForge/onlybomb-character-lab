// The players' files come scrambled from the server (bmoserver/filepass.py scramble): XORed with MT19937 words,
// little-endian, the generator seeded (init_by_array) with 4 FNV-1a words of the page's pass and the answer's nonce.
// XOR again with the same words gives them back. Python's random.Random is the same MT19937 (filepass.MT_OK).

// init_by_array's 4 words (filepass.seed_words)
export function seedWords(pass, nonce) {
  const words = [];
  for (let k = 0; k < 4; k++) {
    let h = (2166136261 ^ Math.imul(k, 0x9e3779b9)) >>> 0;
    for (const bytes of [pass, nonce]) for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
    words.push(h);
  }
  words[3] = (words[3] | 0x80000000) >>> 0;
  return words;
}

// MT19937 seeded by init_by_array(key): its next 32-bit word each call (mt19937ar.c)
export function mersenne(key) {
  const N = 624, mt = new Uint32Array(N);
  mt[0] = 19650218;
  for (let i = 1; i < N; i++) mt[i] = (Math.imul(1812433253, mt[i - 1] ^ (mt[i - 1] >>> 30)) + i) >>> 0;
  let i = 1, j = 0;
  for (let k = Math.max(N, key.length); k; k--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j) >>> 0;
    i++; j++;
    if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    if (j >= key.length) j = 0;
  }
  for (let k = N - 1; k; k--) {
    mt[i] = ((mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i) >>> 0;
    i++;
    if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
  }
  mt[0] = 0x80000000;
  let at = N;
  return () => {
    if (at >= N) {
      for (let k = 0; k < N; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % N] & 0x7fffffff);
        mt[k] = mt[(k + 397) % N] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      at = 0;
    }
    let y = mt[at++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };
}

// The file as it was (in place): data (Uint8Array) as the server sent it, the page's pass and the answer's nonce
// (X-Scrambled, hex)
export function unscramble(data, pass, nonceHex) {
  const nonce = Uint8Array.from(nonceHex.match(/../g) || [], (h) => parseInt(h, 16));
  const next = mersenne(seedWords(pass, nonce));
  for (let i = 0; i < data.length; i += 4) {
    const w = next();
    for (let b = 0; b < 4 && i + b < data.length; b++) data[i + b] ^= (w >>> (8 * b)) & 0xff;
  }
  return data;
}
