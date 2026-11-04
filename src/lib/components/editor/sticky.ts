// Sticky scroll as in VS Code (editor.stickyScroll): the header lines of the scopes around the top line stay pinned
// above the text. A scope is a line whose fold range (foldable(), so grammar folds and the indentation fallback) reaches
// the lines under the pinned stack.
import type { EditorState, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { foldNodeProp, foldable, highlightingFor, language, syntaxTree, type Language } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import type { SyntaxNode, Tree } from "@lezer/common";
import { enclosing, indentParents, sections, stack, type Section } from "$lib/sticky.logic";
import { bracketClasses } from "./bracketColors";

const MAX = 5;
// Longer header lines are clipped by the pane anyway; this keeps a minified line from being highlighted whole.
const CHARS = 400;

type Layout = {
  lines: number[];
  push: number;
  lh: number;
  top: number;
  width: number;
  gutter: number;
  num: { left: number; width: number } | null;
  pad: number;
  cover: number;
};

const lead = (s: string) => /^\s*/.exec(s)![0];

/**
 * A grammar fold from line `l` whose end the parse has not reached (it stops past the viewport): it ends below the
 * parsed part, far under the rows. foldable() would fall back to the indentation, which scans the rest of a large
 * JSON or class.
 */
function unparsed(tree: Tree, docLength: number, l: { from: number; to: number }): boolean {
  if (tree.length >= docLength) return false;
  for (let n: SyntaxNode | null = tree.resolveInner(l.to, -1); n; n = n.parent)
    if (n.from >= l.from && n.to >= tree.length && n.type.prop(foldNodeProp)) return true;
  return false;
}

/** Markdown sections (sticky.logic.ts) from the top-level blocks of the tree. */
function mdSections(tree: Tree, docLength: number): Section[] {
  const blocks = function* () {
    for (let b = tree.topNode.firstChild; b; b = b.nextSibling) {
      const h = /^(?:ATX|Setext)Heading(\d)$/.exec(b.name);
      yield { level: h ? +h[1] : 0, from: b.from, to: b.to };
    }
  };
  return sections(blocks(), tree.length < docLength ? docLength : undefined);
}

/** Edits inside single lines that keep every line's indentation (typing in a line): the indentation parents stay valid. */
function sameIndents(u: ViewUpdate): boolean {
  const a = u.startState.doc;
  const b = u.state.doc;
  if (a.lines !== b.lines) return false;
  let same = true;
  u.changes.iterChanges((fromA, toA, fromB) => {
    const la = a.lineAt(fromA);
    const lb = b.lineAt(fromB);
    if (!same || toA > la.to) return void (same = false);
    const wa = lead(la.text);
    const wb = lead(lb.text);
    same = wa === wb && wa.length < la.length && wb.length < lb.length;
  });
  return same;
}

class Sticky implements PluginValue {
  dom = document.createElement("div");
  /** Pinned header lines (1-based), outermost first. */
  lines: number[] = [];
  /** Height of the pinned stack in px. */
  height = 0;
  // Fold end line per header, valid for one doc and tree (grammar loads and parsing change folds).
  private ends = new Map<number, number | null>();
  private memoDoc: Text | null = null;
  private memoTree: Tree | null = null;
  private found = new Map<number, number[]>();
  // Markdown sections of the doc and tree; the tree is flat and sections come from a fold service, so neither the tree
  // nor the indentation knows them.
  private md: Section[] | null = null;
  // Nearest less indented line above, per line (sticky.logic.ts indentParents); survives typing within lines.
  private up = new Map<number, number>();
  // Measures left in which the cursor, just scrolled into view, is kept clear of rows that scroll itself pinned
  // (the scroll margin only knows the stack from before). Three: the first read runs before CodeMirror scrolls.
  private reveal = 0;
  private rows = new Map<string, HTMLElement>();
  private lang: Language | null = null;

  constructor(readonly view: EditorView) {
    this.dom.className = "cm-sticky";
    this.dom.style.display = "none";
    this.dom.addEventListener("mousedown", this.click);
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.schedule);
    this.schedule();
  }

  update(u: ViewUpdate) {
    if (u.docChanged && !sameIndents(u)) this.up.clear();
    if (u.transactions.some((tr) => tr.scrollIntoView)) this.reveal = 3;
    this.schedule();
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.schedule);
    this.dom.remove();
  }

  schedule = () => this.view.requestMeasure(this.measure);

  private measure = {
    key: this,
    read: (view: EditorView): Layout => {
      const scroller = view.scrollDOM;
      const { state } = view;
      const doc = state.doc;
      const lh = view.defaultLineHeight;
      // Scroller top edge in document coordinates
      const top = scroller.getBoundingClientRect().top - view.documentTop;
      // Every scope that can reach a row contains one of the lines (line blocks, so folds count once) under the rows.
      const cands = new Set<number>();
      for (let b = view.lineBlockAtHeight(Math.max(0, top)); ; b = view.lineBlockAt(b.to + 1)) {
        for (const h of this.scopes(state, doc.lineAt(b.from).number)) cands.add(h);
        if (b.top >= top + MAX * lh || b.to >= doc.length) break;
      }
      const bottom = (n: number) => view.lineBlockAt(doc.line(n).from).bottom;
      const { lines, push } = stack([...cands], top, lh, MAX, (h) => [bottom(h), bottom(this.ends.get(h)!)]);
      let cover = 0;
      if (this.reveal > 0) {
        this.reveal--;
        const b = view.lineBlockAt(state.selection.main.head);
        if (b.top >= top) cover = Math.max(0, top + lines.length * lh + push - b.top);
      }
      const nums = scroller.querySelector<HTMLElement>(".cm-lineNumbers");
      const line = view.contentDOM.querySelector<HTMLElement>(".cm-line");
      return {
        lines,
        push,
        cover,
        lh,
        top: scroller.offsetTop,
        width: scroller.clientWidth,
        gutter: view.contentDOM.offsetLeft,
        num: nums ? { left: nums.offsetLeft, width: nums.offsetWidth } : null,
        pad: (line ? parseFloat(getComputedStyle(line).paddingLeft) : 0) - scroller.scrollLeft,
      };
    },
    write: (m: Layout, view: EditorView) => {
      if (m.cover > 0.5) view.scrollDOM.scrollTop -= m.cover;
      const { state } = view;
      // Rows are rebuilt only when what they show changes: not on every keystroke or parse step (headers sit above
      // the viewport and are parsed already), but when the grammar arrives or the parse first reaches them. Rows
      // that stay pinned while the stack changes are reused.
      const tree = syntaxTree(state);
      const lang = state.facet(language);
      if (lang !== this.lang) this.rows.clear();
      this.lang = lang;
      const rows = new Map<string, HTMLElement>();
      m.lines.forEach((n, i) => {
        const line = state.doc.line(n);
        const key = JSON.stringify([n, line.text.slice(0, CHARS), tree.length >= line.to, m.lh, m.num, m.gutter]);
        const row = this.rows.get(key) ?? this.row(state, n, m);
        row.style.zIndex = String(MAX - i);
        row.style.marginTop = "";
        rows.set(key, row);
      });
      const els = [...rows.values()];
      if (els.length !== this.dom.children.length || els.some((e, i) => this.dom.children[i] !== e)) this.dom.replaceChildren(...els);
      this.rows = rows;
      this.lines = m.lines;
      this.height = Math.max(0, m.lines.length * m.lh + m.push);
      Object.assign(this.dom.style, {
        display: m.lines.length ? "" : "none",
        top: `${m.top}px`,
        width: `${m.width}px`,
        height: `${this.height}px`,
      });
      // A scope ending under the stack slides its row up behind the rows above it.
      const row = this.dom.lastElementChild as HTMLElement | null;
      if (row) row.style.marginTop = `${m.push}px`;
      for (const code of this.dom.querySelectorAll<HTMLElement>(".cm-sticky-code")) code.style.transform = `translateX(${m.pad}px)`;
    },
  };

  /** Scope headers around line n: candidates from the syntax tree and the indentation, checked with foldable(). */
  private scopes(state: EditorState, n: number): number[] {
    const doc = state.doc;
    const tree = syntaxTree(state);
    if (doc !== this.memoDoc || tree !== this.memoTree) {
      this.ends.clear();
      this.md = null;
      this.memoDoc = doc;
      this.memoTree = tree;
      this.found.clear();
    }
    const known = this.found.get(n);
    if (known) return known;
    let cands: number[];
    if (state.facet(language)?.name === "markdown") {
      // Only the heading path, as VS Code pins it: the sections around n are the last heading above n and its parents.
      const md = (this.md ??= mdSections(tree, doc.length));
      cands = [];
      const from = doc.line(n).from;
      let lo = 0;
      for (let hi = md.length; lo < hi; ) {
        const mid = (lo + hi) >> 1;
        if (md[mid].from < from) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo - 1; i >= 0; i = md[i].parent) {
        const h = doc.lineAt(md[i].from).number;
        this.ends.set(h, doc.lineAt(md[i].to).number);
        cands.push(h);
      }
    } else {
      cands = indentParents((i) => doc.line(i).text, n, state.tabSize, this.up);
      // Grammar folds can start below the node (HTML: after a multi-line open tag), so take where the fold starts too.
      for (let node: SyntaxNode | null = tree.resolveInner(doc.line(n).from, 1); node; node = node.parent) {
        cands.push(doc.lineAt(node.from).number);
        const fold = node.type.prop(foldNodeProp)?.(node, state);
        if (fold) cands.push(doc.lineAt(fold.from).number);
      }
    }
    const end = (h: number) => {
      if (!this.ends.has(h)) {
        const l = doc.line(h);
        const r = unparsed(tree, doc.length, l) ? { to: doc.length } : foldable(state, l.from, l.to);
        this.ends.set(h, r ? doc.lineAt(r.to).number : null);
      }
      return this.ends.get(h)!;
    };
    const lines = enclosing(cands, n, end);
    this.found.set(n, lines);
    return lines;
  }

  private row(state: EditorState, n: number, m: Layout) {
    const row = document.createElement("div");
    row.className = "cm-sticky-line";
    row.dataset.line = String(n);
    row.style.height = row.style.lineHeight = `${m.lh}px`;
    if (m.num) {
      const num = document.createElement("span");
      num.className = "cm-sticky-num";
      num.textContent = String(n);
      Object.assign(num.style, { left: `${m.num.left}px`, width: `${m.num.width}px` });
      row.append(num);
    }
    const text = document.createElement("div");
    text.className = "cm-sticky-text";
    text.style.left = `${m.gutter}px`;
    text.style.tabSize = String(state.tabSize);
    const code = document.createElement("span");
    code.className = "cm-sticky-code";
    const line = state.doc.line(n);
    const to = Math.min(line.to, line.from + CHARS);
    // shortcut: bracket colors are taken when the row is built; an edit above that changes the nesting leaves them until the row's text or line changes.
    const brackets = bracketClasses(state, line.from, to);
    const span = (from: number, end: number, cls: string) => {
      if (from >= end) return;
      if (!cls) return code.append(state.doc.sliceString(from, end));
      const s = document.createElement("span");
      s.className = cls;
      s.textContent = state.doc.sliceString(from, end);
      code.append(s);
    };
    let pos = line.from;
    // Text up to end in token class cls, brackets in their pair colors as in the line itself.
    const put = (end: number, cls: string) => {
      for (const [b, bc] of brackets)
        if (b >= pos && b < end) {
          span(pos, b, cls);
          span(b, b + 1, `${cls} ${bc}`.trim());
          pos = b + 1;
        }
      span(pos, end, cls);
      pos = end;
    };
    highlightTree(syntaxTree(state), { style: (tags) => highlightingFor(state, tags) }, (from, end, cls) => (put(from, ""), put(end, cls)), line.from, to);
    put(to, "");
    text.append(code);
    row.append(text);
    return row;
  }

  /** Scroll line n to row `above`; a second pass corrects estimated heights that the first scroll measured. */
  private settle(n: number, above: number, tries = 2) {
    this.view.requestMeasure({
      read: (v) => {
        if (n > v.state.doc.lines) return 0;
        const y = v.documentTop + v.lineBlockAt(v.state.doc.line(n).from).top;
        return y - v.scrollDOM.getBoundingClientRect().top - above * v.defaultLineHeight;
      },
      write: (d, v) => {
        if (Math.abs(d) < 1) return;
        v.scrollDOM.scrollTop += d;
        if (tries > 1) this.settle(n, above, tries - 1);
      },
    });
  }

  private click = (e: MouseEvent) => {
    const row = (e.target as Element).closest<HTMLElement>(".cm-sticky-line");
    if (!row || e.button !== 0) return;
    e.preventDefault();
    const view = this.view;
    // Rows redraw in the next measure; a click in between must not reach past an edit that removed lines
    const line = view.state.doc.line(Math.min(Number(row.dataset.line), view.state.doc.lines));
    const pos = line.from + (/^\s*/.exec(line.text)?.[0].length ?? 0);
    view.dispatch({ selection: { anchor: pos } });
    // Land just below the headers that stay pinned above it. Line box, not scrollIntoView: that aligns the glyph box.
    this.settle(line.number, this.lines.indexOf(line.number));
    view.focus();
  };
}

