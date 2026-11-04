// Overview ruler as in VS Code: a strip beside the scrollbar with the positions of diagnostics, git changes, search
// matches and the cursor over the whole document. A click jumps to the mark under it, elsewhere it scrolls there.
import { EditorView } from "codemirror";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { forEachDiagnostic } from "@codemirror/lint";
import { getSearchQuery, searchPanelOpen, type SearchQuery } from "@codemirror/search";
import { gitMarks, type GitMarker } from "./cm";
import { nearest, runs } from "../../ruler.logic.ts";

const WIDTH = 10;
/** Scroller box in the editor and the document's place in its scroll height. */
type Geo = { top: number; h: number; total: number; off: number };

class Ruler {
  view: EditorView;
  dom = document.createElement("div");
  cursor = document.createElement("div");
  geo: Geo | null = null;
  /** Marks need a redraw; kept across measure requests, which replace each other within a frame. */
  dirty = true;
  ys: number[] = [];
  targets: number[] = [];
  /** What the strip shows now, to skip unchanged redraws. */
  drawn = "";
  /** Open find panel's query and the first match of each matching line, mapped through edits between searches. */
  query: SearchQuery | null = null;
  found: number[] = [];
  timer: ReturnType<typeof setTimeout> | undefined;

  constructor(view: EditorView) {
    this.view = view;
    this.dom.className = "cm-ruler";
    this.cursor.className = "cm-ruler-cursor";
    this.dom.append(this.cursor);
    this.dom.setAttribute("aria-hidden", "true");
    this.dom.addEventListener("mousedown", this.click);
    view.dom.appendChild(this.dom);
    this.search();
    this.measure();
  }

