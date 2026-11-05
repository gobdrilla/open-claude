// Pure parts of the debugger (debug.svelte.ts), without runes so node --test loads them.

export type Frame = { id: number; name: string; path: string | null; line: number };

const slash = (p: string) => p.replaceAll("\\", "/");

/** Path from the debugger, repo-relative when inside the project, else as given (with forward slashes). */
export function toRel(repo: string, p: string): string {
  const root = slash(repo).replace(/\/+$/, "") + "/";
  const s = slash(p);
  // Case-insensitive: Windows and the default macOS volume; the PDB keeps the casing the build saw.
  return s.toLowerCase().startsWith(root.toLowerCase()) ? s.slice(root.length) : s;
}

/** Absolute path for the debugger, with the separator the repo path uses. */
export function toAbs(repo: string, rel: string): string {
  const win = repo.includes("\\");
  const r = repo.replace(/[\\/]+$/, "");
  return win ? `${r}\\${rel.replaceAll("/", "\\")}` : `${r}/${rel}`;
}

/** Frame to show after a stop: the topmost one in the project's own code, else the topmost with source. */
export function pickFrame(frames: Frame[]): Frame | undefined {
  const inside = (f: Frame) => f.path !== null && !/^([a-z]:)?\//i.test(f.path);
  return frames.find(inside) ?? frames.find((f) => f.path !== null) ?? frames[0];
}

/** Keep the last max characters of the console, cut at a line start. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const nl = cut.indexOf("\n");
  return nl < 0 ? cut : cut.slice(nl + 1);
}

/** C# compiler names of local functions and lambdas, readable: "Program.<<Main>$>g__Report|0_0(…)" -> "Program.Report(…)". */
export const frameName = (name: string) => name.replace(/<+[^|()]*>g__(\w+)\|\d+_\d+/g, "$1");
