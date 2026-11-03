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

/** Rueckfrage innerhalb eines offenen Dialogs: ConfirmBar zeigt sie dort an, statt einen zweiten Dialog zu oeffnen. */
export class Asker {
  q = $state.raw<({ title: string; message: string; action: string; done: (ok: boolean) => void } & Opts) | null>(null);

  /** Gleiche Form wie confirm(). */
  ask = (message: string, action = "Fortfahren", title = "", opts: Opts = {}): Promise<boolean> => {
    this.q?.done(false);
    return new Promise((resolve) => {
      const q = {
        title,
        message,
        action,
        ...opts,
        done: (ok: boolean) => {
          if (this.q === q) this.q = null;
          resolve(ok);
        },
      };
      this.q = q;
    });
  };
}
