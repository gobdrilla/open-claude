// Linked editing as in VS Code (editor.linkedEditing): typing in an opening tag name changes the closing one too.
// The ranges come from the language server (textDocument/linkedEditingRange: HTML, JSX/TSX, Svelte) for the cursor;
// a transaction filter repeats each typed change of one range in the others, in the same transaction (one undo).
import { EditorState, StateEffect, StateField, type ChangeSpec } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import type { LspRange } from "$lib/nav.logic";

type Span = { from: number; to: number };
const set = StateEffect.define<Span[] | null>();
const DELAY = 80;

const field = StateField.define<Span[] | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(set)) return e.value;
    // Ends stick to typed text: a letter added at the end of a tag name belongs to it.
    return v && tr.docChanged ? v.map((s) => ({ from: tr.changes.mapPos(s.from, -1), to: tr.changes.mapPos(s.to, 1) })) : v;
  },
});

const mirror = EditorState.transactionFilter.of((tr) => {
  const spans = tr.startState.field(field, false);
  if (!spans || spans.length < 2 || !tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  // All changes inside one span, or nothing to mirror (paste over the tag, multi-cursor elsewhere).
  let hit = -1;
  let ok = true;
  tr.changes.iterChangedRanges((fromA, toA) => {
    const i = spans.findIndex((s) => fromA >= s.from && toA <= s.to);
    if (i < 0 || (hit >= 0 && i !== hit)) ok = false;
    hit = i;
  });
  if (!ok || hit < 0) return tr;
  const src = spans[hit];
  const text = tr.newDoc.sliceString(tr.changes.mapPos(src.from, -1), tr.changes.mapPos(src.to, 1));
  // A space or bracket ends the tag name (attributes follow): the other tag keeps its name.
  if (/[\s<>/="']/.test(text)) return tr;
  const changes: ChangeSpec[] = spans
    .filter((_, i) => i !== hit)
    .map((s) => ({ from: tr.changes.mapPos(s.from, -1), to: tr.changes.mapPos(s.to, 1), insert: text }));
  return [tr, { changes, sequential: true }];
});

const plugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    seq = 0;
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.selectionSet && !u.docChanged) return;
      const spans = u.state.field(field);
      const head = u.state.selection.main.head;
      // Still typing inside the tag: keep the ranges, asking again mid-word would only lag behind.
      if (spans?.some((s) => head >= s.from && head <= s.to)) return;
      this.seq++;
      clearTimeout(this.timer);
      if (spans) queueMicrotask(() => this.view.dispatch({ effects: set.of(null) }));
      this.timer = setTimeout(() => void this.fetch(), DELAY);
    }
    async fetch() {
      const seq = this.seq;
      const view = this.view;
      const lsp = LSPPlugin.get(view);
      if (!lsp || !lsp.client.serverCapabilities?.linkedEditingRangeProvider) return;
      const sel = view.state.selection.main;
      if (!sel.empty || view.state.selection.ranges.length > 1) return;
      lsp.client.sync();
      const doc = lsp.syncedDoc;
      const res = await lsp.client
        .request<unknown, { ranges: LspRange[] } | null>("textDocument/linkedEditingRange", { textDocument: { uri: lsp.uri }, position: lsp.toPosition(sel.head, doc) })
        .catch(() => null);
      if (seq !== this.seq || doc !== lsp.syncedDoc || view.state.doc !== doc || !res || res.ranges.length < 2) return;
      view.dispatch({ effects: set.of(res.ranges.map((r) => ({ from: lsp.fromPosition(r.start, doc), to: lsp.fromPosition(r.end, doc) }))) });
    }
    destroy() {
      clearTimeout(this.timer);
      this.seq++;
    }
  },
);

export const linkedEditing: LSPClientExtension = {
  clientCapabilities: { textDocument: { linkedEditingRange: {} } },
  editorExtension: [field, mirror, plugin],
};
