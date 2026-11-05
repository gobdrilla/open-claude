// Pure helpers for LSP navigation (components/editor/nav.ts) and Code Vision (components/editor/codeLens.svelte.ts).
import { t } from "./i18n.ts";

export type LspPos = { line: number; character: number };
export type LspRange = { start: LspPos; end: LspPos };
export type Loc = { uri: string; range: LspRange };
type LocLink = { targetUri: string; targetRange: LspRange; targetSelectionRange?: LspRange };

/** Location, Location[] or LocationLink[] (definition, implementation, typeDefinition, references) as Locations. */
export function toLocs(r: Loc | (Loc | LocLink)[] | null | undefined): Loc[] {
  if (!r) return [];
  return (Array.isArray(r) ? r : [r]).map((x) => ("targetUri" in x ? { uri: x.targetUri, range: x.targetSelectionRange ?? x.targetRange } : x));
}

/** Same place twice (servers list a declaration via several paths): once, sorted by file and position. */
export function uniqueLocs(locs: Loc[]): Loc[] {
  const seen = new Set<string>();
  const key = (l: Loc) => `${l.uri}\n${l.range.start.line}:${l.range.start.character}`;
  return locs
    .filter((l) => !seen.has(key(l)) && seen.add(key(l)))
    .sort((a, b) => a.uri.localeCompare(b.uri) || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character);
}

export type LensKind = "refs" | "impls";
export type Lens = { line: number; character: number; kind: LensKind; count: number };

/**
 * Title of a resolved code lens as (kind, count). Known: csharp-ls "5 Reference(s)", typescript/svelte "1 reference" and
 * "3 implementations", rust-analyzer the same. Other lenses (Run, Debug, test runners) are not shown: null.
 */
export function lensOf(title: string): { kind: LensKind; count: number } | null {
  const m = /^\s*(\d+|no)\s+(reference|usage|implementation)/i.exec(title);
  if (!m) return null;
  const count = /^no$/i.test(m[1]) ? 0 : Number(m[1]);
  return { kind: /^impl/i.test(m[2]) ? "impls" : "refs", count };
}

export const lensLabel = (l: { kind: LensKind; count: number }) =>
  l.kind === "refs"
    ? l.count === 0
      ? t("keine Verwendungen")
      : l.count === 1 ? t("1 Verwendung") : t("{n} Verwendungen", { n: l.count })
    : l.count === 1 ? t("1 Implementierung") : t("{n} Implementierungen", { n: l.count });

/** Lenses of one line, usages first. An implementation count of 0 says nothing (sealed class, plain method): left out. */
export function lineLenses(all: Lens[]): Map<number, Lens[]> {
  const out = new Map<number, Lens[]>();
  for (const l of all) {
    if (l.kind === "impls" && l.count === 0) continue;
    const list = out.get(l.line) ?? [];
    if (!list.some((x) => x.kind === l.kind)) list.push(l);
    out.set(l.line, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "refs" ? -1 : 1));
  return out;
}

export type SymNode = { name: string; kind: number; range: LspRange; selectionRange: LspRange; children?: SymNode[] };
type FlatSym = { name: string; kind: number; location: { range: LspRange } };
/** A breadcrumb: the symbol around the cursor and the ones beside it (for the pick list). */
export type Crumb = { sym: SymNode; siblings: SymNode[] };

const FILE_KIND = 1;
const before = (a: LspPos, b: LspPos) => a.line < b.line || (a.line === b.line && a.character <= b.character);
const contains = (r: LspRange, p: LspPos) => before(r.start, p) && before(p, r.end);
const size = (r: LspRange) => (r.end.line - r.start.line) * 1e6 + r.end.character - r.start.character;

/** documentSymbol answer as a tree: flat SymbolInformation (old servers) becomes one level. */
export function symbolTree(list: (SymNode | FlatSym)[] | null | undefined): SymNode[] {
  return (list ?? []).map((s) => ("location" in s ? { name: s.name, kind: s.kind, range: s.location.range, selectionRange: s.location.range } : s));
}

/**
 * Symbols around the position, outermost first. A file symbol (csharp-ls wraps everything in one) is skipped. Several
 * containing symbols on one level (flat answers: class and method side by side) go in from the largest.
 */
export function crumbsAt(tree: SymNode[], pos: LspPos): Crumb[] {
  const out: Crumb[] = [];
  let level = tree;
  for (;;) {
    const hit = level.filter((s) => contains(s.range, pos)).sort((a, b) => size(b.range) - size(a.range));
    if (!hit.length) return out;
    for (const s of hit) if (s.kind !== FILE_KIND) out.push({ sym: s, siblings: level.filter((x) => x.kind !== FILE_KIND) });
    level = hit.at(-1)!.children ?? [];
  }
}

export type SemKind = "type" | "fn" | "prop" | "const" | "meta";
/** Semantic token types that get a color; the rest (keywords, strings, variables, parameters) keep the grammar's. */
const SEM: Record<string, SemKind> = {
  namespace: "type",
  type: "type",
  class: "type",
  enum: "type",
  interface: "type",
  struct: "type",
  typeParameter: "type",
  function: "fn",
  method: "fn",
  property: "prop",
  field: "prop",
  event: "prop",
  enumMember: "const",
  constant: "const",
  macro: "meta",
  decorator: "meta",
};

/** semanticTokens data (5 numbers per token, line and start relative to the previous token) as absolute spans. */
export function semanticSpans(data: number[], types: string[]): { line: number; character: number; length: number; kind: SemKind }[] {
  const out = [];
  let line = 0;
  let character = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    if (data[i]) character = 0;
    line += data[i];
    character += data[i + 1];
    const kind = SEM[types[data[i + 3]]];
    if (kind) out.push({ line, character, length: data[i + 2], kind });
  }
  return out;
}
