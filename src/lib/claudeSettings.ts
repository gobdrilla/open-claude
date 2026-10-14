import { invoke } from "@tauri-apps/api/core";

// ~/.claude/settings.json lesen und einzelne Keys aendern; schreibt nur, wenn die Datei seit dem Lesen gleich blieb.
export type ClaudeCfg = Record<string, any>;

export async function readClaude(): Promise<ClaudeCfg> {
  const v = JSON.parse((await invoke<string>("claude_settings_read")).trim() || "{}");
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** undefined loescht den Key (Standard von Claude Code greift). */
export async function setClaude(key: string, value: unknown): Promise<ClaudeCfg> {
  const expected = await invoke<string>("claude_settings_read");
  const s = JSON.parse(expected.trim() || "{}");
  if (value === undefined) delete s[key];
  else s[key] = value;
  await invoke("claude_settings_write", { text: JSON.stringify(s, null, 2) + "\n", expected });
  return s;
}
