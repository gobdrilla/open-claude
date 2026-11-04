// Overview ruler (scrollbar markers): pixel layout of the marks.

/** Marks as [top, bottom] in pixels merged where they touch or overlap, so long runs stay one element. */
export function runs(marks: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...marks].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Index of the target closest to y if within tol pixels, else -1. */
export function nearest(ys: number[], y: number, tol: number): number {
  let best = -1;
  for (let i = 0; i < ys.length; i++) if (Math.abs(ys[i] - y) <= tol && (best < 0 || Math.abs(ys[i] - y) < Math.abs(ys[best] - y))) best = i;
  return best;
}
