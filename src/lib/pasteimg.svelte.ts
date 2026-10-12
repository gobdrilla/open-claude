// Klick auf "[Image #n]" im Terminal; das Aktivitaets-Panel der Session zeigt das Bild und leert req.
export const pasted = $state<{ req: { id: string; n: number } | null }>({ req: null });
