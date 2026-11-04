// Interactive rebase plan: rows in todo order (oldest first), as sent to git_rewrite.

export type RebaseOp = "pick" | "fixup" | "drop";
/** edit: message being edited (null = untouched); orig: the commit's full message once loaded. */
export type RebaseRow = { sha: string; subject: string; op: RebaseOp; edit: string | null; orig: string };
export type RebaseStep = { op: RebaseOp; sha: string; message: string | null };

/** Row i moved by d (-1 up, +1 down); unchanged when it would leave the list. */
export function moveRow<T>(rows: T[], i: number, d: number): T[] {
  const j = i + d;
  if (i < 0 || j < 0 || i >= rows.length || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Why the plan cannot start, or null. */
export function rebaseProblem(rows: RebaseRow[]): string | null {
  if (rows.find((r) => r.op !== "drop")?.op === "fixup") return "Erster Commit kann nicht zusammengefasst werden.";
  if (rows.some((r) => r.op !== "drop" && r.edit !== null && !r.edit.trim())) return "Nachricht ist leer.";
  return null;
}

/** Only changed messages are sent: an unchanged one would still rewrite the commit. */
export const rebaseSteps = (rows: RebaseRow[]): RebaseStep[] =>
  rows.map((r) => ({ op: r.op, sha: r.sha, message: r.op !== "drop" && r.edit !== null && r.edit !== r.orig ? r.edit : null }));
