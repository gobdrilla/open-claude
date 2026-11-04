// LSP navigation like Rider: a jump with one result, a pick list at the cursor with several (implementations, type
// definitions, usages from Code Vision), Cmd/Ctrl+click to the definition with an underline while the key is held.
// The pick list is also the quick-fix menu (lsp.svelte.ts). Registered as part of the LSPClient extensions.
import { Prec, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, showDialog, showTooltip, type Command, type DecorationSet } from "@codemirror/view";
import { LSPPlugin, jumpToDefinition, type Workspace, type WorkspaceMapping } from "@codemirror/lsp-client";
import { uriPath } from "$lib/lsp.logic";
import { toLocs, uniqueLocs, type Loc } from "$lib/nav.logic";

export type PickItem = { label: string; detail?: string; run: (view: EditorView) => void };
type Pick = { pos: number; title?: string; items: PickItem[]; sel: number } | null;

const setPick = StateEffect.define<Pick>();
const pickField = StateField.define<Pick>({
  create: () => null,
  update(p, tr) {
    for (const e of tr.effects) if (e.is(setPick)) return e.value;
    return p && (tr.docChanged || tr.selection) ? null : p;
  },
  provide: (f) => showTooltip.from(f, (p) => p && { pos: p.pos, create: (view) => ({ dom: pickDom(view, p) }) }),
});

function pickDom(view: EditorView, p: NonNullable<Pick>) {
  const dom = document.createElement("div");
  dom.className = "cm-pick";
  if (p.title) dom.appendChild(document.createElement("div")).textContent = p.title;
  dom.firstElementChild?.classList.add("cm-pick-title");
  const ul = dom.appendChild(document.createElement("ul"));
  ul.className = "cm-lsp-actions";
  ul.setAttribute("role", "listbox");
  p.items.forEach((a, i) => {
    const li = ul.appendChild(document.createElement("li"));
    li.setAttribute("role", "option");
    li.appendChild(document.createElement("span")).textContent = a.label;
    if (a.detail) {
      const d = li.appendChild(document.createElement("span"));
      d.className = "cm-pick-detail";
      d.textContent = a.detail;
    }
    if (i === p.sel) {
      li.setAttribute("aria-selected", "true");
      requestAnimationFrame(() => li.scrollIntoView({ block: "nearest" }));
    }
    li.onmousedown = (e) => (e.preventDefault(), choose(view, i));
  });
  return dom;
}

function choose(view: EditorView, i: number) {
  const p = view.state.field(pickField, false);
  view.dispatch({ effects: setPick.of(null) });
  p?.items[i]?.run(view);
}

/** List at pos; Up/Down/Enter/Escape while it shows. Closes on typing and cursor moves. */
export function showPick(view: EditorView, pos: number, items: PickItem[], title?: string) {
  view.dispatch({ effects: setPick.of({ pos, items, sel: 0, title }) });
}

const pickKeys = (f: (view: EditorView, p: NonNullable<Pick>) => void): Command => (view) => {
  const p = view.state.field(pickField, false);
  if (!p) return false;
  f(view, p);
  return true;
};
const move = (d: number) => pickKeys((v, p) => v.dispatch({ effects: setPick.of({ ...p, sel: (p.sel + d + p.items.length) % p.items.length }) }));

export const pickList: Extension = [
  pickField,
  Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: move(1) },
      { key: "ArrowUp", run: move(-1) },
      { key: "Enter", run: pickKeys((v, p) => choose(v, p.sel)) },
      { key: "Escape", run: pickKeys((v) => v.dispatch({ effects: setPick.of(null) })) },
    ]),
  ),
];

// ---------- Jumps ----------

const repoOf = (ws: Workspace) => (ws as Workspace & { repo?: string }).repo ?? "";

/** Cursor to loc, in its tab (opened if needed). Without mapping the position is taken as it is. */
export async function goto(view: EditorView, loc: Loc, mapping?: WorkspaceMapping): Promise<void> {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return;
  const target = loc.uri === plugin.uri ? view : await plugin.client.workspace.displayFile(loc.uri);
  if (!target) return;
  const pos = mapping?.getMapping(loc.uri)
    ? mapping.mapPosition(loc.uri, loc.range.start)
    : (LSPPlugin.get(target) ?? plugin).fromPosition(loc.range.start, target.state.doc);
  target.dispatch({ selection: { anchor: Math.min(pos, target.state.doc.length) }, scrollIntoView: true, userEvent: "select.definition" });
  target.focus();
}

