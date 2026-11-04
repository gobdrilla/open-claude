// Bracket pair colorization as in VS Code: (), [], {} colored by nesting depth, unmatched ones red.
import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Prec, RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { language, matchBrackets, StreamLanguage, syntaxTree } from "@codemirror/language";
import type { SyntaxNode, Tree } from "@lezer/common";
import { pairBrackets, type Bracket } from "../../brackets.logic.ts";

const marks = Object.fromEntries(["cm-bracket-0", "cm-bracket-1", "cm-bracket-2", "cm-bracket-bad"].map((c) => [c, Decoration.mark({ class: c })]));

// Only real bracket tokens of the grammar count, so brackets in strings and comments stay uncolored. Zero-length
// nodes are brackets the parser inserted during error recovery.
const isBracket = (name: string, from: number, to: number) => to - from === 1 && name.length === 1 && "()[]{}".includes(name);

/** Opens still unclosed at pos: they sit as direct children of the nodes around pos, so only those are scanned. */
function opensBefore(tree: Tree, pos: number): Bracket[] {
  const chain: SyntaxNode[] = [];
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) chain.unshift(n);
  const list: Bracket[] = [];
  for (const node of chain) {
    const c = node.cursor();
    if (c.firstChild())
      do {
        if (c.to > pos) break;
        if (isBracket(c.name, c.from, c.to)) list.push({ ch: c.name, from: c.from });
      } while (c.nextSibling());
  }
  const stack: Bracket[] = [];
  pairBrackets(list, stack);
  return stack;
}

/**
 * An open the tree has no close for. The parse stops past the viewport: an open whose node runs into the unparsed rest
 * may still close there.
 */
function unclosed(state: EditorState, tree: Tree, from: number): boolean {
  if (matchBrackets(state, from, 1)?.matched) return false;
  return tree.length >= state.doc.length || tree.resolveInner(from, 1).parent!.to < tree.length;
}

// Legacy stream modes have no bracket tokens and huge files open without a grammar: there the text is scanned.
const textMode = (state: EditorState) => {
  const l = state.facet(language);
  return !l || l instanceof StreamLanguage;
};

const BRACKET = /[()[\]{}]/g;
// Stream modes name their tokens after the style; brackets inside these stay uncolored.
const SKIP = /string|comment|regexp/;

/** Bracket characters from..to, skipping string and comment tokens of a stream mode. */
function scan(state: EditorState, from: number, to: number): Bracket[] {
  const skip: [number, number][] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (!SKIP.test(n.name)) return;
      skip.push([n.from, n.to]);
      return false;
    },
  });
  const list: Bracket[] = [];
  let k = 0;
  for (let it = state.doc.iterRange(from, to), pos = from; !it.next().done; pos += it.value.length)
    for (const m of it.value.matchAll(BRACKET)) {
      const at = pos + m.index;
      while (k < skip.length && skip[k][1] <= at) k++;
      if (k < skip.length && skip[k][0] <= at) continue;
      list.push({ ch: m[0], from: at });
    }
  return list;
}

// Opens still unclosed at every STEP chars, so scrolling and typing rescan only from the nearest point before.
const STEP = 32768;
type Point = { pos: number; stack: Bracket[] };
const points = StateField.define<Point[]>({
  create: () => [],
  update(v, tr) {
    // A stream mode parses on in the background and may retokenize: strings found later change the scan.
    if (syntaxTree(tr.state) !== syntaxTree(tr.startState) || tr.startState.facet(language) !== tr.state.facet(language)) return [];
    if (!tr.docChanged) return v;
    let min = Infinity;
    tr.changes.iterChangedRanges((from) => (min = Math.min(min, from)));
    return v.filter((p) => p.pos <= min);
  },
});

function opensAt(state: EditorState, pos: number): Bracket[] {
  const pts = state.field(points, false) ?? [];
  const start = pts.findLast((p) => p.pos <= pos);
  const stack = [...(start?.stack ?? [])];
  for (let at = start?.pos ?? 0; at < pos; ) {
    const end = Math.min(pos, (Math.floor(at / STEP) + 1) * STEP);
    pairBrackets(scan(state, at, end), stack);
    // The array is a memo of this state's field value: points are only ever appended in order.
    if (end % STEP === 0 && end > (pts.at(-1)?.pos ?? 0)) pts.push({ pos: end, stack: [...stack] });
    at = end;
  }
  return stack;
}

/** Text mode: depth from the scanned text. Nothing turns red: a stray close is often valid there (shell `case x)`). */
function textClasses(state: EditorState, from: number, to: number): [pos: number, cls: string][] {
  const list = scan(state, from, to);
  const depths = pairBrackets(list, opensAt(state, from));
  return list.flatMap((b, i) => (depths[i] < 0 ? [] : [[b.from, `cm-bracket-${depths[i] % 3}`]]));
}

/** Bracket classes from..to in document order: cm-bracket-<depth % 3>, cm-bracket-bad for unmatched ones. */
export function bracketClasses(state: EditorState, from: number, to: number): [pos: number, cls: string][] {
  if (textMode(state)) return textClasses(state, from, to);
  const tree = syntaxTree(state);
  const stack = opensBefore(tree, from);
  const list: Bracket[] = [];
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (n.from >= from && n.from < to && isBracket(n.name, n.from, n.to)) list.push({ ch: n.name, from: n.from });
    },
  });
  const depths = pairBrackets(list, stack);
  // Opens not closed inside the range: the tree knows whether a close follows further down.
  const open = new Set(stack);
  return list.map((b, i) => [b.from, depths[i] < 0 || (open.has(b) && unclosed(state, tree, b.from)) ? "cm-bracket-bad" : `cm-bracket-${depths[i] % 3}`]);
}

function decorate(view: EditorView): DecorationSet {
  const out = new RangeSetBuilder<Decoration>();
  // Per visible range: folded code in between is never walked.
  for (const { from, to } of view.visibleRanges) for (const [pos, cls] of bracketClasses(view.state, from, to)) out.add(pos, pos + 1, marks[cls]);
  return out.finish();
}

export const bracketColors = [
  points,
  // Above the syntax highlighter (Prec.high): higher precedence marks sit inside, so this color wins over the token's.
  Prec.highest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = decorate(u.view);
        }
      },
      { decorations: (p) => p.decorations },
    ),
  ),
  EditorView.theme({
    ".cm-bracket-0": { color: "var(--bracket-1)" },
    ".cm-bracket-1": { color: "var(--bracket-2)" },
    ".cm-bracket-2": { color: "var(--bracket-3)" },
    ".cm-bracket-bad": { color: "var(--destructive)" },
  }),
];
