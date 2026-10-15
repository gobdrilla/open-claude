// Gegenstueck zu src-tauri/src/ide.rs: Claude-Sessions sehen den Editor als IDE.
// Diffs von Claude warten hier auf Annehmen/Ablehnen; Auswahl und @-Erwaehnung gehen an claude.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EditorView } from "codemirror";
import { abs, atRef, pasteFrame, rel } from "./editor.logic.ts";
import { fileUri } from "./lsp.logic.ts";
import { ptyWrite } from "./files.ts";

export { rel, pasteFrame };

export type IdeDiff = { id: number; repo: string; path: string; content: string };
type Open = { repo: string; path: string; line: number | null };

// notice: kurzer Hinweis, warum nichts an claude ging (+page.svelte zeigt ihn, Notice blendet ihn aus).
export const ide = $state<{ diffs: IdeDiff[]; notice: string }>({ diffs: [], notice: "" });

/** Bruecke zu den Sessions in +page.svelte: Terminal-id der Claude-Sitzung eines Projekts. */
export const claudeTarget = { find: (_repo: string): string | undefined => undefined };

/** claude wartet gerade auf eine Freigabe: Getipptes wuerde dort als Antwort landen. */
export async function blocked(id: string): Promise<boolean> {
  const p = await invoke<{ waiting?: boolean } | null>("claude_panel", { id }).catch(() => null);
  return !!p?.waiting;
}

/** Text in den Prompt der Sitzung id einfuegen, ohne abzuschicken; bei busy trotzdem (claude puffert die Eingabe). */
export async function sendTo(id: string, text: string): Promise<boolean> {
  if (await blocked(id)) {
    ide.notice = "Claude wartet auf Freigabe";
    return false;
  }
  return ptyWrite(id, pasteFrame(text)).then(
    () => true,
    (e) => ((ide.notice = String(e)), false),
  );
}

/** Text in den Prompt der Claude-Sitzung dieses Projekts. */
export function sendToClaude(repo: string, text: string): Promise<boolean> {
  const id = claudeTarget.find(repo);
  if (!id) {
    ide.notice = "Keine Claude-Sitzung für dieses Projekt";
    return Promise.resolve(false);
  }
  return sendTo(id, text);
}

/** Einmal beim Start; onopen zeigt eine Datei im Editor (Tool open_file). */
export function listenIde(onopen: (repo: string, path: string, line?: number) => void): Promise<() => void> {
  const offs = [
    listen<IdeDiff>("ide-diff", (e) => ide.diffs.push(e.payload)),
    // claude hat den Diff selbst geschlossen (im Terminal entschieden, Abbruch, neue Runde).
    listen<number[]>("ide-close", (e) => (ide.diffs = ide.diffs.filter((d) => !e.payload.includes(d.id)))),
    listen<Open>("ide-open", (e) => onopen(e.payload.repo, rel(e.payload.repo, e.payload.path), e.payload.line ?? undefined)),
  ];
  return Promise.all(offs).then((fns) => () => fns.forEach((f) => f()));
}

export function decide(d: IdeDiff, accept: boolean) {
  ide.diffs = ide.diffs.filter((x) => x.id !== d.id);
  invoke("ide_reply", { id: d.id, accept, content: accept ? d.content : null }).catch(() => {});
}

/** true = mindestens ein IDE-Client hat es bekommen. */
function notify(repo: string, method: string, params: unknown): Promise<boolean> {
  return invoke<boolean>("ide_notify", { repo, method, params }).catch(() => false);
}

function range(view: EditorView) {
  const doc = view.state.doc;
  const { from, to } = view.state.selection.main;
  const pos = (off: number) => {
    const l = doc.lineAt(off);
    return { line: l.number - 1, character: off - l.from };
  };
  return { from, to, start: pos(from), end: pos(to) };
}

let timer: ReturnType<typeof setTimeout> | undefined;

export type EditorSnap = { active: string | null; files: { path: string; dirty: boolean; conflict: string | null }[] };
type Sel = { path: string; startLine: number; endLine: number; text: string };
const snaps = new Map<string, EditorSnap>();
const sels = new Map<string, Sel>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Editor-Stand fuers Tool editor_state (ide.rs), entprellt; null = Editor geschlossen. Relative Pfade, kein Pufferinhalt. */
export function pushEditor(repo: string, snap: EditorSnap | null) {
  if (snap) snaps.set(repo, snap);
  else snaps.delete(repo);
  // Auswahl gilt nur fuer die aktive Datei, sonst meldet editor_state eine veraltete.
  if (!snap || sels.get(repo)?.path !== snap.active) sels.delete(repo);
  clearTimeout(pushTimers.get(repo));
  pushTimers.set(
    repo,
    setTimeout(() => {
      pushTimers.delete(repo);
      const s = snaps.get(repo);
      const state = s ? { ...s, selection: sels.get(repo) ?? null } : null;
      invoke("ide_editor_state", { repo, state }).catch(() => {});
    }, 300),
  );
}

/** Auswahl bzw. Cursor an claude (Kontext "N Zeilen ausgewaehlt"), entprellt wie VS Code. */
export function selectionChanged(repo: string, path: string, view: EditorView) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const r = range(view);
    const filePath = abs(repo, path);
    // 1-basiert, Text gekappt: Kontext fuer editor_state, nicht der ganze Puffer.
    if (snaps.has(repo)) sels.set(repo, { path, startLine: r.start.line + 1, endLine: r.end.line + 1, text: view.state.sliceDoc(r.from, Math.min(r.to, r.from + 4000)) });
    const snap = snaps.get(repo);
    if (snap) pushEditor(repo, snap);
    notify(repo, "selection_changed", {
      text: view.state.sliceDoc(r.from, r.to),
      filePath,
      fileUrl: fileUri(repo, path),
      selection: { start: r.start, end: r.end, isEmpty: r.from === r.to },
    });
  }, 300);
}

/** Datei (mit Zeilen der Auswahl) als @-Erwaehnung in den Prompt von claude. */
export function mention(repo: string, path: string, view: EditorView) {
  const r = range(view);
  if (r.from !== r.to) return mentionLines(repo, path, r.start.line, r.end.line);
  notify(repo, "at_mentioned", { filePath: abs(repo, path) }).then((ok) => ok || sendToClaude(repo, atRef(path)));
}

/** Zeilen start..end (0-basiert) einer Datei als @-Erwaehnung in den Prompt von claude. */
export function mentionLines(repo: string, path: string, start: number, end: number) {
  notify(repo, "at_mentioned", { filePath: abs(repo, path), lineStart: start, lineEnd: end }).then(
    (ok) => ok || sendToClaude(repo, atRef(path, `#L${start + 1}-${end + 1}`)),
  );
}
