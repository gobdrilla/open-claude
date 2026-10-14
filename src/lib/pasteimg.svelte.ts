// Klick auf "[Image #n]" im Terminal; das Aktivitaets-Panel der Session zeigt das Bild und leert req.
// local: selbst gemerkte Einfuegungen je Terminal und n, bis claude sie mit dem Absenden ins Transkript schreibt.
export const pasted = $state<{ req: { id: string; n: number } | null; local: Record<string, Record<number, { url: string; at: number }>> }>({
  req: null,
  local: {},
});
