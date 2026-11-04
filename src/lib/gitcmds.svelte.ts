// Custom commands for the Git view, global, kept in localStorage like the Git confirmations (ask.svelte.ts).
import type { GitCmd } from "./gitcmds.logic.ts";
export { usesFile, type GitCmd } from "./gitcmds.logic.ts";

const KEY = "git.commands";
function read(): GitCmd[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const gitCmds = $state<GitCmd[]>(read());
export function setGitCmds(list: GitCmd[]) {
  gitCmds.splice(0, gitCmds.length, ...list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Without localStorage the list only lasts for this session.
  }
}
