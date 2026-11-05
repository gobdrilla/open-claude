// Which file's local history is shown (HistoryDialog in EditorView); set from the tree's context menu or the editor menu.
export const localHistory = $state<{ open: { repo: string; path: string } | null }>({ open: null });

export const showHistory = (repo: string, path: string) => (localHistory.open = { repo, path });
