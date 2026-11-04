// Custom commands in the Git view (Settings › Git). Pure part, testable without Svelte.

export type GitCmd = { name: string; command: string };

/** Needs a file: only offered in the file context menu, with FILE set. */
export const usesFile = (c: GitCmd) => /\$(FILE|\{FILE\})(?![A-Za-z0-9_])/.test(c.command);
