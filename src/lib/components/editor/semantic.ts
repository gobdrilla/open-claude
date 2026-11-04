// Semantic highlighting from the language server (textDocument/semanticTokens/full): what the grammar cannot know
// from the text alone, as in Rider and VS Code. Only names are recolored (types, functions, properties, constants);
// keywords, strings and comments stay with the grammar, which already has them right and is never late.
import { Prec, RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { semanticSpans, type SemKind } from "$lib/nav.logic";

const set = StateEffect.define<DecorationSet>();
const DELAY = 400;

const MARKS: Record<SemKind, Decoration> = {
  type: Decoration.mark({ class: "cm-sem-type" }),
  fn: Decoration.mark({ class: "cm-sem-fn" }),
  prop: Decoration.mark({ class: "cm-sem-prop" }),
  const: Decoration.mark({ class: "cm-sem-const" }),
  meta: Decoration.mark({ class: "cm-sem-meta" }),
};

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    for (const e of tr.effects) if (e.is(set)) return e.value;
    return d.map(tr.changes);
  },
  // The grammar highlighter is Prec.high; above it the semantic span is the inner one and its color wins.
  provide: (f) => Prec.highest(EditorView.decorations.from(f)),
});

type Legend = { tokenTypes: string[]; tokenModifiers: string[] };

const plugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    seq = 0;
    constructor(readonly view: EditorView) {
      this.schedule(0);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule(DELAY);
      // Types declared in other files may have changed meanwhile.
      else if (u.focusChanged && u.view.hasFocus) this.schedule(DELAY);
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
      const prov = lsp.client.serverCapabilities?.semanticTokensProvider as { legend: Legend; full?: unknown } | undefined;
      if (!prov?.full) return;
      lsp.client.sync();
      const doc = lsp.syncedDoc;
      const res = await lsp.client
        .request<unknown, { data: number[] } | null>("textDocument/semanticTokens/full", { textDocument: { uri: lsp.uri } })
        .catch(() => undefined);
      // Typed since: the next round answers; meanwhile the old colors move with the text.
      if (seq !== this.seq || doc !== lsp.syncedDoc || res === undefined) return;
      view.dispatch({ effects: set.of(build(doc, res?.data ?? [], prov.legend.tokenTypes)) });
    }
    destroy() {
      clearTimeout(this.timer);
      this.seq++;
    }
  },
);

function build(doc: Text, data: number[], types: string[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const s of semanticSpans(data, types)) {
    if (s.line >= doc.lines) break;
    const line = doc.line(s.line + 1);
    // Positions are UTF-16 code units, as CodeMirror's offsets.
    const from = line.from + Math.min(s.character, line.length);
    const to = Math.min(from + s.length, line.to);
    if (to > from) b.add(from, to, MARKS[s.kind]);
  }
  return b.finish();
}

const theme = EditorView.baseTheme({
  ".cm-sem-type": { color: "var(--syn-type)" },
  ".cm-sem-fn": { color: "var(--syn-fn)" },
  ".cm-sem-prop": { color: "var(--syn-prop)" },
  ".cm-sem-const": { color: "var(--syn-const)" },
  ".cm-sem-meta": { color: "var(--syn-meta)" },
});

export const semanticTokens: LSPClientExtension = {
  clientCapabilities: {
    textDocument: {
      semanticTokens: {
        requests: { full: true },
        tokenTypes: ["namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property", "enumMember", "event", "function", "method", "macro", "decorator"],
        tokenModifiers: ["declaration", "readonly", "static"],
        formats: ["relative"],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
      },
    },
  },
  editorExtension: [field, plugin, theme],
};
