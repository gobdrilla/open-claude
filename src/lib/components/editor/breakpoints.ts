// Breakpoints (red dot: click in the leftmost gutter or F9) and the line the debugger stopped at (arrow, highlighted
// line) for .NET files. While a file is open its editor owns the breakpoints: they move with edits and every change
// goes to the store through onChange (debug.svelte.ts persists them and tells a running debugger).
import { EditorView } from "codemirror";
import { Prec, RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, GutterMarker, gutter, keymap } from "@codemirror/view";

class Mark extends GutterMarker {
  readonly cls: string;
  readonly text: string;
  constructor(cls: string, text: string) {
    super();
    this.cls = cls;
    this.text = text;
  }
  eq(o: Mark) {
    return o.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.cls;
    s.textContent = this.text;
    return s;
  }
}
const dot = new Mark("cm-bp", "●");
const arrow = new Mark("cm-bp-at", "➜");

/** Toggle the breakpoint of the line starting at this position. */
const toggle = StateEffect.define<number>();
/** Line (1-based) the debugger stopped at in this file, null = none. */
export const setStopped = StateEffect.define<number | null>();
/** Replace all breakpoints (1-based lines), e.g. set by Claude's debugger tool. */
export const setLines = StateEffect.define<number[]>();

const bps = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLines)) set = RangeSet.of(e.value.filter((l) => l >= 1 && l <= tr.state.doc.lines).map((l) => dot.range(tr.state.doc.line(l).from)), true);
      if (!e.is(toggle)) continue;
      let had = false;
      set.between(e.value, e.value, () => void (had = true));
      set = had ? set.update({ filter: (from) => from !== e.value }) : set.update({ add: [dot.range(e.value)], sort: true });
    }
    return set;
  },
});

const stopped = StateField.define<number | null>({
  create: () => null,
  update(at, tr) {
    for (const e of tr.effects) if (e.is(setStopped)) return e.value === null || e.value > tr.state.doc.lines ? null : tr.state.doc.line(e.value).from;
    return at === null ? null : tr.changes.mapPos(at);
  },
  provide: (f) => EditorView.decorations.from(f, (at) => (at === null ? Decoration.none : Decoration.set(Decoration.line({ class: "cm-dbg-line" }).range(at)))),
});

/** Breakpoint lines, 1-based, sorted; deleting lines can put two on one. */
function lines(state: EditorState): number[] {
  const out = new Set<number>();
  state.field(bps).between(0, state.doc.length, (from) => void out.add(state.doc.lineAt(from).number));
  return [...out].sort((a, b) => a - b);
}

const toggleAt = (view: EditorView, pos: number) => view.dispatch({ effects: toggle.of(view.state.doc.lineAt(pos).from) });

/** Files the .NET debugger can stop in. */
export const debuggable = (path: string) => /\.(cs|fs|vb)$/i.test(path);

export function breakpoints(initial: number[], onChange: (lines: number[]) => void): Extension {
  return [
    bps.init((state) => RangeSet.of(initial.filter((l) => l >= 1 && l <= state.doc.lines).map((l) => dot.range(state.doc.line(l).from)), true)),
    stopped,
    // Highest: the leftmost gutter, as in Rider and Visual Studio.
    Prec.highest(
      gutter({
        class: "cm-bp-gutter",
        markers: (v) => {
          const at = v.state.field(stopped);
          return at === null ? v.state.field(bps) : [v.state.field(bps), RangeSet.of(arrow.range(at))];
        },
        initialSpacer: () => dot,
        domEventHandlers: {
          mousedown(view, line) {
            toggleAt(view, line.from);
            return true;
          },
        },
      }),
    ),
    keymap.of([
      {
        key: "F9",
        run: (v) => {
          const starts = new Set(v.state.selection.ranges.map((r) => v.state.doc.lineAt(r.head).from));
          v.dispatch({ effects: [...starts].map((p) => toggle.of(p)) });
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((u) => {
      if (u.startState.field(bps) === u.state.field(bps)) return;
      const now = lines(u.state);
      if (now.join() !== lines(u.startState).join()) onChange(now);
    }),
    EditorView.theme({
      ".cm-bp-gutter .cm-gutterElement": { cursor: "pointer", width: "16px", textAlign: "center", fontSize: "13px" },
      ".cm-bp": { color: "var(--destructive)" },
      ".cm-bp-at": { color: "var(--warning)", fontWeight: "bold" },
      // Stopped on a breakpoint: the arrow takes its place.
      ".cm-gutterElement:has(.cm-bp-at) .cm-bp": { display: "none" },
      ".cm-bp-gutter .cm-gutterElement:not(:has(.cm-bp, .cm-bp-at)):hover::before": { content: '"●"', color: "var(--destructive)", opacity: "0.35" },
      // Above the active line's background, which sits on the same element.
      ".cm-line.cm-dbg-line": { backgroundColor: "color-mix(in oklch, var(--warning) 22%, transparent)" },
    }),
  ];
}
