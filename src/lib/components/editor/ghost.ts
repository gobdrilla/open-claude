// KI-Vorschlag als Grautext hinter dem Cursor (wie Copilot/Rider): nach einer Tipp-Pause fragt der Editor
// ai_complete (src-tauri/src/complete.rs), Tab uebernimmt, Esc verwirft, Weitertippen passend zum Vorschlag kuerzt ihn.
import { invoke } from "@tauri-apps/api/core";
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import { ghostText } from "$lib/editor.logic";

type Ghost = { pos: number; text: string } | null;
const setGhost = StateEffect.define<Ghost>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: GhostWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-ghost";
    s.textContent = this.text;
    return s;
  }
}

const field = StateField.define<Ghost>({
  create: () => null,
  update(g, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!g || (!tr.docChanged && !tr.selection)) return g;
    // Genau den Anfang des Vorschlags getippt: Rest stehen lassen.
    let typed: string | null = null;
    tr.changes.iterChanges((from, to, _f, _t, ins) => {
      typed = typed === null && from === g.pos && to === g.pos ? ins.toString() : "\0";
    });
    if (typed && g.text.startsWith(typed) && g.text.length > (typed as string).length) {
      return { pos: g.pos + (typed as string).length, text: g.text.slice((typed as string).length) };
    }
    return null;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g) => (g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)]) : Decoration.none)),
});

const accept = (view: EditorView) => {
  const g = view.state.field(field);
  if (!g) return false;
  view.dispatch({ changes: { from: g.pos, insert: g.text }, selection: { anchor: g.pos + g.text.length }, effects: setGhost.of(null), userEvent: "input.complete" });
  return true;
};

/** Hinter dem Cursor nur Leerzeichen und schliessende Zeichen: sonst stoert ein Vorschlag mitten in der Zeile. */
const END = /^[\s)\]}>;,'"`]*$/;
const PAUSE = 500;

export function ghost(path: string, enabled: () => boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(readonly view: EditorView) {}
      update(u: ViewUpdate) {
        if (!u.docChanged && !u.selectionSet) return;
        clearTimeout(this.timer);
        if (u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("delete"))) {
          this.timer = setTimeout(() => void this.ask(), PAUSE);
        }
      }
      async ask() {
        const { state } = this.view;
        const sel = state.selection.main;
        if (!enabled() || !this.view.hasFocus || !sel.empty || state.field(field)) return;
        // Die Liste der Autovervollstaendigung hat Vorrang.
        if (this.view.dom.querySelector(".cm-tooltip-autocomplete")) return;
        const pos = sel.head;
        const line = state.doc.lineAt(pos);
        const rest = state.sliceDoc(pos, line.to);
        if (!END.test(rest) || !state.sliceDoc(line.from, pos).trim()) return;
        const doc = state.doc;
        let raw: string;
        try {
          raw = await invoke<string>("ai_complete", {
            path,
            before: doc.sliceString(Math.max(0, pos - 4000), pos),
            after: doc.sliceString(pos, Math.min(doc.length, pos + 1500)),
          });
        } catch (e) {
          console.warn("KI-Vorschlag:", e);
          return;
        }
        // Inzwischen weitergetippt oder Cursor bewegt: der Vorschlag gehoert zur alten Stelle.
        if (this.view.state.doc !== doc || this.view.state.selection.main.head !== pos) return;
        const text = ghostText(raw, rest);
        if (text) this.view.dispatch({ effects: setGhost.of({ pos, text }) });
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );
  return [
    field,
    plugin,
    // Vor indentWithTab: Tab ohne Vorschlag rueckt weiter ein.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: accept },
        { key: "Escape", run: (v) => (v.state.field(field) ? (v.dispatch({ effects: setGhost.of(null) }), true) : false) },
      ]),
    ),
  ];
}
