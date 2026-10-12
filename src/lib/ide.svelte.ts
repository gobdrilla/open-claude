// Gegenstueck zu src-tauri/src/ide.rs: Claude-Sessions sehen den Editor als IDE.
// Diffs von Claude warten hier auf Annehmen/Ablehnen; Auswahl und @-Erwaehnung gehen an claude.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EditorView } from "codemirror";
import { abs, rel } from "./editor.logic.ts";
import { fileUri } from "./lsp.logic.ts";

export { rel };

export type IdeDiff = { id: number; repo: string; path: string; content: string };
type Open = { repo: string; path: string; line: number | null };

export const ide = $state<{ diffs: IdeDiff[] }>({ diffs: [] });

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

function notify(repo: string, method: string, params: unknown) {
  invoke("ide_notify", { repo, method, params }).catch(() => {});
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

/** Auswahl bzw. Cursor an claude (Kontext "N Zeilen ausgewaehlt"), entprellt wie VS Code. */
export function selectionChanged(repo: string, path: string, view: EditorView) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const r = range(view);
    const filePath = abs(repo, path);
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
  if (r.from === r.to) notify(repo, "at_mentioned", { filePath: abs(repo, path) });
  else mentionLines(repo, path, r.start.line, r.end.line);
}

/** Zeilen start..end (0-basiert) einer Datei als @-Erwaehnung in den Prompt von claude. */
export function mentionLines(repo: string, path: string, start: number, end: number) {
  notify(repo, "at_mentioned", { filePath: abs(repo, path), lineStart: start, lineEnd: end });
}
