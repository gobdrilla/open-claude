// Expand/shrink selection as in VS Code (Shift+Alt+Right/Left, on the Mac Ctrl+Shift+Cmd+Right/Left) and Rider:
// each step grows to the next enclosing range, shrinking walks the same steps back. The steps come from the
// language server (textDocument/selectionRange: word, string, argument list, statement, block) and from the
// grammar (selectParentSyntax) where it has none or for several cursors.
import { EditorSelection, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { selectParentSyntax } from "@codemirror/commands";
import { LSPPlugin } from "@codemirror/lsp-client";
import type { LspRange } from "$lib/nav.logic";

type SelRange = { range: LspRange; parent?: SelRange };

const push = StateEffect.define<EditorSelection>();
const pop = StateEffect.define<null>();

/** Selections before each expand step; any other selection change or edit forgets them. */
const steps = StateField.define<EditorSelection[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(push)) return [...v, e.value];
      if (e.is(pop)) return v.slice(0, -1);
    }
    return tr.selection || tr.docChanged ? [] : v;
  },
});

/** Smallest range from the server that is larger than the selection, or null. */
async function fromServer(view: EditorView): Promise<{ from: number; to: number } | null> {
  const lsp = LSPPlugin.get(view);
  const sel = view.state.selection;
  if (!lsp || sel.ranges.length > 1) return null;
  await lsp.client.initializing;
  if (!lsp.client.serverCapabilities?.selectionRangeProvider) return null;
  lsp.client.sync();
  const doc = lsp.syncedDoc;
  const { from, to, empty, head } = sel.main;
  const res = await lsp.client
    .request<unknown, SelRange[] | null>("textDocument/selectionRange", {
      textDocument: { uri: lsp.uri },
      // A selected word ends after its last character: ask from inside it.
      positions: [lsp.toPosition(empty ? head : from, doc)],
    })
    .catch(() => null);
  if (doc !== lsp.syncedDoc || view.state.selection !== sel) return null;
  for (let r = res?.[0]; r; r = r.parent) {
    const a = lsp.fromPosition(r.range.start, doc);
    const b = lsp.fromPosition(r.range.end, doc);
    if (a <= from && b >= to && b - a > to - from) return { from: a, to: b };
  }
  return null;
}

/** The grammar's next step, captured instead of dispatched so it can carry the push effect. */
function fromGrammar(view: EditorView): EditorSelection | null {
  let next: EditorSelection | null = null;
  selectParentSyntax({ state: view.state, dispatch: (tr: Transaction) => (next = tr.newSelection) });
  return next;
}

let busy = false;
const expand = (view: EditorView) => {
  if (busy) return true;
  busy = true;
  const before = view.state.selection;
  void fromServer(view)
    .then((r) => {
      // Moved or typed while the server answered: drop the step.
      if (view.state.selection !== before) return;
      const next = r ? EditorSelection.create([EditorSelection.range(r.from, r.to)]) : fromGrammar(view);
      if (next && !next.eq(before)) view.dispatch({ selection: next, effects: push.of(before), scrollIntoView: true, userEvent: "select" });
    })
    .finally(() => (busy = false));
  return true;
};

const shrink = (view: EditorView) => {
  const prev = view.state.field(steps).at(-1);
  if (prev) view.dispatch({ selection: prev, effects: pop.of(null), scrollIntoView: true, userEvent: "select" });
  return true;
};

export const expandSelection = [
  steps,
  keymap.of([
    { key: "Shift-Alt-ArrowRight", mac: "Ctrl-Shift-Mod-ArrowRight", run: expand, preventDefault: true },
    { key: "Shift-Alt-ArrowLeft", mac: "Ctrl-Shift-Mod-ArrowLeft", run: shrink, preventDefault: true },
  ]),
];
