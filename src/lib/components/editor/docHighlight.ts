// Occurrences of the symbol at the cursor from the language server (textDocument/documentHighlight): only the same
// symbol, not every equal word, and writes ("x = …") look different from reads, as in Rider. While a server
// answers these, the text matches of wordHighlight.ts are hidden for an empty selection; without one, or after
// an error, they stay the fallback. Selecting text still shows the plain text matches.
import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import type { LspRange } from "$lib/nav.logic";

type Hl = { range: LspRange; kind?: number };
type Value = { deco: DecorationSet; on: boolean };

const set = StateEffect.define<Value>();
const DELAY = 120;
const WRITE = 3;

const read = Decoration.mark({ class: "cm-lspHighlight" });
const write = Decoration.mark({ class: "cm-lspHighlight cm-lspHighlight-write" });

const field = StateField.define<Value>({
  create: () => ({ deco: Decoration.none, on: false }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(set)) return e.value;
    return tr.docChanged ? { ...v, deco: v.deco.map(tr.changes) } : v;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    // Hide the text matches only while the cursor alone decides (wordHighlight's highlightWordAroundCursor).
    EditorView.editorAttributes.compute([f, "selection"], (s) => ({ class: s.field(f).on && s.selection.main.empty ? "cm-lspHl" : "" })),
  ],
});

const plugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    seq = 0;
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(u: ViewUpdate) {
      if (u.selectionSet || u.docChanged) this.schedule();
    }
    schedule() {
      this.seq++;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.fetch(), DELAY);
    }
    async fetch() {
      const seq = this.seq;
      const view = this.view;
      const lsp = LSPPlugin.get(view);
      if (!lsp) return;
      await lsp.client.initializing;
      const sel = view.state.selection.main;
      if (!lsp.client.serverCapabilities?.documentHighlightProvider) return this.show(seq, Decoration.none, false);
      if (!sel.empty) return this.show(seq, Decoration.none, true);
      lsp.client.sync();
      const doc = lsp.syncedDoc;
      const res = await lsp.client
        .request<unknown, Hl[] | null>("textDocument/documentHighlight", { textDocument: { uri: lsp.uri }, position: lsp.toPosition(sel.head, doc) })
        .catch(() => undefined);
      // Typed or moved since: the newer round answers.
      if (seq !== this.seq || doc !== lsp.syncedDoc) return;
      if (res === undefined) return this.show(seq, Decoration.none, false);
      const head = view.state.selection.main.head;
      const out: Range<Decoration>[] = [];
      for (const h of res ?? []) {
        if (h.range.start.line >= doc.lines || h.range.end.line >= doc.lines) continue;
        const from = lsp.fromPosition(h.range.start, doc);
        const to = lsp.fromPosition(h.range.end, doc);
        // The occurrence under the cursor stays plain, as with the text matches.
        if (from >= to || (from <= head && head <= to)) continue;
        out.push((h.kind === WRITE ? write : read).range(from, to));
      }
      this.show(seq, Decoration.set(out, true), true);
    }
    show(seq: number, deco: DecorationSet, on: boolean) {
      if (seq !== this.seq) return;
      const v = this.view.state.field(field);
      if (!v.on && !on && !v.deco.size && !deco.size) return;
      this.view.dispatch({ effects: set.of({ deco, on }) });
    }
    destroy() {
      clearTimeout(this.timer);
      this.seq++;
    }
  },
);

const theme = EditorView.baseTheme({
  ".cm-lspHighlight": { backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)", borderRadius: "2px" },
  ".cm-lspHighlight-write": { backgroundColor: "oklch(0.72 0.15 35 / 0.28)" },
  "&.cm-lspHl .cm-selectionMatch": { backgroundColor: "transparent" },
});

export const docHighlight: LSPClientExtension = {
  clientCapabilities: { textDocument: { documentHighlight: {} } },
  editorExtension: [field, plugin, theme],
};
