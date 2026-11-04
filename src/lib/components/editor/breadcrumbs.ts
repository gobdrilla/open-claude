// Breadcrumbs as in Rider and VS Code: "Lab › Shape › Area" for the cursor, in a thin bar under the text, from the
// server's document symbols. A click on a part lists the symbols beside it to jump to.
import type { Text } from "@codemirror/state";
import { EditorView, showPanel, type Panel, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { crumbsAt, symbolTree, type Crumb, type SymNode } from "$lib/nav.logic";
import { showPick } from "./nav.ts";

const DELAY = 700;
const KIND: Record<number, string> = {
  2: "Modul",
  3: "Namespace",
  5: "Klasse",
  6: "Methode",
  7: "Eigenschaft",
  8: "Feld",
  9: "Konstruktor",
  10: "Enum",
  11: "Interface",
  12: "Funktion",
  13: "Variable",
  14: "Konstante",
  22: "Enum-Wert",
  23: "Struct",
  24: "Event",
};

class Crumbs implements Panel {
  dom = document.createElement("div");
  tree: SymNode[] = [];
  /** Document the tree's positions refer to. */
  doc: Text | null = null;
  shown = "";
  timer: ReturnType<typeof setTimeout> | undefined;
  seq = 0;
  constructor(readonly view: EditorView) {
    this.dom.className = "cm-crumbs";
    this.dom.style.display = "none";
    this.schedule(0);
  }
  update(u: ViewUpdate) {
    if (u.docChanged) this.schedule(DELAY);
    if (u.selectionSet || u.docChanged) this.draw();
  }
  schedule(ms: number) {
    this.seq++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.fetch(), ms);
  }
  async fetch() {
    const seq = this.seq;
    const lsp = LSPPlugin.get(this.view);
    if (!lsp) return;
    await lsp.client.initializing;
    if (!lsp.client.serverCapabilities?.documentSymbolProvider) return;
    lsp.client.sync();
    const doc = lsp.syncedDoc;
    const res = await lsp.client.request<unknown, Parameters<typeof symbolTree>[0]>("textDocument/documentSymbol", { textDocument: { uri: lsp.uri } }).catch(() => undefined);
    // Error (still indexing): keep the old crumbs.
    if (seq !== this.seq || res === undefined) return;
    this.tree = symbolTree(res);
    this.doc = doc;
    // New tree: rebuild the parts, their pick lists hold symbols of the old one.
    this.shown = "-";
    this.draw();
  }
  /** Offset of a symbol in the current document (the tree may be a few edits old). */
  posOf(s: SymNode) {
    const lsp = LSPPlugin.get(this.view);
    const doc = this.view.state.doc;
    if (!lsp || !this.doc || s.selectionRange.start.line >= this.doc.lines) return 0;
    const at = lsp.fromPosition(s.selectionRange.start, this.doc);
    return Math.min(this.doc === lsp.syncedDoc ? lsp.unsyncedChanges.mapPos(at) : at, doc.length);
  }
  draw() {
    const lsp = LSPPlugin.get(this.view);
    if (!lsp) return;
    const head = this.view.state.selection.main.head;
    const crumbs = this.tree.length ? crumbsAt(this.tree, lsp.toPosition(head, this.view.state.doc)) : [];
    const key = crumbs.map((c) => `${c.sym.name}\n${c.sym.selectionRange.start.line}`).join("\n\n");
    // Hidden only for files without symbols: toggling with the cursor would make the text jump by the bar's height.
    this.dom.style.display = this.tree.length ? "" : "none";
    if (key === this.shown) return;
    this.shown = key;
    this.dom.replaceChildren(...crumbs.flatMap((c, i) => (i ? [sep(), this.part(c)] : [this.part(c)])));
  }
  part(c: Crumb) {
    const b = document.createElement("button");
    b.className = "cm-crumb";
    b.textContent = c.sym.name;
    b.title = KIND[c.sym.kind] ?? "";
    b.onmousedown = (e) => {
      e.preventDefault();
      const view = this.view;
      const items = c.siblings.map((s) => ({
        label: s.name,
        detail: KIND[s.kind],
        run: (v: EditorView) => v.dispatch({ selection: { anchor: this.posOf(s) }, scrollIntoView: true }),
      }));
      // The current one first, so Enter keeps the place.
      items.unshift(...items.splice(c.siblings.indexOf(c.sym), 1));
      view.focus();
      showPick(view, view.state.selection.main.head, items);
    };
    return b;
  }
  destroy() {
    clearTimeout(this.timer);
    this.seq++;
  }
}

function sep() {
  const s = document.createElement("span");
  s.className = "cm-crumb-sep";
  s.textContent = "›";
  return s;
}

const theme = EditorView.baseTheme({
  ".cm-crumbs": {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    height: "22px",
    padding: "0 8px",
    fontFamily: "var(--font-sans, system-ui)",
    fontSize: "12px",
    color: "var(--muted-foreground)",
    whiteSpace: "nowrap",
    overflow: "hidden",
  },
  ".cm-crumb": { padding: "0 4px", borderRadius: "4px", background: "none", border: "none", color: "inherit", font: "inherit", cursor: "pointer" },
  ".cm-crumb:hover": { color: "var(--foreground)", backgroundColor: "var(--muted)" },
  ".cm-crumb-sep": { opacity: "0.6" },
});

export const breadcrumbs: LSPClientExtension = {
  clientCapabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } },
  editorExtension: [showPanel.of((view) => new Crumbs(view)), theme],
};
