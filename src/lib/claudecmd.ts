import { invoke } from "@tauri-apps/api/core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Slash command typed into claude's empty input by the atelier mod, then Enter: exactly as if the user typed it.
 *  For commands that open a dialog or take free text (/mcp, /resume <id>, /rename <name>). Rejects only when the app
 *  cannot reach the session; a non-empty input makes the mod show a hint in claude and nothing happens. */
export async function typeCommand(id: string, command: string, args = ""): Promise<void> {
  const at = await invoke<number>("claude_command", { id, command, args });
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const p = await invoke<{ filled?: number } | null>("claude_panel", { id }).catch(() => null);
    if (p?.filled === at) return void (await invoke("pty_write", { id, data: "\r" }));
  }
}
