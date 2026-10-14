// Rueckfragen als Promise, ein Dialog (in +page.svelte) fuer alle Aufrufer.
// window.confirm taugt in der Tauri-Webview nicht: es wird asynchron umgeleitet, ohne Dialog-Recht abgelehnt
// und liefert ein Promise, das als "ja" zaehlt.

/** Eintrag einer Liste im Dialog: Name fett, Detail klein darunter. */
export type Item = { name: string; detail: string };
type Opts = { items?: Item[]; tone?: "destructive" | "default" };
type Question = { title: string; message: string; action: string; resolve: (ok: boolean) => void } & Opts;

export const confirming = $state<{ q: Question | null }>({ q: null });

/** true = bestaetigt. Eine neue Frage beantwortet eine noch offene mit nein. */
export function confirm(message: string, action = "Fortfahren", title = "Sicher?", opts: Opts = {}): Promise<boolean> {
  confirming.q?.resolve(false);
  return new Promise((resolve) => (confirming.q = { title, message, action, resolve, ...opts }));
}

export function answer(ok: boolean) {
  const q = confirming.q;
  confirming.q = null;
  q?.resolve(ok);
}
