// Bracket pair colorization as in VS Code: (), [], {} colored by nesting depth, unmatched ones red.
import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { Prec, RangeSetBuilder, type EditorState } from "@codemirror/state";
import { matchBrackets, syntaxTree } from "@codemirror/language";
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

/** Bracket classes from..to in document order: cm-bracket-<depth % 3>, cm-bracket-bad for unmatched ones. */
export function bracketClasses(state: EditorState, from: number, to: number): [pos: number, cls: string][] {
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
