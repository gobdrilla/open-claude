import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, ToolResultOf } from 'claude-code'

import type { Limit, Panel } from '../types'

const PANE = { id: 'session', title: 'Session', columns: 36 } as const
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const HOUR = 3_600_000
const WINDOWS: Record<string, { label: string; ms: number }> = {
  five_hour: { label: 'SESSION 5h', ms: 5 * HOUR },
  seven_day: { label: 'WOCHE 7d', ms: 7 * 24 * HOUR },
}

const fresh = (startedAt: number): Panel => ({
  startedAt,
  context: { tokens: null, window: 0, percent: null },
  compactLeft: null,
  limits: [],
  cost: null,
  model: '',
  effort: null,
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  turns: 0,
  active: [],
  todos: [],
  busy: false,
  waiting: false,
  waitingFor: null,
  filled: 0,
})
const panel = atom({ plugin: 'open-claude', key: 'panel' } as const, fresh(0))

const pad = (n: number) => String(n).padStart(2, '0')

// Duenne Linie wie die Rahmen der TUI; Halbzelle per ╸. Gefuellt und leer getrennt, weil verschiedene Farben.
export const bar = (frac: number, width: number): [string, string] => {
  const halves = Math.round(Math.min(1, Math.max(0, frac)) * width * 2)
  const fill = '━'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '╸' : '')
  return [fill, '─'.repeat(width - fill.length)]
}

// Prognose in % bei Reset (ungedeckelt, > 100 = zu schnell); undefined, solange das Fenster nicht laeuft.
export const pace = (used: number, resetsAt: string | undefined, ms: number, now: number) => {
  const reset = resetsAt ? Date.parse(resetsAt) : NaN
  const frac = (now - (reset - ms)) / ms
  return Number.isNaN(frac) || frac <= 0 ? undefined : used / frac
}

export const level = (percent: number) => (percent < 50 ? 'claude' : percent < 80 ? 'warning' : 'error')

export const fmtTokens = (n: number) =>
  n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`

export const fmtDuration = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// Innerhalb eines Tages Uhrzeit plus Restzeit, sonst Wochentag.
export const fmtReset = (iso: string | undefined, now: number) => {
  const at = iso ? new Date(iso) : undefined
  if (!at || Number.isNaN(at.getTime())) return undefined
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const left = at.getTime() - now
  return left < 24 * HOUR ? `Reset ${clock} · noch ${fmtDuration(left)}` : `Reset ${DAYS[at.getDay()]} ${clock}`
}

const middle = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.ceil((n - 1) / 2))}…${s.slice(s.length - Math.floor((n - 1) / 2))}`)

const pct = (p: number) => `${Math.round(p)}%`

// Kompakte Zeile fuers Inline-Pane.
export const line = (s: Panel) => {
  const parts: string[] = []
  if (s.context.percent !== null) parts.push(`Ctx ${Math.round(s.context.percent)}%`)
  for (const l of s.limits) if (l.kind in WINDOWS) parts.push(`${l.kind === 'five_hour' ? '5h' : '7d'} ${Math.round(l.percentUsed)}%`)
  if (s.cost) parts.push(`$${s.cost.toFixed(2)}`)
  return parts.length ? parts.join(' · ') : undefined
}

const limitsOf = (limits: readonly Limit[]): Limit[] => limits.map(l => ({ ...l }))

// Arbeitet Claude gerade bzw. wartet auf den User? Nur bei Aenderung schreiben (turn.step kommt oft).
const setBusy = async ($: EngineInterface, busy: boolean, waiting = false, waitingFor: Panel['waitingFor'] = null) => {
  const s = await read($, panel)
  if (s.busy !== busy || s.waiting !== waiting || s.waitingFor?.summary !== waitingFor?.summary || s.waitingFor?.tool !== waitingFor?.tool)
    await put($, s => ({ ...s, busy, waiting, waitingFor }))
}

