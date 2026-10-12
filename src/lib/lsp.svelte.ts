// Language-Server im Editor: ein LSPClient (@codemirror/lsp-client) je (Projekt, Server), der Prozess laeuft in
// src-tauri/src/lsp.rs. Modul-Store statt Komponente: Dock baut CodePane bei jedem Tabwechsel neu auf, Server und
// beim Server geoeffnete Dokumente bleiben. didClose erst, wenn der Tab zugeht (closed) oder das Projekt (stop).
import { Channel, invoke } from "@tauri-apps/api/core";
import { tick } from "svelte";
import { ChangeSet, Text, type Extension } from "@codemirror/state";
import { EditorView, keymap, showDialog, type Command } from "@codemirror/view";
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  findReferencesKeymap,
  formatKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  type Transport,
  type WorkspaceFile,
  type WorkspaceMapping,
} from "@codemirror/lsp-client";
import DOMPurify from "dompurify";
import { fs } from "./files.ts";
import { open, peek, setText } from "./editor.svelte.ts";
import { applyEdits, editsOf, fileUri, flatSymbols, serverFor, uriPath, type Edit, type LspPos, type Sym } from "./lsp.logic.ts";

type Out = { t: "msg"; m: string } | { t: "exit"; code: number | null; err: string };
export type LspDiag = { range: { start: LspPos; end: LspPos }; severity?: number; message: string; source?: string };

/**
 * diags: je repo+"\n"+path die zuletzt gemeldeten Befunde samt Text, auf den sie sich beziehen (null = unbekannt).
 * status: je repo+"\n"+server Startfehler/Absturz
 * (bleibt bis "Erneut versuchen"; "" = ausgeblendet, Server bleibt trotzdem aus). gen: zaehlt bei Absturz/Neustart hoch, damit offene Editoren neu anbinden.
 */
export const lsp = $state<{
  diags: Record<string, { doc: Text | null; list: LspDiag[] }>;
  status: Record<string, string>;
  gen: Record<string, number>;
}>({ diags: {}, status: {}, gen: {} });
const k = (repo: string, x: string) => `${repo}\n${x}`;

type File = WorkspaceFile & { path: string; view: EditorView | null; stale: boolean; pending?: Text };

/** Dokumente leben hier, nicht an der View: eine abgebaute View schliesst sie beim Server nicht. */
class StoreWorkspace extends Workspace {
  files: File[] = [];

  constructor(
    client: LSPClient,
    readonly repo: string,
  ) {
    super(client);
  }

  byPath(path: string) {
    return this.files.find((f) => f.path === path) ?? null;
  }

  // Server kodieren URIs teils anders (c%3A): ueber den Pfad vergleichen.
  getFile(uri: string) {
    const p = uriPath(this.repo, uri);
    return p === null ? null : this.byPath(p);
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    const f = this.getFile(uri);
    if (f) {
      f.view = view;
      // Neue View aus einem Snapshot: ihr Plugin kennt nur Aenderungen ab jetzt, darum einmal ganz senden.
      if (!view.state.doc.eq(f.doc)) f.stale = true;
      return;
    }
    const path = uriPath(this.repo, uri);
    if (path === null) return;
    const file: File = {
      uri,
      path,
      languageId,
      version: 0,
      doc: view.state.doc,
      view,
      stale: false,
      getView: () => file.view,
    };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri: string, view: EditorView) {
    const f = this.getFile(uri);
    if (!f || f.view !== view) return;
    f.view = null;
    // Ungesendete Tastendruecke sterben mit dem Plugin: Stand merken und gleich nachreichen.
    if (!view.state.doc.eq(f.doc)) {
      f.pending = view.state.doc;
      f.stale = true;
      queueMicrotask(() => this.client.sync());
    }
  }

  syncFiles() {
    const out = [];
    for (const f of this.files) {
      const plugin = f.view && LSPPlugin.get(f.view);
      let cur: Text;
      let changes: ChangeSet;
      if (f.stale) {
        cur = f.view ? f.view.state.doc : (f.pending ?? f.doc);
        changes = ChangeSet.of({ from: 0, to: f.doc.length, insert: cur }, f.doc.length);
        // Sonst gingen die Aenderungen des Plugins beim naechsten Sync ein zweites Mal raus.
        plugin?.clear();
        f.stale = false;
        f.pending = undefined;
        if (cur.eq(f.doc)) continue;
      } else if (plugin && !plugin.unsyncedChanges.empty) {
        cur = f.view!.state.doc;
        changes = plugin.unsyncedChanges;
        plugin.clear();
      } else continue;
      out.push({ file: f, prevDoc: f.doc, changes });
      f.doc = cur;
      f.version++;
    }
    return out;
  }