/** No result: a note; one: jump; several: pick list with the code line and path:line of each. */
export async function showLocations(view: EditorView, pos: number, locs: Loc[], title: string, none: string, mapping?: WorkspaceMapping) {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return;
  if (!locs.length) return void showDialog(view, { label: none, top: true });
  if (locs.length === 1) return goto(view, locs[0], mapping);
  const ws = plugin.client.workspace;
  const docs = new Map(await Promise.all([...new Set(locs.map((l) => l.uri))].map(async (u) => [u, (await ws.requestFile(u))?.doc] as const)));
  const items = locs.map((l): PickItem => {
    const doc = docs.get(l.uri);
    const n = l.range.start.line;
    const text = doc && n < doc.lines ? doc.line(n + 1).text.trim() : "";
    const path = uriPath(repoOf(ws), l.uri) ?? decodeURIComponent(l.uri.replace(/^file:\/\//, ""));
    return { label: text.length > 110 ? text.slice(0, 110) + "…" : text || path, detail: `${path}:${n + 1}`, run: (v) => void goto(v, l) };
  });
  showPick(view, pos, items, title);
}

type How = { method: string; cap: string; title: (n: number) => string; none: string; params?: Record<string, unknown> };

/** Ask the server for locations of the symbol at pos and show them. false: no server or no such capability. */
export function locate(view: EditorView, how: How, pos = view.state.selection.main.head): boolean {
  const plugin = LSPPlugin.get(view);
  const caps = plugin?.client.serverCapabilities as Record<string, unknown> | null | undefined;
  if (!plugin || (caps && !caps[how.cap])) return false;
  plugin.client.sync();
  void plugin.client
    .withMapping(async (m) => {
      const res = await plugin.client.request<unknown, Parameters<typeof toLocs>[0]>(how.method, {
        textDocument: { uri: plugin.uri },
        position: plugin.toPosition(pos),
        ...how.params,
      });
      const locs = uniqueLocs(toLocs(res));
      await showLocations(view, pos, locs, how.title(locs.length), how.none, m);
    })
    .catch((e) => plugin.reportError(how.none, e));
  return true;
}

export const gotoImplementation: Command = (view) => showImplementations(view, view.state.selection.main.head);

export const gotoTypeDefinition: Command = (view) =>
  locate(view, { method: "textDocument/typeDefinition", cap: "typeDefinitionProvider", title: (n) => `${n} Typdefinitionen`, none: "Kein Typ im Projekt gefunden" });

export const showImplementations = (view: EditorView, pos: number) =>
  locate(view, { method: "textDocument/implementation", cap: "implementationProvider", title: (n) => `${n} Implementierungen`, none: "Keine Implementierung gefunden" }, pos);

export const showUsages = (view: EditorView, pos: number) =>
  locate(
    view,
    { method: "textDocument/references", cap: "referencesProvider", title: (n) => `${n} Verwendungen`, none: "Keine Verwendungen", params: { context: { includeDeclaration: false } } },
    pos,
  );

// ---------- Cmd/Ctrl+click ----------

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const modHeld = (e: MouseEvent | KeyboardEvent) => (MAC ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey;
const canJump = (view: EditorView) => !!LSPPlugin.get(view)?.client.serverCapabilities?.definitionProvider;

const setHint = StateEffect.define<{ from: number; to: number } | null>();
const hintMark = Decoration.mark({ class: "cm-goto-hint" });
const hintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    for (const e of tr.effects) if (e.is(setHint)) d = e.value ? Decoration.set([hintMark.range(e.value.from, e.value.to)] as Range<Decoration>[]) : Decoration.none;
    return tr.docChanged ? Decoration.none : d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Underline the word under the pointer while Cmd/Ctrl is held, like a link. */
const hinter = ViewPlugin.fromClass(
  class {
    x = 0;
    y = 0;
    constructor(readonly view: EditorView) {}
    show(on: boolean) {
      const view = this.view;
      const pos = on && canJump(view) ? view.posAtCoords({ x: this.x, y: this.y }, false) : null;
      const w = pos === null ? null : view.state.wordAt(pos);
      let from = -1;
      let to = -1;
      view.state.field(hintField).between(0, view.state.doc.length, (f, t) => void ((from = f), (to = t)));
      if ((w?.from ?? -1) === from && (w?.to ?? -1) === to) return;
      view.dispatch({ effects: setHint.of(w && { from: w.from, to: w.to }) });
    }
  },
  {
    eventObservers: {
      mousemove(e) {
        this.x = e.clientX;
        this.y = e.clientY;
        this.show(modHeld(e));
      },
      mouseleave() {
        this.show(false);
      },
      keydown(e) {
        if (modHeld(e)) this.show(true);
      },
      keyup() {
        this.show(false);
      },
    },
  },
);

const modClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || !modHeld(e) || !canJump(view)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    if (pos === null || !view.state.wordAt(pos)) return false;
    e.preventDefault();
    view.dispatch({ selection: { anchor: pos }, effects: setHint.of(null) });
    return jumpToDefinition(view);
  },
});

const theme = EditorView.baseTheme({
  ".cm-goto-hint": { textDecoration: "underline", textUnderlineOffset: "2px", cursor: "pointer" },
  ".cm-pick": { maxWidth: "min(44rem, calc(100vw - 2rem))" },
  ".cm-pick-title": { padding: "6px 10px 2px", fontSize: "11px", opacity: "0.7" },
  ".cm-pick .cm-lsp-actions > li": { display: "flex", gap: "12px", justifyContent: "space-between" },
  ".cm-pick .cm-lsp-actions > li > span:first-child": { overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-mono)" },
  ".cm-pick-detail": { opacity: "0.6", flexShrink: "0" },
});

/** Pick list, Cmd/Ctrl+click and the keys: Mod+F12 (VS Code) and Mod+Alt+B (Rider) implementation, Mod+Shift+B type. */
export const lspNav: Extension = [
  pickList,
  hintField,
  hinter,
  modClick,
  // Cmd/Ctrl+click jumps now: extra cursors with Alt+click as in VS Code.
  EditorView.clickAddsSelectionRange.of((e) => e.altKey),
  theme,
  keymap.of([
    { key: "Mod-F12", run: gotoImplementation, preventDefault: true },
    { key: "Mod-Alt-b", run: gotoImplementation, preventDefault: true },
    { key: "Mod-Shift-b", run: gotoTypeDefinition, preventDefault: true },
  ]),
];
