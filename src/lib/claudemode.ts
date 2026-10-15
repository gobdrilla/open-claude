/** Berechtigungsmodi von claude in Umschalt+Tab-Reihenfolge; Label wie frueher im Chat. */
export const MODES = [
  ["Manuell", "default"],
  ["Edits annehmen", "acceptEdits"],
  ["Plan", "plan"],
  ["Auto", "auto"],
  ["Nicht fragen", "dontAsk"],
  ["Alles erlauben", "bypassPermissions"],
] as const;

// Fusszeile der TUI, z. B. "⏵⏵ accept edits on (shift+tab to cycle)"; Manuell zeigt keine.
const FOOTER: [RegExp, string][] = [
  [/accept edits on/i, "acceptEdits"],
  [/plan mode on/i, "plan"],
  [/auto mode on/i, "auto"],
  [/don'?t ask (mode )?on/i, "dontAsk"],
  [/bypass permissions on/i, "bypassPermissions"],
];

/** Modus aus den untersten Bildschirmzeilen; ohne Fusszeile, aber mit Eingabezeile (❯) = Manuell, sonst unbekannt (Dialog offen). */
export function modeOf(lines: string[]): string | undefined {
  for (const l of lines) for (const [re, m] of FOOTER) if (re.test(l)) return m;
  return lines.some((l) => l.trimStart().startsWith("❯")) ? "default" : undefined;
}

export type TabState = "run" | "ask" | "done" | undefined;

/** Tab-Status aus dem Session-Panel der Mod; "done" bleibt, bis der Tab angesehen wurde (seen). */
export function tabState(prev: TabState, p: { busy?: boolean; waiting?: boolean } | null, seen: boolean): TabState {
  if (p?.waiting) return "ask";
  if (p?.busy) return "run";
  return !seen && (prev === "run" || prev === "done") ? "done" : undefined;
}

/** Banner im Tab-Kopf und Text der OS-Benachrichtigung, z. B. "atelier: Bash »npm i« wartet". */
export function bannerText(projekt: string, w: { tool: string; summary: string } | null | undefined): string {
  return `${projekt}: ${w?.tool ?? "Claude"}${w?.summary ? ` »${w.summary}«` : ""} wartet`;
}
