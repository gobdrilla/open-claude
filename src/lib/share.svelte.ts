// Geteilte Sitzungen (Host) je Terminal-id: Einladung, verbundene Gaeste, ob sie tippen duerfen.
export const shares = $state<Record<string, { ticket: string; guests: number; write: boolean }>>({});
