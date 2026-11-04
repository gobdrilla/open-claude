// Commit message hints: conventional prefixes from the history, ticket key from the branch, Claude's suggestion.

const TYPE = /^([a-z]+)(?:\([^)]*\))?!?: /;

/** Ticket key in the branch name: feature/abc-123-foo gives ABC-123. */
export function ticketFromBranch(branch: string | null): string | null {
  const m = branch?.match(/(?:^|[/_-])([A-Za-z]{2,}[A-Za-z0-9]*-\d+)/);
  return m ? m[1].toUpperCase() : null;
}

/** Up to 4 most used commit types (each at least twice), only if at least 30 % of subjects follow the convention. */
export function prefixes(subjects: string[]): string[] {
  const counts = new Map<string, number>();
  for (const s of subjects) {
    const t = s.match(TYPE)?.[1];
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let total = 0;
  for (const n of counts.values()) total += n;
  if (!subjects.length || total / subjects.length < 0.3) return [];
  return [...counts]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);
}

/** Replaces a leading `type(scope)!: ` or puts `p` in front. */
export function withPrefix(msg: string, p: string): string {
  return p + msg.replace(TYPE, "");
}

/** Puts `KEY ` at the start of line 1 (after a type prefix) unless the key is already there. */
export function withTicket(msg: string, key: string): string {
  if (msg.split("\n")[0].toUpperCase().includes(key)) return msg;
  const t = msg.match(TYPE)?.[0] ?? "";
  return t + key + " " + msg.slice(t.length);
}

/** Claude's raw answer as a message: "" for no suggestion, comment lines dropped as git would. */
export function cleanSuggestion(raw: string): string {
  const s = raw
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
  return s === "<NONE>" ? "" : s;
}
