/** Mulberry32. The state field is the persisted seed word. */
export function nextRand(state: { rng: number }): number {
  let a = state.rng | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  state.rng = a >>> 0 || 1;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function hash01(q: number, r: number, salt: number): number {
  let n = Math.imul(q, 374761393) + Math.imul(r, 668265263) + Math.imul(salt | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function makeRng(seed: number): { rng: number; next: () => number } {
  const box = { rng: seed >>> 0 || 1 };
  return { rng: box.rng, next: () => nextRand(box) };
}
