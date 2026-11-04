// Most recently used open files (Ctrl+Tab), pure so `node --test` loads it directly.
import { moved } from "./editor.logic.ts";

/** `path` to the front. */
export const touch = (list: string[], path: string): string[] => [path, ...list.filter((p) => p !== path)];

/** After a rename of `from` (file or folder) to `to`; a file renamed onto an open one appears once. */
export const follow = (list: string[], from: string, to: string): string[] => [
  ...new Set(list.map((p) => moved(p, from, to) ?? p)),
];

/** Next index in the switcher, wrapping; back = Shift held. The first press from 0 lands on the previous file (1) or the oldest. */
export const step = (i: number, n: number, back: boolean): number => (i + (back ? n - 1 : 1)) % n;
