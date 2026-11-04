// Code Vision like Rider: "3 Verwendungen | 2 Implementierungen" as a muted line above declarations, from the
// server's code lenses (textDocument/codeLens + codeLens/resolve). Registered as an LSPClient extension in
// lsp.svelte.ts. All lenses get a placeholder line right away so resolving them does not move the text; only the
// visible ones are resolved (each one is a project-wide reference search), at most three at a time.
import { untrack } from "svelte";
import { StateEffect, StateField, type EditorState, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { LSPPlugin, type LSPClientExtension } from "@codemirror/lsp-client";
import { prefs } from "$lib/editor.svelte";
import { lensLabel, lensOf, lineLenses, type Lens, type LensKind, type LspRange } from "$lib/nav.logic";
import { showImplementations, showUsages } from "./nav.ts";

/** Ask the server again (workspace/codeLens/refresh). */
export const refreshLens = StateEffect.define<null>();
const setLenses = StateEffect.define<DecorationSet>();

type Raw = { range: LspRange; command?: { title: string; command: string }; data?: unknown };
type Item = { kind: LensKind; label: string; character: number };

const EDIT_DELAY = 800;
const SCROLL_DELAY = 250;
/** Lines beyond the viewport that are resolved too, so a short scroll finds them done. */
const MARGIN = 40;
const PARALLEL = 3;

class LensWidget extends WidgetType {
  constructor(
    readonly items: Item[],
    readonly indent: number,
  ) {
    super();
  }
  eq(o: LensWidget) {
    return o.indent === this.indent && o.items.length === this.items.length && o.items.every((x, i) => x.label === this.items[i].label && x.character === this.items[i].character);
  }
  get estimatedHeight() {
    return 16;
  }
  toDOM(view: EditorView) {
    const dom = document.createElement("div");
    dom.className = "cm-codelens";
    // Block widgets sit outside .cm-line: its left padding (6px in the base theme) plus the indentation.
    dom.style.paddingLeft = `calc(6px + ${this.indent * view.defaultCharacterWidth}px)`;
    // Placeholder: keeps the height until the count arrives.
    if (!this.items.length) dom.textContent = " ";
    this.items.forEach((x, i) => {
      if (i) dom.appendChild(document.createElement("span")).textContent = " | ";
      const s = dom.appendChild(document.createElement("span"));
      s.className = "cm-codelens-item";
      s.textContent = x.label;
      s.title = x.kind === "refs" ? "Verwendungen zeigen" : "Implementierungen zeigen";
      s.onmousedown = (e) => {
        e.preventDefault();
        // The widget sits above its line: read the position now, the doc may have changed since it was drawn.
        const line = view.state.doc.lineAt(view.posAtDOM(dom));
        const pos = Math.min(line.from + x.character, line.to);
        if (x.kind === "refs") showUsages(view, pos);
        else showImplementations(view, pos);
      };
    });
    return dom;
  }
  ignoreEvent() {
    return true;
  }
}

const field = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    for (const e of tr.effects) if (e.is(setLenses)) return e.value;
    return d.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Labels shown per line number now: kept while a new round resolves, so the counts do not blink after an edit. */
function shown(state: EditorState): Map<number, Item[]> {
  const out = new Map<number, Item[]>();
  state.field(field).between(0, state.doc.length, (from, _to, deco) => {
    const w = deco.spec.widget as LensWidget | undefined;
    if (w?.items.length) out.set(state.doc.lineAt(from).number, w.items);
  });
  return out;
}

const indentOf = (text: string, tab: number) => {
  let n = 0;
  for (const c of text) {
    if (c === " ") n++;
    else if (c === "\t") n += tab - (n % tab);
    else break;
  }
  return n;
};

const plugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    seq = 0;
    /** Lenses of the last codeLens answer and the document they refer to. */
    raw: Raw[] = [];
    rawDoc: Text | null = null;
    /** Resolved lens per raw lens of this round. */
    done = new Map<Raw, Raw | null>();
    stop: () => void;
    constructor(readonly view: EditorView) {
      this.stop = $effect.root(() => {
        $effect(() => {
          void prefs.lens;
          untrack(() => this.schedule(0, true));
        });
      });
    }
    update(u: ViewUpdate) {
      for (const tr of u.transactions) for (const e of tr.effects) if (e.is(refreshLens)) this.schedule(0, true);
      if (u.docChanged) this.schedule(EDIT_DELAY, true);
      // Usages in other files change the counts too: count again when coming back (split view, Claude edited).
      else if (u.focusChanged && u.view.hasFocus) this.schedule(SCROLL_DELAY, true);
      else if (u.viewportChanged) this.schedule(SCROLL_DELAY, false);
    }
    schedule(ms: number, again: boolean) {
      this.seq++;
      if (again) this.rawDoc = null;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.fetch(), ms);
    }
    async fetch() {
      const seq = this.seq;
      const view = this.view;
      const lsp = LSPPlugin.get(view);
      if (!lsp) return;
      await lsp.client.initializing;
      const caps = lsp.client.serverCapabilities?.codeLensProvider;
      if (!prefs.lens || !caps) {
        if (view.state.field(field).size) view.dispatch({ effects: setLenses.of(Decoration.none) });
        return;
      }
      if (!this.rawDoc) {
        lsp.client.sync();
        const doc = lsp.syncedDoc;
        const res = await lsp.client.request<unknown, Raw[] | null>("textDocument/codeLens", { textDocument: { uri: lsp.uri } }).catch(() => undefined);
        // Error (ContentModified while indexing): keep what shows until the next round.
        if (seq !== this.seq || res === undefined) return;
        this.raw = res ?? [];
        this.rawDoc = doc;
        this.done = new Map(this.raw.filter((r) => r.command).map((r) => [r, r]));
        this.draw(seq);
      }
      const doc = this.rawDoc!;
      const { from, to } = view.viewport;
      const first = doc.lineAt(Math.min(from, doc.length)).number - 1 - MARGIN;
      const last = doc.lineAt(Math.min(to, doc.length)).number - 1 + MARGIN;
      const todo = this.raw.filter((r) => !this.done.has(r) && r.range.start.line >= first && r.range.start.line <= last);
      for (let i = 0; i < todo.length; i += PARALLEL) {
        const batch = todo.slice(i, i + PARALLEL);
        const out = await Promise.all(batch.map((r) => lsp.client.request<Raw, Raw>("codeLens/resolve", r).catch(() => null)));
        if (seq !== this.seq) return;
        batch.forEach((r, j) => this.done.set(r, out[j]));
        this.draw(seq);
      }
    }
    /** Decorations from the raw lenses: resolved counts, the old label or an empty placeholder for the rest. */
    draw(seq: number) {
      const view = this.view;
      const lsp = LSPPlugin.get(view);
      const raw = this.rawDoc;
      // Typed since the answer: the next round draws (the field maps the old lines meanwhile).
      if (!lsp || !raw || seq !== this.seq || raw !== lsp.syncedDoc) return;
      const doc = view.state.doc;
      const map = (r: Raw) => lsp.unsyncedChanges.mapPos(lsp.fromPosition(r.range.start, raw));
      const lenses: Lens[] = [];
      const pending = new Set<number>();
      for (const r of this.raw) {
        if (r.range.start.line >= raw.lines) continue;
        const line = doc.lineAt(Math.min(map(r), doc.length)).number;
        const res = this.done.get(r);
        const l = res?.command ? lensOf(res.command.title) : null;
        if (l) lenses.push({ line, character: r.range.start.character, ...l });
        // Not resolved yet (null = failed: nothing to wait for).
        else if (res === undefined) pending.add(line);
      }
      const byLine = lineLenses(lenses);
      const old = shown(view.state);
      const tab = view.state.tabSize;
      const out: Range<Decoration>[] = [];
      for (const n of new Set([...byLine.keys(), ...pending])) {
        const line = doc.line(n);
        const found = byLine.get(n);
        const items = found ? found.map((l) => ({ kind: l.kind, label: lensLabel(l), character: l.character })) : (old.get(n) ?? []);
        out.push(Decoration.widget({ widget: new LensWidget(items, indentOf(line.text, tab)), block: true, side: -1 }).range(line.from));
      }
      view.dispatch({ effects: setLenses.of(Decoration.set(out, true)) });
    }
    destroy() {
      clearTimeout(this.timer);
      this.seq++;
      this.stop();
    }
  },
);

const theme = EditorView.baseTheme({
  ".cm-codelens": {
    fontFamily: "var(--font-sans, system-ui)",
    fontSize: "11px",
    lineHeight: "16px",
    height: "16px",
    color: "var(--muted-foreground)",
    opacity: "0.85",
    whiteSpace: "pre",
    overflow: "hidden",
    userSelect: "none",
  },
  ".cm-codelens-item": { cursor: "pointer" },
  ".cm-codelens-item:hover": { color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" },
});

export const codeLens: LSPClientExtension = {
  clientCapabilities: { textDocument: { codeLens: {} }, workspace: { codeLens: { refreshSupport: true } } },
  editorExtension: [field, plugin, theme],
};
