// Review-Kommentare aus DiffView je Projekt; nur im Speicher, ueberleben Datei-/Tab-Wechsel.
import { reviewPrompt, type ReviewNote } from "./diff.ts";
import { sendToClaude } from "./ide.svelte.ts";

/** repo -> "datei:zeile" -> Kommentar */
export const review = $state<Record<string, Record<string, ReviewNote>>>({});

export const reviewCount = (repo: string) => Object.keys(review[repo] ?? {}).length;

/** In den Prompt, nicht abschicken; Kommentare nur weg, wenn es angekommen ist. */
export async function sendReview(repo: string) {
  // Sofort leeren: Doppelklick sendet nicht doppelt; bei Fehlschlag zurueck, neue Kommentare bleiben vorn.
  const notes = $state.snapshot(review[repo]);
  if (!notes) return;
  delete review[repo];
  if (!(await sendToClaude(repo, reviewPrompt(notes)))) review[repo] = { ...notes, ...review[repo] };
}
