// LSP inlay hints (types, parameter names) as muted inline widgets. Registered as an LSPClient extension in
// lsp.svelte.ts: it needs the LSPPlugin of the view and advertises the client capability.
import { untrack } from "svelte";
import { StateEffect, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { prefs } from "$lib/editor.svelte";
import { inlayLabel, inlaySide, type InlayHint } from "$lib/inlay.logic";

/** Ask the server again (workspace/inlayHint/refresh). */
export const refreshInlay = StateEffect.define<null>();
const setHints = StateEffect.define<DecorationSet>();
const DELAY = 400;

class HintWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly pad: string,
  ) {
    super();
  }
  eq(o: HintWidget) {
    return o.text === this.text && o.pad === this.pad;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-inlay-hint" + this.pad;
    s.textContent = this.text;
    return s;
  }
}

const plugin = ViewPlugin.fromClass(
  class {
    deco = Decoration.none;
    timer: ReturnType<typeof setTimeout> | undefined;
    /** Bumped on every change that makes a running request stale. */
    seq = 0;
    stop: () => void;
    constructor(readonly view: EditorView) {
      // The switch in the settings: fetch or clear right away, not only on the next edit.
      this.stop = $effect.root(() => {
        $effect(() => {
          void prefs.inlay;
          untrack(() => this.schedule(0));
        });
      });
    }
    update(u: ViewUpdate) {
      for (const tr of u.transactions)
        for (const e of tr.effects) {
          if (e.is(setHints)) this.deco = e.value;
          else if (e.is(refreshInlay)) this.schedule(0);
        }
      if (u.docChanged) this.deco = this.deco.map(u.changes);
      if (u.docChanged || u.viewportChanged) this.schedule(DELAY);
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
      let hints: InlayHint[] = [];
      if (prefs.inlay) {
        if (!lsp.client.serverCapabilities?.inlayHintProvider) return;
        lsp.client.sync();
        const { from, to } = view.viewport;
        const res = await lsp.client
          .request<unknown, InlayHint[] | null>("textDocument/inlayHint", {
            textDocument: { uri: lsp.uri },
            range: { start: lsp.toPosition(from), end: lsp.toPosition(to) },
          })
          .then((r) => r ?? [], () => null);
        // Error, e.g. ContentModified while indexing: keep the old hints until the next round.
        if (!res) return;
        hints = res;
      }
      if (seq !== this.seq || !view.dom.isConnected || (!hints.length && !this.deco.size)) return;
      const doc = view.state.doc;
      const ranges: Range<Decoration>[] = hints.filter((h) => h.position.line < doc.lines).map((h) => {
        const pad = (h.paddingLeft ? " cm-inlay-pl" : "") + (h.paddingRight ? " cm-inlay-pr" : "");
        const pos = Math.min(lsp.fromPosition(h.position, doc), doc.length);
        return Decoration.widget({ widget: new HintWidget(inlayLabel(h.label), pad), side: inlaySide(h) }).range(pos);
      });
      view.dispatch({ effects: setHints.of(Decoration.set(ranges, true)) });
    }
    destroy() {
      clearTimeout(this.timer);
      this.stop();
    }
  },
  { decorations: (p) => p.deco },
);

const theme = EditorView.baseTheme({
  ".cm-inlay-hint": {
    color: "var(--muted-foreground)",
    backgroundColor: "color-mix(in oklab, var(--muted) 70%, transparent)",
    borderRadius: "3px",
    padding: "0 0.3em",
    fontSize: "0.9em",
    whiteSpace: "pre",
  },
  ".cm-inlay-pl": { marginLeft: "0.4em" },
  ".cm-inlay-pr": { marginRight: "0.4em" },
});

export const inlayHints: LSPClientExtension = {
  clientCapabilities: { textDocument: { inlayHint: {} }, workspace: { inlayHint: { refreshSupport: true } } },
  editorExtension: [plugin, theme],
};
