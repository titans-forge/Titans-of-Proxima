export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 0.001) return String(Math.round(r));
  return r.toFixed(1);
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function fmtSigned(n: number): string {
  const v = Math.round(n * 10) / 10;
  if (Math.abs(v) < 0.05) return "0";
  return `${v > 0 ? "+" : ""}${fmt(v)}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