// Token-artige Teile, bevor der Befehl im Banner/OS-Hinweis landet.
const SECRETS = [
  /\b(sk-|ghp_|xox[a-z]?-)[\w-]+/gi,
  /(Bearer\s+)[\w.~+/=-]+/gi,
  /(Authorization:\s*(?:\w+\s+)?)[^\s'"]+/gi,
  // Env, --flag=wert und ?query=wert; '&' trennt den naechsten Query-Parameter.
  /([\w-]*(?:key|token|secret|passw(?:or)?d)[\w-]*=)[^\s&]+/gi,
  /((?:^|\s)--?[\w-]*(?:key|token|secret|pass(?:word)?)\s+)(?!-)\S+/gi,
  /((?:^|\s)-u\s+[^\s:]+:)\S+/g,
  /(:\/\/[^:/\s@]+:)[^@\s]+(?=@)/g,
  // Base64/Hex ab 20 Zeichen; ohne '/' und nur mit Ziffer, damit Pfade und lange Woerter lesbar bleiben.
  /(?=[A-Za-z0-9+]*\d)[A-Za-z0-9+]{20,}={0,2}/g,
]
// Kurzfassung des wartenden Tool-Calls fuer Banner und Benachrichtigung der App.
export const summarize = (tool: string, input: unknown) => {
  const i = (input ?? {}) as Record<string, unknown>
  const keys = SHELLS.has(tool) ? ['command'] : ['file_path', 'pattern', 'url', 'description']
  const raw = keys.map(k => i[k]).find(v => typeof v === 'string') as string | undefined
  let s = (raw ?? '').replace(/\s+/g, ' ').trim()
  for (const re of SECRETS) s = s.replace(re, (_, pre) => (typeof pre === 'string' ? `${pre}***` : '***'))
  return s.length <= 120 ? s : `${s.slice(0, 119)}…`

}
// Shell-Tools von Claude Code: Bash (auch Git-Bash unter Windows) und das PowerShell-Tool unter Windows.
const SHELLS = new Set(['Bash', 'PowerShell'])
// Laeuft gerade ein Haupt-Turn? Sonst haengt busy nur an laufenden Agents (Heartbeat rechnet nach).
let mainTurn = false
// Haupt-Turn fertig: weiter busy, solange Subagents/Teammates laufen.
const agentsRunning = async ($: EngineInterface) =>
  (await $.agent.list()).some(a => a.status === 'running' || a.status === 'pending')

// App-Panel liest die Datei; ohne Env (claude ausserhalb der App) nur Atom. Pfad wird in session.start
// gemerkt und aus der Env genommen, damit verschachtelte `claude -p` nicht dieselbe Datei ueberschreiben.
// Hot-Reload leert die Modul-Variablen und die Env: der Pfad liegt zusaetzlich im Store, je Sitzungs-ID (Store ist pro Plugin global).
let file: string | undefined
// Timer einmalig; ein Reload bricht die alten ab und setzt auch dieses Flag zurueck
// (Plugin-Doku: Reload startet register in frischer Umgebung, "the previous environment's timers are dropped").
let timers = false
// Writes laufen nacheinander und schreiben den aktuellen Atom-Stand, sonst ueberholt ein aelterer Snapshot.
let chain = Promise.resolve()
// Fehler duerfen weder Tool-Calls noch die Kette kippen.
const put = ($: EngineInterface, f: (s: Panel) => Panel) =>
  update($, panel, f)
    .then(async () => {
      file ??= await $.env.get('OPEN_CLAUDE_PANEL')
      if (file) chain = chain.then(async () => $.fs.write(file!, JSON.stringify(await read($, panel)))).catch(() => {})
      return chain
    })
    .catch(() => {})

// Kopfleiste der App (Modell, Effort, Fast, MCP) legt <panel>.cmd ab; ausfuehren wie getippt, $.command.run wartet bis claude frei ist.
// shortcut: Polling alle 500 ms, $.fs kennt kein Watch; bei spuerbarer Last auf Event umstellen.
// undefined bis zum ersten Blick: ein beim Start schon liegender Befehl wird nicht nachgeholt.
// Brain (MCP-Server "brain", eigene Mod): Regel im Systemprompt, dazu je Turn höchstens ein Hinweis je Art am Tool-Ergebnis.
// Nur aktiv, wenn das Brain in der Sitzung verbunden ist; die Brain-Mod selbst bleibt unberührt.
const BRAIN_RULE =
  'Brain (mcp__brain__*): Vor jeder Code-Suche (Grep, Glob, Explore) erst mcp__brain__recall fragen; Code nur durchsuchen, wenn kein Treffer antwortet. ' +
  'Nach einer Entscheidung, einem Fix mit nicht offensichtlicher Ursache oder einem Fallstrick: mit mcp__brain__remember festhalten (kurz, mit Warum), ' +
  'nichts, was schon im Code oder in der Git-Historie steht. Ist ein Brain-Eintrag veraltet, mit remember korrigieren.'
const BRAIN_HINT = {
  search: 'Brain-Hinweis: In diesem Turn noch kein mcp__brain__recall. Erst das Brain fragen, Code nur durchsuchen, wenn kein Treffer antwortet.',
  commit:
    'Brain-Hinweis: Commit ohne mcp__brain__remember. Steckt darin eine Entscheidung, Regel oder ein Fallstrick, der nicht aus Code oder Git hervorgeht? Dann jetzt mit remember festhalten (kurz, mit Warum). Sonst ignorieren.',
}
// Bei laengerer Arbeit sieht der Nutzer sonst nur Tool-Aufrufe und Fenster: ab und zu kurz, was gerade passiert.
export const NARRATE =
  'Transparenz für den Nutzer: Bei Arbeit mit mehreren Tool-Aufrufen immer mal wieder eine kurze Zeile in den Chat schreiben, was du gerade machst (z. B. „Passe jetzt die Tests an“). Nur den aktuellen Stand nennen, keine Überlegungen, Begründungen oder Abwägungen. Nicht vor jedem Tool-Aufruf, nichts wiederholen. Gilt auch, wenn ein Antwortstil sonst Stille zwischen Tool-Aufrufen verlangt.'

/** Hinweis an normale Eingaben haengen; Slash-Commands laufen ohne. */
export const withNarrate = <T extends { command?: unknown; context?: readonly string[] }>(e: T): T =>
  e.command ? e : { ...e, context: [...(e.context ?? []), NARRATE] }

// Variable Redirect-Ziele und lange ;-Ketten mit rm loesen Claude Codes Sicherheitsabfrage aus, auch im Auto Mode.
const SHELL_RULE =
  'Shell: Dateien mit dem Write-Tool schreiben, nicht per `cat > "$VAR/..."` oder Heredoc. ' +
  'Keine Shell-Variablen in Redirect-Zielen oder `rm`-Pfaden, Pfade ausschreiben. ' +
  'Keine langen `;`-Ketten: Schreiben, Kopieren und Löschen als getrennte Befehle.'

type BrainTurn = { recall: boolean; remember: boolean; hinted: Set<string> }
const brainTurn = (): BrainTurn => ({ recall: false, remember: false, hinted: new Set() })
let brainOn = false

// App-Tools (MCP-Server der App, Plugin-Präfix): Hinweis nur, wenn sie in der Sitzung verbunden sind.
const ATELIER_TOOL = 'mcp__plugin_open-claude_open-claude__'
export const ATELIER_RULE =
  `Atelier-Tools (${ATELIER_TOOL}*): Bei Bezug auf die offene Datei oder Auswahl zuerst editor_state aufrufen. ` +
  'Fundstellen mit open_file im Editor zeigen. ' +
  'GitHub/GitLab per forge_read/forge_write statt gh/curl (Pfad mit führendem /).'
let brain = brainTurn()

// Welcher Brain-Hinweis zu diesem Tool-Aufruf passt, oder null.
export const brainHint = (t: BrainTurn, tool: string, input: Record<string, unknown>): keyof typeof BRAIN_HINT | null => {
  if (tool === 'Grep' || tool === 'Glob' || ((tool === 'Agent' || tool === 'Task') && input.subagent_type === 'Explore')) return t.recall ? null : 'search'
  if (SHELLS.has(tool) && /\bgit\b.*\bcommit\b/.test(String(input.command ?? ''))) return t.remember ? null : 'commit'
  return null
}

let lastCmd: number | undefined
const pollCmd = async ($: EngineInterface) => {
  if (!file) return
  const c = await $.fs
    .read(file.replace(/\.json$/, '.cmd'))
    .then(t => JSON.parse(t) as { at: number; command: string; args: string })
    .catch(() => undefined)
  const first = lastCmd === undefined
  if (!first && (!c || c.at === lastCmd)) return
  lastCmd = c?.at ?? 0
  if (first || !c) return
  // Dialog-Befehle wie /mcp oeffnen per command.run nichts: ins leere Eingabefeld setzen, Enter drueckt die App.
  if (c.command === 'mcp') {
    if ((await $.prompt.read()).text.trim()) return $.ui.toast('Erst die Eingabe leeren, dann MCP')
    const { isFilled } = await $.prompt.fill({ text: `/${c.command}` })
    if (isFilled) await put($, s => ({ ...s, filled: c.at }))
    return
  }
  const ok = await $.command.run({ command: c.command, args: c.args }).then(() => true, () => false)
  // Sonst zeigt die Kopfleiste bis zum naechsten turn.step den alten Stand und springt zurueck.
  // Effort hat keinen Getter: die App bietet nur gueltige Stufen an, also das Argument uebernehmen.
  if (ok && c.command === 'model') {
    const model = await $.session.model()
    await put($, s => ({ ...s, model }))
  } else if (ok && c.command === 'effort') await put($, s => ({ ...s, effort: c.args }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const env = await $.env.get('OPEN_CLAUDE_PANEL')
    const id = await $.session.id().catch(() => '')
    const saved = (await $.store.get('panelFiles').catch(() => undefined)) as Record<string, string> | undefined
    if (env && id) {
      file = env
      // shortcut: /clear vergibt eine neue ID, ein Reload danach findet den Pfad nicht; letzte 20 Sitzungen, Lesen-Aendern-Schreiben ohne Sperre.
      await $.store.set('panelFiles', Object.fromEntries(Object.entries({ ...saved, [id]: env }).slice(-20))).catch(() => {})
    } else file ??= env ?? (id ? saved?.[id] : undefined)
    await $.env.set('OPEN_CLAUDE_PANEL', undefined)
    await $.command.register({ name: 'panel', description: 'Session-Panel ein/aus' })
    await $.command.register({
      name: 'clean-images',
      description: 'Eingefügte Bilder aus Transkripten entfernen (Platz frei)',
      argumentHint: '[alle|1d|7d] [hier]',
    })
    const done = await next(e)
    const [usage, model] = await Promise.all([$.session.usage(), $.session.model()])
    await put($, s => ({
      ...(s.startedAt === usage.startedAt ? s : fresh(usage.startedAt)),
      // App ordnet das Aktivitaets-Panel per SID zu (mehrere Sitzungen im selben Projekt)
      sid: id,
      context: { tokens: usage.context.tokens ?? null, window: usage.context.window, percent: usage.context.percent ?? null },
      limits: limitsOf(usage.rateLimits),
      cost: usage.cost?.usd ?? null,
      model,
    }))
    // Countdowns und Dauer laufen ohne neue Daten weiter. Heartbeat: busy gilt in der App nur bei frischer Datei.
    if (!timers) {
      timers = true
      $.clock.every(500, () => pollCmd($))
      $.clock.every(30_000, async () => {
        $.ui.invalidate('ui.render')
        if (!(await read($, panel)).busy) return
        // Ohne Haupt-Turn nur so lange busy, wie noch Agents laufen; sonst bliebe es bis zum naechsten Turn haengen.
        const busy = mainTurn || (await agentsRunning($).catch(() => false))
        await put($, s => ({ ...s, busy }))
      })
    }
    if (!(await $.store.get('themeHint'))) {
      $.ui.toast('Tipp: /theme → Atelier (Hell/Dunkel, folgt der App)')
      await $.store.set('themeHint', true)
    }
    return done
  })

  on('command.run', { command: 'panel' }, async $ => {
    if ((await $.ui.panes()).some(p => p.id === PANE.id)) {
      await $.ui.close({ id: PANE.id })
      return { text: 'Session-Panel geschlossen.' }
    }
    await $.ui.open(PANE)
    return { text: 'Session-Panel geöffnet.' }
  })

  // Die App raeumt auf (MCP-Tool clean_images); "hier" braucht die eigene Sitzungs-ID.
  on('command.run', { command: 'clean-images' }, async ($, e) => {
    const r = await $.mcp
      .call('plugin:open-claude:open-claude', 'clean_images', { args: e.args, session: await $.session.id() })
      .catch((err: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `L'Atelier de Claude nicht erreichbar: ${err}` }] }))
    const text = r.content.map(c => (c.type === 'text' ? c.text : '')).join('')
    $.ui.toast(text)
    return { text }
  })

  on('session.measure', async ($, e, next) => {
    await put($, s => ({
      ...s,
      context: { tokens: e.context.tokens ?? null, window: e.context.window, percent: e.context.percent ?? null },
      limits: limitsOf(e.rateLimits),
      cost: e.cost?.usd ?? s.cost,
    }))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    mainTurn = false
    await setBusy($, false)
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await put($, s => ({ ...fresh(now), limits: s.limits, model: s.model, effort: s.effort }))
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    mainTurn = true
    brain = brainTurn()
    await setBusy($, true)
    return next(e)
  })

  // Rechte-Dialog: Claude wartet auf den User. Nicht schon bei tool.check 'ask': das entscheidet im Auto-Modus der Classifier ohne Dialog.
  on('classic.PermissionRequest', async ($, e, next) => {
    await setBusy($, false, true, { tool: e.tool_name, summary: summarize(e.tool_name, e.tool_input) })
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    await setBusy($, false, true, { tool: 'Rückfrage', summary: e.questions?.[0]?.question ?? '' })
    const ran = await next(e)
    await setBusy($, true)
    return ran
  })

  on('turn.step', async function* ($, e, next) {
    const effort = e.effort === undefined ? null : String(e.effort)
    if (!e.agentId) await setBusy($, true)
    if (!e.agentId) {
      const s = await read($, panel)
      if (s.model !== e.model || s.effort !== effort) await put($, s => ({ ...s, model: e.model, effort }))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    const summary = e.agentId ? undefined : (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    const end = e.reason === 'answer' ? ('ok' as const) : ('err' as const)
    if (!e.agentId) mainTurn = false
    const busy = mainTurn ? undefined : await agentsRunning($).catch(() => false)
    await put($, s => ({
      ...s,
      busy: busy ?? s.busy,
      waiting: e.agentId ? s.waiting : false,
      waitingFor: e.agentId ? s.waitingFor : null,
      turns: s.turns + (e.agentId ? 0 : 1),
      // Abgebrochene Tool-Calls kommen nie aus 'run' zurueck; Turn-Ende raeumt sie auf.
      active: e.agentId ? s.active : s.active.map(a => (a.state === 'run' ? { ...a, state: end } : a)),
      tokens: u
        ? {
            input: s.tokens.input + u.input_tokens,
            output: s.tokens.output + u.output_tokens,
            cacheRead: s.tokens.cacheRead + u.cache_read_input_tokens,
            cacheWrite: s.tokens.cacheWrite + u.cache_creation_input_tokens,
          }
        : s.tokens,
      compactLeft: !summary
        ? s.compactLeft
        : summary.isAutoCompactEnabled && summary.autoCompactThreshold !== undefined
          ? summary.autoCompactThreshold - summary.totalTokens
          : null,
    }))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const target = [input.file_path, input.pattern, input.command, input.description].find(v => typeof v === 'string')
    const id = e.tool_use_id ?? String(await $.clock.now())
    const entry = { id, tool: String(e.tool), target: typeof target === 'string' ? target : '', state: 'run' as const }
    // Tool laeuft = Rechte-Dialog beantwortet; AskUserQuestion wartet selbst.
    if (e.tool !== 'AskUserQuestion' && (await read($, panel)).waiting) await setBusy($, true)
    await put($, s => ({ ...s, active: [...s.active, entry].slice(-4) }))
    const ran = await next(e)
    const state = ran.isError || 'deny' in ran ? ('err' as const) : ('ok' as const)
    await put($, s => ({ ...s, active: s.active.map(a => (a.id === id ? { ...a, state } : a)) }))
    return ran
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    brainOn = e.tools.includes('mcp__brain__recall')
    const sections = [...r.sections]
    sections.push({ id: 'open-claude:shell', text: SHELL_RULE, scope: 'session' as const })
    if (brainOn) sections.push({ id: 'open-claude:brain', text: BRAIN_RULE, scope: 'session' as const })
    if (e.tools.includes(`${ATELIER_TOOL}editor_state`)) sections.push({ id: 'open-claude:atelier', text: ATELIER_RULE, scope: 'session' as const })
    return { sections }
  })

  on('tool.call', { tool: /^mcp__brain__/ }, async ($, e, next) => {
    const ran = await next(e)
    if (!ran.isError && !('deny' in ran && ran.deny)) {
      if (e.tool === 'mcp__brain__remember') brain.remember = true
      else brain.recall = true
    }
    return ran
  })

  on('prompt.submit', ($, e, next) => next(withNarrate(e)))

  on('tool.call', { tool: /^(Grep|Glob|Agent|Task|Bash|PowerShell)$/ }, async ($, e, next) => {
    const ran = await next(e)
    const hint = brainOn ? brainHint(brain, String(e.tool), e as unknown as Record<string, unknown>) : null
    if (!hint || brain.hinted.has(hint) || ran.isError || 'deny' in ran) return ran
    brain.hinted.add(hint)
    return { ...ran, context: [...(ran.context ?? []), BRAIN_HINT[hint]] }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const todos = (ran.result as ToolResultOf<'TodoWrite'> | undefined)?.newTodos
    if (todos) await put($, s => ({ ...s, todos: todos.map(t => ({ content: t.content, status: t.status })) }))
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: 'session' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, panel)
    const now = await $.clock.now()
    const { bodyColumns: cols, placement, scroll } = e.props

    if (placement === 'inline') return <Text color="inactive">{line(s) ?? 'Noch keine Daten'}</Text>

    // Rahmen und paddingX je 2 Spalten.
    // ponytail: Flachmodus 2 Spalten schmaler als noetig, eigene Breite falls es stoert
    const width = Math.max(1, cols - 4)
    const gauge = (label: string, p: number, extra: (string | undefined)[], fast?: boolean) => {
      const [fill, rest] = bar(p / 100, width)
      const rows = extra.filter((x): x is string => !!x)
      return {
        rows: 1 + (cols >= 28 ? 1 : 0) + rows.length + (fast === undefined ? 0 : 1),
        el: (
          <Box flexDirection="column">
            <Box justifyContent="space-between">
              <Text color="inactive">{label}</Text>
              <Text color={level(p)}>{pct(p)}</Text>
            </Box>
            {cols >= 28 && (
              <Text>
                <Text color={level(p)}>{fill}</Text>
                <Text color="subtle">{rest}</Text>
              </Text>
            )}
            {rows.map(r => (
              <Text color="inactive" wrap="truncate-end">{r}</Text>
            ))}
          </Box>
        ),
      }
    }

    const sections: { rows: number; el: RenderElement; optional?: true }[] = []
    if (s.context.window > 0) {
      const tokens = s.context.tokens === null ? '' : `${fmtTokens(s.context.tokens)} / ${fmtTokens(s.context.window)}`
      const compact = s.compactLeft === null ? '' : `Compact in ${fmtTokens(Math.max(0, s.compactLeft))}`
      const p = s.context.percent ?? ((s.context.tokens ?? 0) / s.context.window) * 100
      sections.push(gauge('KONTEXT', p, [[tokens, compact].filter(Boolean).join(' · ')]))
    }
    for (const kind of cols < 24 ? ['five_hour'] : ['five_hour', 'seven_day']) {
      const l = s.limits.find(l => l.kind === kind)
      const w = WINDOWS[kind]
      if (!l || !w) continue
      const g = gauge(w.label, l.percentUsed, [fmtReset(l.resetsAt, now)])
      const forecast = kind === 'five_hour' ? pace(l.percentUsed, l.resetsAt, w.ms, now) : undefined
      if (forecast !== undefined) {
        const fast = forecast > 100
        g.rows++
        g.el = (
          <Box flexDirection="column">
            {g.el}
            <Text wrap="truncate-end">
              <Text color={fast ? 'warning' : 'inactive'}>{fast ? '◆' : '◇'}</Text>
              <Text color="inactive">
                {fast ? ` zu schnell → 100% vor Reset` : ` im Plan → ~${Math.round(forecast)}% bei Reset`}
              </Text>
            </Text>
          </Box>
        )
      }
      sections.push(g)
    }

    if (cols >= 24) {
      const t = s.tokens
      const seen = t.input + t.cacheRead + t.cacheWrite
      const hours = (now - s.startedAt) / HOUR
      const details: [string, string | undefined][] = [
        ['Modell', s.model && [s.model.replace(/^claude-/, ''), s.effort].filter(Boolean).join(' · ')],
        // Im Abo bleibt cost 0, dann sagt die Zeile nichts.
        ['Kosten', !s.cost ? undefined : `$${s.cost.toFixed(2)}${hours > 0.05 ? ` · $${(s.cost / hours).toFixed(2)}/h` : ''}`],
        ['Tokens', seen || t.output ? `${fmtTokens(seen)} in · ${fmtTokens(t.output)} out` : undefined],
        ['Cache', seen ? `${Math.round((t.cacheRead / seen) * 100)}% Hit` : undefined],
        ['Dauer', s.startedAt ? `${fmtDuration(now - s.startedAt)} · ${s.turns} Turns` : undefined],
      ]
      const shown = details.filter((d): d is [string, string] => !!d[1])
      if (shown.length) sections.push({
        rows: shown.length,
        optional: true,
        el: (
          <Box flexDirection="column">
            {shown.map(([k, v]) => (
              <Text wrap="truncate-end">
                <Text color="inactive">{k.padEnd(12)}</Text>
                {v}
              </Text>
            ))}
          </Box>
        ),
      })

      if (s.active.length) {
        const icon = { run: ['●', 'claude'], ok: ['✓', 'success'], err: ['✗', 'error'] } as const
        sections.push({
          rows: 1 + s.active.length,
          optional: true,
          el: (
            <Box flexDirection="column">
                <Text color="inactive">AKTIV</Text>
              {s.active.map(a => (
                <Text wrap="truncate-end">
                  <Text color={icon[a.state][1]}>{icon[a.state][0]}</Text> {a.tool.padEnd(6)} {middle(a.target, Math.max(4, width - 9))}
                </Text>
              ))}
            </Box>
          ),
        })
      }

      if (s.todos.length) {
        const mark = { completed: ['✓', 'success'], in_progress: ['▸', 'claude'] } as Record<string, [string, string]>
        sections.push({
          rows: 1 + s.todos.length,
          optional: true,
          el: (
            <Box flexDirection="column">
              <Box justifyContent="space-between">
                <Text color="inactive">TODOS</Text>
                <Text color="inactive">
                  {s.todos.filter(t => t.status === 'completed').length}/{s.todos.length}
                </Text>
              </Box>
              {s.todos.map(t => (
                <Text wrap="truncate-end">
                  <Text color={(mark[t.status] ?? ['○', 'inactive'])[1]}>{(mark[t.status] ?? ['○'])[0]}</Text> {t.content}
                </Text>
              ))}
            </Box>
          ),
        })
      }
    }

    // Runde Karten, solange alles passt; sonst flach mit Leerzeilen. Optionale Sektionen fallen erst,
    // wenn auch flach nicht mehr passt (von unten: Todos, Aktiv, Details).
    const flatH = () => sections.reduce((n, x, i) => n + x.rows + (i ? 1 : 0), 0)
    const cardH = () => sections.reduce((n, x) => n + x.rows + 2, 0)
    while (sections.at(-1)?.optional && cardH() > scroll.bodyRows && flatH() > scroll.bodyRows) sections.pop()

    if (!sections.length) return <Text color="inactive">Noch keine Daten</Text>
    return cardH() <= scroll.bodyRows ? (
      <Box flexDirection="column">
        {sections.map(x => (
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            {x.el}
          </Box>
        ))}
      </Box>
    ) : (
      <Box flexDirection="column" paddingX={1}>
        {sections.map((x, i) => (i ? <Box marginTop={1}>{x.el}</Box> : x.el))}
      </Box>
    )
  })
}
