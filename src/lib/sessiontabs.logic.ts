// Session tabs as Chrome-style groups: one group per project (or repo group), pure so `node --test` loads it directly.
import type { TabState } from "./claudemode.ts";

type S = { id: string; repo: { path: string }; group?: string; guest?: string };
export type TabGroup<T extends S = S> = { key: string; list: T[] };

/** Which group a session belongs to; guests never group (each is its own host). */
export const groupKey = (s: S): string => (s.group ? `g:${s.group}` : s.guest ? `x:${s.id}` : `r:${s.repo.path}`);

/** Sessions in tab order, grouped by project and contiguous. `order` holds the ids as the user arranged them;
 *  ids not in it (new sessions) go to the end of their group, a new project to the end of the strip. */
export function arrange<T extends S>(sessions: T[], order: string[]): TabGroup<T>[] {
  const rank = (s: T) => {
    const i = order.indexOf(s.id);
    return i < 0 ? order.length + sessions.indexOf(s) : i;
  };
  const groups = new Map<string, T[]>();
  for (const s of [...sessions].sort((a, b) => rank(a) - rank(b))) {
    const k = groupKey(s);
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups].map(([key, list]) => ({ key, list }));
}

const ids = (groups: TabGroup[]) => groups.flatMap((g) => g.list.map((s) => s.id));

/** Whole group (or single tab) `key` to position `to` among the groups; returns the new order. */
export function moveGroup(groups: TabGroup[], key: string, to: number): string[] {
  const g = groups.find((x) => x.key === key);
  if (!g) return ids(groups);
  const rest = groups.filter((x) => x !== g);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, g);
  return ids(rest);
}

/** Tab `id` to position `to` inside its own group; it never leaves the group. Returns the new order. */
export function moveTab(groups: TabGroup[], id: string, to: number): string[] {
  return ids(
    groups.map((g) => {
      const s = g.list.find((x) => x.id === id);
      if (!s) return g;
      const list = g.list.filter((x) => x !== s);
      list.splice(Math.max(0, Math.min(to, list.length)), 0, s);
      return { ...g, list };
    }),
  );
}

const RANK: Record<string, number> = { ask: 3, run: 2, done: 1 };

/** Most urgent state of a group, shown on its chip while it is collapsed: waiting before working before done. */
export const urgent = (states: TabState[]): TabState =>
  states.reduce<TabState>((a, b) => ((RANK[b ?? ""] ?? 0) > (RANK[a ?? ""] ?? 0) ? b : a), undefined);

/** Pointer moved past the middle of a neighbour: the dragged item takes its place (stable for different widths). */
export function swapIndex(mids: number[], i: number, x: number): number {
  if (i < mids.length - 1 && x > mids[i + 1]) return i + 1;
  if (i > 0 && x < mids[i - 1]) return i - 1;
  return i;
}