  /** Fuer Referenzen in nicht geoeffneten Dateien: von der Platte lesen. */
  async requestFile(uri: string): Promise<WorkspaceFile | null> {
    const f = this.getFile(uri);
    if (f) return f;
    const path = uriPath(this.repo, uri);
    if (path === null) return null;
    try {
      const t = await fs.read(this.repo, path);
      return {
        uri,
        languageId: serverFor(path)?.languageId ?? "",
        version: 0,
        doc: Text.of(t.content.split("\n")),
        getView: () => null,
      };
    } catch {
      return null;
    }
  }

  /** Gehe zu Definition/Referenz in anderer Datei: Tab oeffnen und warten, bis dessen Editor angebunden ist. */
  async displayFile(uri: string): Promise<EditorView | null> {
    const path = uriPath(this.repo, uri);
    if (path === null) return null;
    await open(this.repo, path);
    for (let i = 0; i < 180; i++) {
      const v = this.byPath(path)?.view;
      if (v) return v;
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  }

  close(path: string) {
    const f = this.byPath(path);
    if (!f) return;
    this.files = this.files.filter((x) => x !== f);
    this.client.didClose(f.uri);
  }
}

type Conn = { client: LSPClient; ws: StoreWorkspace; exts: Map<string, Extension> };
const clients = new Map<string, Promise<Conn | null>>();

// lsp-client meldet Pull-Diagnostics an (textDocument.diagnostic), fragt aber nie: rust-analyzer & Co. schicken
// dann keine Diagnostics beim Tippen. Gilt fuer @codemirror/lsp-client 6.3.0, bei Updates pruefen.
const INIT = /^\{"jsonrpc":"2\.0","id":\d+,"method":"initialize",/;

function connect(repo: string, server: string): Promise<Conn | null> {
  const key = k(repo, server);
  const handlers = new Set<(m: string) => void>();
  // Tauri garantiert keine Reihenfolge zwischen einzelnen invokes: didChange muss in Reihenfolge ankommen.
  let q: Promise<unknown> = Promise.resolve();
  const transport: Transport = {
    send(m) {
      if (INIT.test(m)) {
        const msg = JSON.parse(m);
        delete msg.params?.capabilities?.textDocument?.diagnostic;
        m = JSON.stringify(msg);
      }
      q = q.then(() => invoke("lsp_send", { repo, server, msg: m })).catch(() => {});
    },
    subscribe: (h) => void handlers.add(h),
    unsubscribe: (h) => void handlers.delete(h),
  };
  let conn: Conn | null = null;
  const ch = new Channel<Out>();
  const mine = () => clients.get(key) === p;
  const p: Promise<Conn | null> = (async () => {
    ch.onmessage = (o) => {
      if (o.t === "msg") {
        for (const h of handlers) h(o.m);
        return;
      }
      // Exit eines alten Prozesses nach "Erneut versuchen" betrifft den neuen nicht.
      if (!mine()) return;
      clients.delete(key);
      conn?.client.disconnect();
      lsp.status[key] = o.err;
      lsp.gen[key] = (lsp.gen[key] ?? 0) + 1;
      clearDiags(repo, server);
    };
    try {
      await invoke("lsp_start", { repo, server, on: ch });
    } catch (e) {
      lsp.status[key] = String(e);
      return null;
    }
    // Schon beendet (Exit vor der Antwort) oder Projekt geschlossen: keinen Client an einen toten Prozess haengen.
    if (!mine()) return null;
    const client: LSPClient = new LSPClient({
      rootUri: fileUri(repo, ""),
      workspace: (c) => new StoreWorkspace(c, repo),
      // Erste Antworten grosser Server (rust-analyzer beim Indexieren) dauern.
      timeout: 15000,
      // Hover-Markdown landet per innerHTML in der Webview.
      sanitizeHTML: (h) => DOMPurify.sanitize(h),
      notificationHandlers: {
        "textDocument/publishDiagnostics": (_, params): boolean => (setDiags(repo, ws(), params), true),
      },
      extensions: [
        serverCompletion(),
        hoverTooltips(),
        signatureHelp(),
        // Nur wegen des automatischen Syncs nach 500 ms; Diagnostics zeichnet CodePane (lspDiagnostics).
        serverDiagnostics(),
        // F2 selbst: renameKeymap der Bibliothek liesse nicht geoeffnete Dateien still aus.
        keymap.of([
          ...formatKeymap,
          ...jumpToDefinitionKeymap,
          ...findReferencesKeymap,
          { key: "F2", run: renameCmd, preventDefault: true },
        ]),
      ],
    });
    const ws = (): StoreWorkspace => client.workspace as StoreWorkspace;
    conn = { client, ws: ws(), exts: new Map() };
    client.connect(transport);
    return conn;
  })();
  clients.set(key, p);
  return p;
}

function setDiags(
  repo: string,
  ws: StoreWorkspace,
  p: { uri: string; version?: number | null; diagnostics: LspDiag[] },
) {
  const path = uriPath(repo, p.uri);
  if (path === null) return;
  const f = ws.getFile(p.uri);
  // Zu einem aelteren Stand als dem gesendeten: gleich kommt ein neuerer.
  if (p.version != null && f && p.version !== f.version) return;
  if (p.diagnostics.length) lsp.diags[k(repo, path)] = { doc: f?.doc ?? null, list: p.diagnostics };
  else delete lsp.diags[k(repo, path)];
}

function clearDiags(repo: string, server?: string) {
  for (const key of Object.keys(lsp.diags)) {
    const [r, path] = key.split("\n");
    if (r === repo && (!server || serverFor(path)?.server === server)) delete lsp.diags[key];
  }
}

/**
 * Extension fuer den Editor der Datei, oder null (keine Freigabe, kein Server fuer die Endung, Start fehlgeschlagen).
 * Pro Datei dieselbe Extension: ein wiederhergestellter Snapshot enthaelt sie schon, CodePane rekonfiguriert dann nicht.
 */
export async function attach(repo: string, path: string): Promise<Extension | null> {
  const sv = serverFor(path);
  if (!sv || !peek(repo)?.lsp) return null;
  const key = k(repo, sv.server);
  // Nach Absturz/Startfehler kein stiller Neustart: erst "Erneut versuchen".
  if (key in lsp.status) return null;
  const conn = await (clients.get(key) ?? connect(repo, sv.server));
  if (!conn) return null;
  let ext = conn.exts.get(path);
  if (!ext) {
    ext = conn.client.plugin(fileUri(repo, path), sv.languageId);
    conn.exts.set(path, ext);
  }
  return ext;
}

/** Banner "Erneut versuchen": Status weg, offene Editoren binden neu an (startet den Server). */
export function retry(repo: string, server: string) {
  const key = k(repo, server);
  clients.delete(key);
  delete lsp.status[key];
  lsp.gen[key] = (lsp.gen[key] ?? 0) + 1;
}

/** Banner ausblenden; der Server bleibt aus, bis "Erneut versuchen" oder das Projekt neu geoeffnet wird. */
export function dismiss(repo: string, server: string) {
  lsp.status[k(repo, server)] = "";
}

async function connOf(repo: string, path: string): Promise<Conn | null> {
  const sv = serverFor(path);
  return sv ? ((await clients.get(k(repo, sv.server))) ?? null) : null;
}

/**
 * Datei wurde gespeichert oder von der Platte nachgeladen (z. B. nach einem Edit von Claude): Stand senden, didSave.
 * Nach tick(): CodePane spielt neuen Text per Effect ein, erst danach kennt das Plugin die Aenderung.
 */
export async function disk(repo: string, path: string) {
  await tick();
  const conn = await connOf(repo, path);
  const f = conn?.ws.byPath(path);
  if (!conn || !f) return;
  if (!f.view) {
    const text = peek(repo)?.files[path]?.text;
    if (text !== undefined) {
      f.pending = Text.of(text.split("\n"));
      f.stale = true;
    }
  }
  conn.client.sync();
  conn.client.notification("textDocument/didSave", { textDocument: { uri: f.uri } });
}

/** Tab geschlossen bzw. Datei umbenannt/geloescht: beim Server schliessen, Befunde weg. */
export function closed(repo: string, path: string) {
  delete lsp.diags[k(repo, path)];
  void connOf(repo, path).then((c) => {
    c?.ws.close(path);
    c?.exts.delete(path);
  });
}

/** Projekt geschlossen: alle Server des Projekts beenden. Erfuellt, wenn die Prozesse beendet sind. */
export function stop(repo: string): Promise<unknown> {
  const done = [];
  for (const [key, p] of [...clients]) {
    const [r, server] = key.split("\n");
    if (r !== repo) continue;
    clients.delete(key);
    void p.then((c) => c?.client.disconnect());
    done.push(invoke("lsp_stop", { repo, server }).catch(() => {}));
  }
  clearDiags(repo);
  for (const key of Object.keys(lsp.status)) if (key.startsWith(k(repo, ""))) delete lsp.status[key];
  return Promise.all(done);
}

const SEV = ["error", "error", "warning", "info", "hint"] as const;
// Von lspDiagnostics erzeugt: so findet es seine Befunde im Lint-State wieder.
const ours = new WeakSet<Diagnostic>();

/** Befunde der Datei fuer setDiagnostics, auf den aktuellen Text umgerechnet. Liest lsp.diags reaktiv. */
export function lspDiagnostics(repo: string, path: string, view: EditorView): Diagnostic[] {
  const e = lsp.diags[k(repo, path)];
  if (!e) return [];
  const plugin = LSPPlugin.get(view);
  // Seit dem Empfang synchronisiert: syncedDoc passt nicht mehr, die von CodeMirror mitgefuehrten Positionen behalten.
  if (plugin && e.doc && e.doc !== plugin.syncedDoc && !e.doc.eq(plugin.syncedDoc)) {
    const kept: Diagnostic[] = [];
    forEachDiagnostic(view.state, (d, from, to) => void (ours.has(d) && kept.push({ ...d, from, to })));
    for (const d of kept) ours.add(d);
    return kept;
  }
  const len = view.state.doc.length;
  // Positionen beziehen sich auf den zuletzt gesendeten Stand, getippt wurde evtl. schon weiter.
  const at = (p: LspPos) => {
    if (!plugin) return Math.min(off(view.state.doc, p), len);
    return Math.min(plugin.unsyncedChanges.mapPos(off(plugin.syncedDoc, p)), len);
  };
  return e.list.map((d) => {
    const x: Diagnostic = {
      from: at(d.range.start),
      to: Math.max(at(d.range.start), at(d.range.end)),
      severity: SEV[d.severity ?? 1] ?? "error",
      message: d.message,
      source: d.source,
    };
    ours.add(x);
    return x;
  });
}

function off(doc: Text, p: LspPos) {
  if (p.line >= doc.lines) return doc.length;
  const l = doc.line(p.line + 1);
  return Math.min(l.to, l.from + p.character);
}

// ---------- Symbolsuche (QuickOpen @ und #) ----------

export type SymHit = { path: string; name: string; container: string; line: number; col: number };

function hits(repo: string, syms: Sym[], path?: string): SymHit[] {
  return syms.flatMap((s) => {
    const p = s.uri ? uriPath(repo, s.uri) : path;
    return p ? [{ path: p, name: s.name, container: s.container, line: s.at.line + 1, col: s.at.character }] : [];
  });
}

/** Symbole der Datei; nur ueber einen laufenden Server, bei dem sie geoeffnet ist (startet keinen). */
export async function documentSymbols(repo: string, path: string): Promise<SymHit[]> {
  const conn = await connOf(repo, path);
  const f = conn?.ws.byPath(path);
  if (!conn || !f || conn.client.serverCapabilities?.documentSymbolProvider === false) return [];
  conn.client.sync();
  const res = await conn.client.request<unknown, Parameters<typeof flatSymbols>[0]>("textDocument/documentSymbol", {
    textDocument: { uri: f.uri },
  });
  return hits(repo, flatSymbols(res), path);
}

/** Symbole im Projekt ueber alle laufenden Server; Treffer ausserhalb des Projekts fallen weg. */
export async function workspaceSymbols(repo: string, query: string): Promise<SymHit[]> {
  const all = [...clients].filter(([key]) => key.startsWith(k(repo, "")));
  const lists = await Promise.all(
    all.map(async ([, p]) => {
      const c = await p;
      if (!c || c.client.serverCapabilities?.workspaceSymbolProvider === false) return [];
      return c.client
        .request<unknown, Parameters<typeof flatSymbols>[0]>("workspace/symbol", { query })
        .then((r) => hits(repo, flatSymbols(r)), () => []);
    }),
  );
  return lists.flat();
}

// ---------- Umbenennen ueber Dateien (F2) ----------

const renameCmd: Command = (view) => {
  const plugin = LSPPlugin.get(view);
  const word = view.state.wordAt(view.state.selection.main.head);
  const caps = plugin?.client.serverCapabilities;
  if (!plugin || !word || (caps && !caps.renameProvider)) return false;
  const ws = plugin.client.workspace as StoreWorkspace;
  const { close, result } = showDialog(view, {
    label: "Neuer Name",
    input: { name: "name", value: view.state.sliceDoc(word.from, word.to) },
    focus: true,
    submitLabel: "Umbenennen",
    class: "cm-lsp-rename-panel",
  });
  void result.then(async (form) => {
    view.dispatch({ effects: close });
    const name = (form?.elements.namedItem("name") as HTMLInputElement | null)?.value;
    if (!name) return;
    try {
      plugin.client.sync();
      // Mapping ab hier: Syncs bis zur Antwort (autoSync, disk) verschieben sonst die Positionen.
      const n = await plugin.client.withMapping(async (m) => {
        const res = await plugin.client.request<unknown, Parameters<typeof editsOf>[0]>("textDocument/rename", {
          newName: name,
          position: plugin.toPosition(word.from),
          textDocument: { uri: plugin.uri },
        });
        return applyRename(ws, editsOf(res), m);
      });
      showDialog(view, { label: `In ${n} ${n === 1 ? "Datei" : "Dateien"} umbenannt`, top: true });
    } catch (e) {
      plugin.reportError("Umbenennen fehlgeschlagen", e);
    }
  });
  return true;
};

/** Offene Editoren per Transaktion (Undo), Puffer ohne Editor im Store, alles andere direkt auf der Platte. */
async function applyRename(ws: StoreWorkspace, all: Edit[], m: WorkspaceMapping): Promise<number> {
  const repo = ws.repo;
  // Erst pruefen und umrechnen, dann aendern: nie halb umbenennen, nie ausserhalb des Projekts schreiben.
  const items = all
    .filter((e) => e.edits.length)
    .map((e) => {
      const path = uriPath(repo, e.uri);
      if (path === null) throw new Error(`Datei außerhalb des Projekts: ${e.uri}`);
      const f = ws.byPath(path);
      // Nicht beim Server geoeffnet: seine Positionen beziehen sich auf die Platte, nicht auf den Puffer.
      if (!f && peek(repo)?.files[path]?.dirty) throw new Error(`Ungespeicherte Änderungen in ${path}: erst speichern`);
      const view = f?.view && LSPPlugin.get(f.view) ? f.view : null;
      // Server-URI evtl. anders kodiert (c%3A): das Mapping kennt nur die eigene.
      const changes =
        view &&
        e.edits.map((x) => ({
          from: m.mapPosition(f!.uri, x.range.start),
          to: m.mapPosition(f!.uri, x.range.end),
          insert: x.newText,
        }));
      return { ...e, path, view, changes };
    });
  for (const e of items) {
    const path = e.path;
    if (e.view) {
      e.view.dispatch({ changes: e.changes!, userEvent: "rename" });
      continue;
    }
    const buf = peek(repo)?.files[path];
    if (buf) {
      setText(repo, path, applyEdits(buf.text, e.edits));
      // Von aussen ersetzt: ein offener Editor ohne Server-Anbindung zieht so nach.
      buf.rev++;
      void disk(repo, path);
      continue;
    }
    const t = await fs.read(repo, path);
    await fs.write(repo, path, applyEdits(t.content, e.edits), t.crlf, t.bom, t.mtime, false);
  }
  ws.client.sync();
  return items.length;
}
