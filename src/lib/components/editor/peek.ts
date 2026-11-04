// Peek definition as in VS Code (Alt+F12) and Rider's quick definition (Alt+Space): the definition opens in a small
// read-only editor under the current line instead of switching tabs. "Öffnen" jumps there, Escape closes.
import { Compartment, EditorState, Prec, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, lineNumbers, showDialog, type Command, type DecorationSet } from "@codemirror/view";
import { LSPPlugin, type Workspace } from "@codemirror/lsp-client";
import { uriPath } from "$lib/lsp.logic";
import { toLocs, type Loc } from "$lib/nav.logic";
import { language, theme as cmTheme } from "./cm.ts";
import { goto } from "./nav.ts";

type Peek = { line: number; loc: Loc; doc: Text; path: string };

const setPeek = StateEffect.define<Peek | null>();
const HEIGHT = 240;

class PeekWidget extends WidgetType {
  inner: EditorView | null = null;
  constructor(readonly peek: Peek) {
    super();
  }
  eq(o: PeekWidget) {
    return o.peek === this.peek;
  }
  get estimatedHeight() {
    return HEIGHT + 26;
  }
  toDOM(view: EditorView) {
    const { loc, doc, path } = this.peek;
    const dom = document.createElement("div");
    dom.className = "cm-peek";
    // As wide as the visible text area: long lines scroll inside the peek, the buttons stay in view.
    const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters");
    dom.style.width = `${Math.max(240, view.scrollDOM.clientWidth - (gutters?.offsetWidth ?? 0) - 24)}px`;
    const head = dom.appendChild(document.createElement("div"));
    head.className = "cm-peek-head";
    head.appendChild(document.createElement("span")).textContent = `${path}:${loc.range.start.line + 1}`;
    const open = head.appendChild(document.createElement("button"));
    open.textContent = "Öffnen";
    open.onclick = () => {
      close(view);
      void goto(view, loc);
    };
    const x = head.appendChild(document.createElement("button"));
    x.textContent = "×";
    x.title = "Schließen (Esc)";
    x.onclick = () => close(view);

    const lineNo = Math.min(loc.range.start.line + 1, doc.lines);
    const at = doc.line(lineNo).from;
    const lang = new Compartment();
    const inner = new EditorView({
      parent: dom,
      state: EditorState.create({
        doc,
        extensions: [
          cmTheme,
          lineNumbers(),
          lang.of([]),
          EditorState.readOnly.of(true),
          EditorView.decorations.of(Decoration.set([Decoration.line({ class: "cm-peek-target" }).range(at)])),
          EditorView.theme({ ".cm-scroller": { overflow: "auto" } }),
        ],
      }),
    });
    // Inline: the app's editor CSS sizes every .cm-editor to its pane.
    inner.dom.style.height = `${HEIGHT}px`;
    this.inner = inner;
    void language(path).then((ext) => ext && this.inner === inner && inner.dispatch({ effects: lang.reconfigure(ext) }));
    requestAnimationFrame(() => inner.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 48 }) }));
    return dom;
  }
  destroy() {
    this.inner?.destroy();
    this.inner = null;
  }
  ignoreEvent() {
    return true;
  }
}

const field = StateField.define<{ peek: Peek; deco: DecorationSet } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) {
      if (!e.is(setPeek)) continue;
      if (!e.value) return null;
      const line = tr.state.doc.line(Math.min(e.value.line, tr.state.doc.lines));
      return { peek: e.value, deco: Decoration.set([Decoration.widget({ widget: new PeekWidget(e.value), block: true, side: 1 }).range(line.to)]) };
    }
    return v && tr.docChanged ? { ...v, deco: v.deco.map(tr.changes) } : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v?.deco ?? Decoration.none),
});

function close(view: EditorView) {
  view.dispatch({ effects: setPeek.of(null) });
  view.focus();
}

const repoOf = (ws: Workspace) => (ws as Workspace & { repo?: string }).repo ?? "";

/** Peek the definition at the cursor; again (or Escape) closes it. */
export const peekDefinition: Command = (view) => {
  if (view.state.field(field)) return close(view), true;
  const plugin = LSPPlugin.get(view);
  if (!plugin || plugin.client.serverCapabilities?.definitionProvider === false) return false;
  const pos = view.state.selection.main.head;
  plugin.client.sync();
  void (async () => {
    const res = await plugin.client.request<unknown, Parameters<typeof toLocs>[0]>("textDocument/definition", {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(pos),
    });
    const loc = toLocs(res)[0];
    if (!loc) return void showDialog(view, { label: "Keine Definition gefunden", top: true });
    const file = await plugin.client.workspace.requestFile(loc.uri);
    if (!file) return void showDialog(view, { label: "Datei der Definition nicht lesbar", top: true });
    // Moved meanwhile: the peek belongs to where it was asked for.
    if (view.state.selection.main.head !== pos) return;
    const path = uriPath(repoOf(plugin.client.workspace), loc.uri) ?? decodeURIComponent(loc.uri.replace(/^file:\/\//, ""));
    view.dispatch({ effects: setPeek.of({ line: view.state.doc.lineAt(pos).number, loc, doc: file.doc, path }) });
  })().catch((e) => plugin.reportError("Keine Definition gefunden", e));
  return true;
};

const theme = EditorView.baseTheme({
  ".cm-peek": {
    margin: "4px 0 6px",
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--primary)",
    borderRadius: "6px",
    overflow: "hidden",
    backgroundColor: "var(--card, var(--background))",
  },
  ".cm-peek-head": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    height: "26px",
    padding: "0 8px",
    fontFamily: "var(--font-sans, system-ui)",
    fontSize: "12px",
    color: "var(--muted-foreground)",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-peek-head > span": { flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".cm-peek-head > button": { background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer", padding: "0 4px", borderRadius: "4px" },
  ".cm-peek-head > button:hover": { color: "var(--foreground)", backgroundColor: "var(--muted)" },
  ".cm-peek-target": { backgroundColor: "color-mix(in oklch, var(--primary) 14%, transparent)" },
});

export const peek = [
  field,
  theme,
  Prec.high(
    keymap.of([
      { key: "Alt-F12", run: peekDefinition, preventDefault: true },
      { key: "Alt-Space", run: peekDefinition, preventDefault: true },
      { key: "Escape", run: (view) => (view.state.field(field) ? (close(view), true) : false) },
    ]),
  ),
];
