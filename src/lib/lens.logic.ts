// Inline diagnostics (error lens): which message a line shows.

export type Severity = "hint" | "info" | "warning" | "error";
const rank: Record<Severity, number> = { hint: 0, info: 1, warning: 2, error: 3 };

/** The more severe of two diagnostics; on a tie the one already kept stays. */
export const worse = <T extends { severity: Severity }>(kept: T | undefined, d: T): T =>
  kept && rank[kept.severity] >= rank[d.severity] ? kept : d;

/** First non-empty line of a message: the lens is single-line. */
export const headline = (msg: string): string => msg.split("\n").find((l) => l.trim())?.trim() ?? "";
