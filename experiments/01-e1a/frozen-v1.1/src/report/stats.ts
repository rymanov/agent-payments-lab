/**
 * Small-sample statistics for lab results (method rule 3): every rate carries a 95% interval.
 * Wilson score interval for one proportion; Newcombe's method 10 for a difference of two.
 */

const Z = 1.959963984540054; // two-sided 95%

export interface Interval {
  k: number;
  n: number;
  rate: number;
  lo: number;
  hi: number;
}

export function wilson(k: number, n: number, z = Z): Interval {
  if (n === 0) return { k, n, rate: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const z2 = z * z;
  const den = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { k, n, rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export interface DiffInterval {
  diff: number;
  lo: number;
  hi: number;
  /** "up" or "down" when the interval excludes zero; otherwise "unclear". */
  verdict: "up" | "down" | "unclear";
}

/** Difference a - b of two independent proportions (Newcombe 1998, method 10). */
export function newcombe(ka: number, na: number, kb: number, nb: number): DiffInterval {
  const a = wilson(ka, na);
  const b = wilson(kb, nb);
  const d = a.rate - b.rate;
  const lo = d - Math.sqrt((a.rate - a.lo) ** 2 + (b.hi - b.rate) ** 2);
  const hi = d + Math.sqrt((a.hi - a.rate) ** 2 + (b.rate - b.lo) ** 2);
  return { diff: d, lo, hi, verdict: lo > 0 ? "up" : hi < 0 ? "down" : "unclear" };
}

export const pct = (x: number) => (Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
export const fmt = (i: Interval) => `${i.k} of ${i.n} (${pct(i.rate)}; 95% CI ${pct(i.lo)} to ${pct(i.hi)})`;
