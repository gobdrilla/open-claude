// Inline diagnostics like Error Lens (VS Code) / Zed: the most severe message of a line, dimmed after its text.
import { EditorView } from "codemirror";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { forEachDiagnostic, setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";
import type { Range } from "@codemirror/state";
import { headline, worse } from "../../lens.logic.ts";

class Lens extends WidgetType {
  readonly text: string;
  readonly severity: Diagnostic["severity"];
  constructor(text: string, severity: Diagnostic["severity"]) {
    super();
    this.text = text;
    this.severity = severity;
  }
  eq(o: Lens) {
    return o.text === this.text && o.severity === this.severity;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-lens cm-lens-${this.severity}`;
    s.textContent = this.text;
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

const line = Decoration.line({ class: "cm-lens-line" });

function build(view: EditorView): DecorationSet {
  const { doc } = view.state;
  // An empty document has no visible ranges, but its one line shows.
  const ranges = doc.length ? view.visibleRanges : [{ from: 0, to: 0 }];
  const best = new Map<number, Diagnostic>();
  forEachDiagnostic(view.state, (d, from) => {
    if (!ranges.some((r) => from >= r.from && from <= r.to)) return;
    const n = doc.lineAt(from).number;
    best.set(n, worse(best.get(n), d));
  });
  const out: Range<Decoration>[] = [];
  for (const [n, d] of best) {
    const text = headline(d.message);
    if (!text) continue;
    const l = doc.line(n);
    out.push(line.range(l.from), Decoration.widget({ widget: new Lens(text, d.severity), side: 1 }).range(l.to));
  }
  return Decoration.set(out, true);
}

// Ellipsis needs a width: what is left of the visible row right of each lens.
const fitKey = {};
const fit = (view: EditorView) =>
  view.requestMeasure({
    key: fitKey,
    read: (v) => {
      const right = v.scrollDOM.getBoundingClientRect().left + v.scrollDOM.clientWidth;
      return [...v.contentDOM.querySelectorAll<HTMLElement>(".cm-lens")].map((e) => [e, right - e.getBoundingClientRect().left] as const);
    },
    write: (lenses) => lenses.forEach(([e, w]) => (e.style.maxWidth = `${Math.max(0, w - 8)}px`)),
  });

export const lens = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
        fit(view);
      }
      update(u: ViewUpdate) {
        const rebuild = u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setDiagnosticsEffect)));
        if (rebuild) this.decorations = build(u.view);
        if ((rebuild || u.geometryChanged) && this.decorations.size) fit(u.view);
      }
    },
    {
      decorations: (p) => p.decorations,
      // Horizontal scrolling moves the visible row end.
      eventObservers: { scroll: (_e, view) => fit(view) },
    },
  ),
  EditorView.theme({
    // The clip keeps a lens from widening the scroll area before fit has run.
    ".cm-lens-line": { position: "relative", overflowX: "clip" },
    // Absolute at its static (inline) place: never widens the line or changes its height.
    ".cm-lens": {
      position: "absolute",
      // Padding, not margin: the caret at the line end is drawn at the widget's left edge.
      paddingLeft: "3ch",
      whiteSpace: "pre",
      overflow: "hidden",
      textOverflow: "ellipsis",
      opacity: "0.75",
      userSelect: "none",
      WebkitUserSelect: "none",
      pointerEvents: "none",
    },
    ".cm-lens-error": { color: "var(--destructive)" },
    ".cm-lens-warning": { color: "var(--warning)" },
    ".cm-lens-info, .cm-lens-hint": { color: "var(--muted-foreground)" },
  }),
];
