// Inline git blame for the cursor line (like GitLens): dimmed text after the line end once the cursor rests.
import { Compartment, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { fs, type Blame, type BlameCommit } from "$lib/files";
import { blameLabel, blameTitle, uncommitted } from "$lib/blame.logic";

const REST_MS = 500;
// After edits: blame needs a git process over the whole buffer, so not per keystroke.
const REFETCH_MS = 1000;

class BlameWidget extends WidgetType {
  constructor(
    readonly c: BlameCommit,
    readonly open: (sha: string) => void,
  ) {
    super();
  }
  eq(o: BlameWidget) {
    return o.c === this.c;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-blame";
    el.title = blameTitle(this.c);
    // Only the text is clickable: a click in the gap after the line end still places the cursor.
    const label = el.appendChild(document.createElement("span"));
    label.textContent = blameLabel(this.c);
    if (!uncommitted(this.c)) {
      label.className = "cm-blame-link";
      label.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.open(this.c.sha);
      });
    }
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const blameLine = Decoration.line({ class: "cm-blame-line" });
const setBlame = StateEffect.define<DecorationSet>();
// Any edit or cursor move hides it; the plugin shows it again after the rest delay.
const shown = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    for (const e of tr.effects) if (e.is(setBlame)) return e.value;
    return tr.docChanged || tr.selection ? Decoration.none : d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const plugin = (repo: string, path: string, open: (sha: string) => void) =>
  ViewPlugin.fromClass(
    class {
      /** Blame of exactly `doc`; per file, refetched only after edits. */
      data: Blame | null = null;
      doc: Text | null = null;
      fetchT = 0;
      restT = 0;
      gen = 0;
      constructor(readonly view: EditorView) {
        this.fetch(0);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.fetch(REFETCH_MS);
        if (u.docChanged || u.selectionSet) {
          clearTimeout(this.restT);
          this.restT = window.setTimeout(() => this.show(), REST_MS);
        }
      }
      fetch(ms: number) {
        clearTimeout(this.fetchT);
        this.fetchT = window.setTimeout(() => {
          const doc = this.view.state.doc;
          const g = ++this.gen;
          fs.blame(repo, path, doc.toString()).then(
            (b) => {
              if (g !== this.gen) return;
              [this.data, this.doc] = [b, doc];
              this.show();
            },
            () => {}, // No git or an error: simply no blame.
          );
        }, ms);
      }
      show() {
        const st = this.view.state;
        // Lines shifted since the fetch: wait for the next one rather than show a wrong commit.
        if (!this.data || st.doc !== this.doc) return;
        const line = st.doc.lineAt(st.selection.main.head);
        const c = this.data.commits[this.data.lines[line.number - 1]];
        if (!c) return;
        const deco = [blameLine.range(line.from), Decoration.widget({ widget: new BlameWidget(c, open), side: 1 }).range(line.to)];
        this.view.dispatch({ effects: setBlame.of(Decoration.set(deco, true)) });
      }
      destroy() {
        clearTimeout(this.fetchT);
        clearTimeout(this.restT);
        this.gen++;
      }
    },
  );

const theme = EditorView.baseTheme({
  // Like the lens: absolute at its inline place and clipped by the line, so moving the cursor never changes the
  // scroll width (a horizontal scrollbar would come and go).
  ".cm-blame-line": { position: "relative", overflowX: "clip" },
  ".cm-blame": {
    position: "absolute",
    maxWidth: "60ch",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    // Padding, not margin: the caret at the line end is drawn at the widget's left edge.
    paddingLeft: "3em",
    color: "color-mix(in oklch, var(--muted-foreground) 70%, transparent)",
    fontStyle: "italic",
    userSelect: "none",
    pointerEvents: "none",
  },
  ".cm-blame > span": { pointerEvents: "auto" },
  // An inline diagnostic (lens.ts) takes the same line end and matters more.
  ".cm-lens-line .cm-blame": { display: "none" },
  ".cm-blame-link": { cursor: "pointer" },
  ".cm-blame-link:hover": { color: "var(--muted-foreground)", textDecoration: "underline" },
});

const toggle = new Compartment();
const ext = (on: boolean, repo: string, path: string, open: (sha: string) => void): Extension =>
  on ? [shown, plugin(repo, path, open), theme] : [];

/** Inline blame; `open` gets the commit sha on click. */
export const inlineBlame = (on: boolean, repo: string, path: string, open: (sha: string) => void) =>
  toggle.of(ext(on, repo, path, open));

/** Follow the setting in a live editor (also restored states); nothing happens when it already matches. */
export function syncBlame(view: EditorView, on: boolean, repo: string, path: string, open: (sha: string) => void) {
  const cur = toggle.get(view.state);
  if (on !== (Array.isArray(cur) && cur.length > 0)) view.dispatch({ effects: toggle.reconfigure(ext(on, repo, path, open)) });
}
