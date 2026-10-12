// Reine Logik fuer die Language-Server-Anbindung (lsp.svelte.ts): Server je Endung, file-URIs <-> Repo-Pfade.
import { abs, rel } from "./editor.logic.ts";

/** Endung -> [Server-Schluessel, LSP-languageId]. Schluessel muessen zu SERVERS in src-tauri/src/lsp.rs passen. */
const BY_EXT: Record<string, [string, string]> = {
  ts: ["typescript", "typescript"],
  mts: ["typescript", "typescript"],
  cts: ["typescript", "typescript"],
  tsx: ["typescript", "typescriptreact"],
  js: ["typescript", "javascript"],
  mjs: ["typescript", "javascript"],
  cjs: ["typescript", "javascript"],
  jsx: ["typescript", "javascriptreact"],
  svelte: ["svelte", "svelte"],
  rs: ["rust", "rust"],
  py: ["python", "python"],
  pyi: ["python", "python"],
  go: ["go", "go"],
  c: ["clangd", "c"],
  h: ["clangd", "c"],
  cc: ["clangd", "cpp"],
  cpp: ["clangd", "cpp"],
  cxx: ["clangd", "cpp"],
  hpp: ["clangd", "cpp"],
  hxx: ["clangd", "cpp"],
  cs: ["csharp", "csharp"],
  swift: ["swift", "swift"],
  json: ["json", "json"],
  jsonc: ["json", "jsonc"],
  css: ["css", "css"],
  scss: ["css", "scss"],
  less: ["css", "less"],
  html: ["html", "html"],
  htm: ["html", "html"],
  yaml: ["yaml", "yaml"],
  yml: ["yaml", "yaml"],
};

export function serverFor(path: string): { server: string; languageId: string } | null {
  const dot = path.lastIndexOf(".");
  const hit = dot > path.lastIndexOf("/") ? BY_EXT[path.slice(dot + 1).toLowerCase()] : undefined;
  return hit ? { server: hit[0], languageId: hit[1] } : null;
}

/** Repo-relativer Pfad ("" = Projektordner) -> file-URI, Segmente prozentkodiert, Laufwerk unkodiert. */
export function fileUri(repo: string, path: string): string {
  const p = (path ? abs(repo, path) : repo.replace(/[\\/]$/, "")).replace(/\\/g, "/");
  const enc = p
    .split("/")
    .map((seg, i) => (i <= 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join("/");
  return enc.startsWith("/") ? "file://" + enc : "file:///" + enc;
}

/** file-URI -> Repo-relativer Pfad mit "/"; null, wenn ausserhalb des Projekts oder keine file-URI. */
export function uriPath(repo: string, uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let p: string;
  try {
    p = decodeURIComponent(uri.slice("file://".length).replace(/^localhost\//, "/"));
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  const r = rel(repo, p);
  return r === p || r === "" || r.startsWith("../") ? null : r;
}

export type LspPos = { line: number; character: number };
export type TextEdit = { range: { start: LspPos; end: LspPos }; newText: string };

/** LSP-Position -> Offset in text (LF, UTF-16 wie JS-Strings); ausserhalb wird auf Zeilen-/Textende begrenzt. */
export function offsetAt(text: string, p: LspPos): number {
  let at = 0;
  for (let l = 0; l < p.line; l++) {
    const nl = text.indexOf("\n", at);
    if (nl < 0) return text.length;
    at = nl + 1;
  }
  const end = text.indexOf("\n", at);
  return Math.min(at + p.character, end < 0 ? text.length : end);
}

/** Edits eines Servers anwenden (alle beziehen sich auf den Ausgangstext), hinten zuerst. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  const spans = edits
    .map((e) => ({ from: offsetAt(text, e.range.start), to: offsetAt(text, e.range.end), insert: e.newText }))
    .sort((a, b) => b.from - a.from || b.to - a.to);
  for (const s of spans) text = text.slice(0, s.from) + s.insert + text.slice(s.to);
  return text;
}

export type Edit = { uri: string; edits: TextEdit[] };

/** WorkspaceEdit einer Rename-Antwort je Datei; Datei-Operationen (anlegen/umbenennen/loeschen) werfen. */
export function editsOf(r: { changes?: Record<string, TextEdit[]>; documentChanges?: unknown[] } | null): Edit[] {
  if (!r) return [];
  if (r.documentChanges) {
    return r.documentChanges.map((c) => {
      const d = c as { kind?: string; textDocument?: { uri: string }; edits?: TextEdit[] };
      if (d.kind || !d.textDocument || !d.edits) throw new Error("Umbenennen mit Dateioperationen nicht unterstützt");
      return { uri: d.textDocument.uri, edits: d.edits };
    });
  }
  return Object.entries(r.changes ?? {}).map(([uri, edits]) => ({ uri, edits }));
}

type Diag = { range: { start: LspPos }; severity?: number };

/** Befunde eines Projekts aus lsp.diags (Schluessel repo+"\n"+path) als Liste: Fehler zuerst, dann Pfad, dann Zeile. */
export function problems<D extends Diag>(diags: Record<string, { list: D[] }>, repo: string): { path: string; d: D }[] {
  const pre = `${repo}\n`;
  return Object.entries(diags)
    .filter(([key]) => key.startsWith(pre))
    .flatMap(([key, e]) => e.list.map((d) => ({ path: key.slice(pre.length), d })))
    .sort(
      (a, b) =>
        (a.d.severity ?? 1) - (b.d.severity ?? 1) ||
        a.path.localeCompare(b.path) ||
        a.d.range.start.line - b.d.range.start.line,
    );
}

type Range = { start: LspPos; end: LspPos };
type DocSym = { name: string; kind: number; selectionRange: Range; children?: DocSym[] };
type SymInfo = { name: string; kind: number; containerName?: string; location: { uri: string; range?: Range } };
export type Sym = { name: string; kind: number; container: string; uri?: string; at: LspPos };

/** documentSymbol/workspace/symbol-Antwort flach: verschachtelte DocumentSymbols mit Eltern als Container. */
export function flatSymbols(list: (DocSym | SymInfo)[] | null, container = ""): Sym[] {
  return (list ?? []).flatMap((s): Sym[] => {
    if ("location" in s) {
      const at = s.location.range?.start ?? { line: 0, character: 0 };
      return [{ name: s.name, kind: s.kind, container: s.containerName ?? "", uri: s.location.uri, at }];
    }
    const inner = container ? `${container}.${s.name}` : s.name;
    return [{ name: s.name, kind: s.kind, container, at: s.selectionRange.start }, ...flatSymbols(s.children ?? [], inner)];
  });
}