  update(u: ViewUpdate) {
    const marks = u.docChanged || u.geometryChanged || u.heightChanged || u.transactions.some((t) => t.effects.length > 0);
    const q = searchPanelOpen(u.state) ? getSearchQuery(u.state) : null;
    if (u.docChanged) this.found = this.found.map((p) => u.changes.mapPos(p));
    if (q ? !this.query?.eq(q) : this.query) this.search();
    // Searching the whole document costs ~15 ms on 9000 lines: not on every keystroke.
    else if (q && u.docChanged) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.search();
        this.dirty = true;
        this.measure();
      }, 300);
    }
    this.dirty ||= marks;
    if (marks || u.selectionSet) this.measure();
  }

  search() {
    const { state } = this.view;
    const q = searchPanelOpen(state) ? getSearchQuery(state) : null;
    this.query = q;
    this.found = [];
    if (!q?.valid || !q.search) return;
    // One mark per stretch of lines (the strip has fewer pixel rows than a long file has lines): after a match the
    // search goes on below the stretch, so a regex like "." does not walk every character. A cursor of a regex that may
    // span lines (CodeMirror's own test) flattens the document from its start, so for those the matches are walked.
    // shortcut: that walk stops after 20000 matches (~2 ms), so a dense one like [^] marks only the lines up to there; search in idle slices if it matters.
    const { doc } = state;
    const stretch = Math.max(1, Math.floor(doc.lines / 2000));
    const jump = !q.regexp || !/\\[sWDnr]|\n|\r|\[\^/.test(q.search);
    let it = q.getCursor(state);
    for (let n = 0, end = -1; jump || n < 20000; n++) {
      const m = it.next();
      if (m.done) break;
      if (m.value.from <= end) continue;
      end = doc.line(Math.min(doc.lines, doc.lineAt(m.value.from).number + stretch - 1)).to;
      this.found.push(m.value.from);
      if (end === doc.length) break;
      if (jump) it = q.getCursor(state, end + 1);
    }
  }

  measure() {
    this.view.requestMeasure({
      key: this,
      read: (v) => {
        const s = v.scrollDOM;
        return { top: s.offsetTop, h: s.clientHeight, total: s.scrollHeight, off: v.documentTop - s.getBoundingClientRect().top + s.scrollTop };
      },
      write: (g) => {
        const old = this.geo;
        this.geo = g;
        if (this.dirty || !old || old.h !== g.h || old.total !== g.total || old.top !== g.top) this.draw(g);
        this.dirty = false;
        this.place(this.cursor, this.view.state.selection.main.head, 2);
      },
    });
  }

  /** Center of the line block around pos in strip pixels, kept inside the strip for a mark of height h. */
  y(pos: number, h: number) {
    const g = this.geo!;
    const b = this.view.lineBlockAt(pos);
    return Math.min(Math.max(((b.top + b.bottom) / 2 + g.off) * (g.h / g.total), h / 2), g.h - h / 2);
  }

  place(el: HTMLElement, pos: number, h: number) {
    el.style.top = `${this.y(pos, h) - h / 2}px`;
    el.style.height = `${h}px`;
  }

  draw(g: Geo) {
    const { view } = this;
    const { state } = view;
    const scale = g.h / g.total;
    const marks: Record<string, [number, number][]> = {};
    const ys: number[] = [];
    const targets: number[] = [];
    const add = (kind: string, pos: number, h: number) => {
      const y = this.y(pos, h);
      (marks[kind] ??= []).push([y - h / 2, y + h / 2]);
      ys.push(y);
      targets.push(pos);
    };
    // Git marks span their whole line so neighbouring lines join into one bar.
    for (let it = state.field(gitMarks, false)?.iter(); it?.value; it.next()) {
      const b = view.lineBlockAt(it.from);
      const top = (b.top + g.off) * scale;
      const bottom = Math.max(top + 2, (b.bottom + g.off) * scale);
      (marks[(it.value as GitMarker).kind] ??= []).push([top, bottom]);
      ys.push((top + bottom) / 2);
      targets.push(it.from);
    }
    forEachDiagnostic(state, (d, from) => add(d.severity === "error" || d.severity === "warning" ? d.severity : "info", from, 3));
    for (const p of this.found) add("search", p, 2);
    this.ys = ys;
    this.targets = targets;
    // Half-pixel steps: most keystrokes then leave the strip as it was and its DOM is not touched.
    const half = (x: number) => Math.round(x * 2) / 2;
    const list = Object.entries(marks).flatMap(([kind, m]) => runs(m).map(([a, b]) => [kind, half(a), Math.max(half(b) - half(a), 1)] as const));
    const key = `${g.top} ${g.h} ${list.join(";")}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.dom.style.top = `${g.top}px`;
    this.dom.style.height = `${g.h}px`;
    this.dom.replaceChildren(
      ...list.map(([kind, top, h]) => {
        const el = document.createElement("div");
        el.className = `cm-ruler-${kind}`;
        el.style.top = `${top}px`;
        el.style.height = `${h}px`;
        return el;
      }),
      this.cursor,
    );
  }

  click = (e: MouseEvent) => {
    const g = this.geo;
    if (e.button !== 0 || !g) return;
    e.preventDefault();
    const v = this.view;
    const y = e.clientY - this.dom.getBoundingClientRect().top;
    const i = nearest(this.ys, y, 4);
    if (i >= 0) {
      v.dispatch({ selection: { anchor: this.targets[i] }, effects: EditorView.scrollIntoView(this.targets[i], { y: "center" }) });
      v.focus();
    } else v.dispatch({ effects: EditorView.scrollIntoView(v.lineBlockAtHeight(y / (g.h / g.total) - g.off).from, { y: "center" }) });
  };

  destroy() {
    clearTimeout(this.timer);
    this.dom.remove();
  }
}

export const ruler = [
  ViewPlugin.fromClass(Ruler),
  EditorView.theme({
    // Room for the strip right of the scrollbar, so it never covers text.
    ".cm-scroller": { marginRight: `${WIDTH}px` },
    ".cm-ruler": {
      position: "absolute",
      right: 0,
      width: `${WIDTH}px`,
      // Redraws stay inside the strip instead of invalidating the editor's layout.
      contain: "strict",
      backgroundColor: "color-mix(in oklch, var(--foreground) 3%, transparent)",
    },
    ".cm-ruler div": { position: "absolute", pointerEvents: "none" },
    // Lanes as in VS Code: git left, search middle, diagnostics right; the cursor across.
    ".cm-ruler-add, .cm-ruler-mod, .cm-ruler-del": { left: 0, width: "3px" },
    ".cm-ruler-add": { backgroundColor: "var(--success)" },
    ".cm-ruler-mod": { backgroundColor: "var(--warning)" },
    ".cm-ruler-del": { backgroundColor: "var(--destructive)" },
    ".cm-ruler-search": { left: "3px", width: "3px", backgroundColor: "var(--primary)" },
    ".cm-ruler-error, .cm-ruler-warning, .cm-ruler-info": { right: 0, width: "4px" },
    ".cm-ruler-error": { backgroundColor: "var(--destructive)" },
    ".cm-ruler-warning": { backgroundColor: "var(--warning)" },
    ".cm-ruler-info": { backgroundColor: "var(--muted-foreground)" },
    ".cm-ruler-cursor": { left: 0, right: 0, backgroundColor: "color-mix(in oklch, var(--foreground) 55%, transparent)" },
  }),
];
