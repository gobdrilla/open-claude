export type Activity = { id: string; tool: string; target: string; state: 'run' | 'ok' | 'err' }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Todo = { content: string; status: string }

export type Panel = {
  startedAt: number
  context: { tokens: number | null; window: number; percent: number | null }
  // autoCompactThreshold - totalTokens; null ohne Auto-Compact
  compactLeft: number | null
  limits: Limit[]
  cost: number | null
  model: string
  effort: string | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  turns: number
  active: Activity[]
  todos: Todo[]
  // Turn laeuft (fuer den Wach-Halt der App, src-tauri/src/awake.rs); waehrend busy alle 30 s neu geschrieben.
  busy: boolean
  // Claude wartet auf den User (Rueckfrage, Rechte-Dialog); Tab-Icon und Dock-Hinweis der App.
  waiting: boolean
  // Zeitstempel (at) des App-Befehls, den die Mod zuletzt ins Eingabefeld gesetzt hat; die App drueckt dann Enter.
  filled: number
}

declare module 'claude-code' {
  interface PluginState {
    'open-claude': { panel: Panel }
  }
}
