// Folding ranges from the language server (textDocument/foldingRange) where the grammar has none: #region blocks,
// comment and using/import groups, languages with a thin grammar. Grammar folds win (their placeholder sits inside
// the braces), and so do declarations whose brace opens on the next line (Allman style): the grammar folds there.
// Ahead of the indentation fallback, which only guesses.
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { foldService } from "@codemirror/language";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { grammarFold, probingGrammar } from "./cm.ts";
import { foldsChanged } from "./setup.ts";

type Raw = { startLine: number; endLine: number };
/** Start of the first and of the last folded line, mapped through edits until the next answer. */
type Span = { from: number; to: number };

const setSpans = StateEffect.define<Span[]>();
const DELAY = 600;

const field = StateField.define<Span[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSpans)) return e.value;
    return tr.docChanged && v.length ? v.map((s) => ({ from: tr.changes.mapPos(s.from), to: tr.changes.mapPos(s.to) })) : v;
  },
});

const service = Prec.high(
  foldService.of((state, from, to) => {
    const spans = state.field(field, false);
    if (!spans?.length || probingGrammar()) return null;
    const doc = state.doc;
    const line = doc.lineAt(from);
    // Largest range starting on this line (servers report nested ones on the same line too).
    let end = 0;
    for (const s of spans) if (s.from >= line.from && s.from <= to) end = Math.max(end, doc.lineAt(s.to).number);
    if (end <= line.number || grammarFold(state, from, to)) return null;
    if (line.number < doc.lines && /^\s*\{\s*$/.test(doc.line(line.number + 1).text)) return null;
    return { from: line.to, to: doc.line(end).to };
  }),
);

const plugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    seq = 0;
    constructor(readonly view: EditorView) {
      this.schedule(0);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule(DELAY);
    }
    schedule(ms: number) {
      this.seq++;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.fetch(), ms);
    }
    async fetch() {
      const seq = this.seq;
      const view = this.view;
      const lsp = LSPPlugin.get(view);
      if (!lsp) return;
      await lsp.client.initializing;
      if (!lsp.client.serverCapabilities?.foldingRangeProvider) return;
      lsp.client.sync();
      const doc = lsp.syncedDoc;
      const res = await lsp.client.request<unknown, Raw[] | null>("textDocument/foldingRange", { textDocument: { uri: lsp.uri } }).catch(() => undefined);
      // Typed since: the next round answers. Error: keep the old ranges.
      if (seq !== this.seq || doc !== lsp.syncedDoc || res === undefined) return;
      const spans: Span[] = [];
      for (const r of res ?? []) {
        if (r.startLine < 0 || r.endLine <= r.startLine || r.endLine >= doc.lines) continue;
        spans.push({ from: doc.line(r.startLine + 1).from, to: doc.line(r.endLine + 1).from });
      }
      view.dispatch({ effects: [setSpans.of(spans), foldsChanged.of(null)] });
    }
    destroy() {
      clearTimeout(this.timer);
      this.seq++;
    }
  },
);

export const lspFolding: LSPClientExtension = {
  clientCapabilities: { textDocument: { foldingRange: { lineFoldingOnly: true } } },
  editorExtension: [field, service, plugin],
};