const plugin = ViewPlugin.fromClass(Sticky, {
  // Scrolling the cursor or a search match into view keeps it clear of the pinned lines.
  provide: (p) =>
    EditorView.scrollMargins.of((v) => {
      const h = v.plugin(p)?.height;
      return h ? { top: h } : null;
    }),
});

export const stickyScroll = [
  plugin,
  EditorView.theme({
    ".cm-sticky": {
      position: "absolute",
      left: 0,
      zIndex: 210,
      overflow: "hidden",
      fontFamily: "var(--font-mono)",
      backgroundColor: "var(--card)",
      borderBottom: "1px solid color-mix(in oklch, var(--border) 70%, transparent)",
      boxShadow: "0 3px 6px -3px color-mix(in oklch, var(--foreground) 22%, transparent)",
    },
    ".cm-sticky-line": { position: "relative", cursor: "pointer", whiteSpace: "pre", backgroundColor: "var(--card)" },
    ".cm-sticky-line:hover": { backgroundImage: "linear-gradient(color-mix(in oklch, var(--primary) 7%, transparent) 0 0)" },
    ".cm-sticky-num": {
      position: "absolute",
      boxSizing: "border-box",
      padding: "0 8px 0 12px",
      textAlign: "right",
      color: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
    },
    ".cm-sticky-text": { position: "absolute", top: 0, right: 0, overflow: "hidden" },
    ".cm-sticky-code": { display: "inline-block" },
  }),
];
