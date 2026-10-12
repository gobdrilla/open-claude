import { expect, mock, test } from 'claude-code/testing'

import { bar, brainHint, level, pace } from '../hooks/register'

const HOUR = 3_600_000

test('bar', () => {
  // 0.62 * 33 = 20.46 Zellen: 20 volle plus Halbzelle
  expect(bar(0.62, 33)).toEqual(['━'.repeat(20) + '╸', '─'.repeat(12)])
  expect(bar(0, 4)).toEqual(['', '────'])
  expect(bar(1.5, 4)).toEqual(['━━━━', ''])
})

test('pace', () => {
  const now = Date.parse('2026-10-08T12:00:00Z')
  // halbes 5h-Fenster vorbei, 38 % verbraucht
  expect(pace(38, new Date(now + 2.5 * HOUR).toISOString(), 5 * HOUR, now)).toBe(76)
  // Fenster beginnt erst: keine Prognose
  expect(pace(10, new Date(now + 5 * HOUR).toISOString(), 5 * HOUR, now)).toBe(undefined)
  expect(pace(10, undefined, 5 * HOUR, now)).toBe(undefined)
})

test('level', () => {
  expect([level(49), level(50), level(80)]).toEqual(['claude', 'warning', 'error'])
})

const PROPS = {
  title: 'Session',
  isFocused: false,
  bodyColumns: 36,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('pane', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2026-10-08T12:00:00Z') }))
  await $.session.measure({
    context: { window: 200000, tokens: 124000, percent: 62 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 21 }],
    changed: ['context', 'rateLimits'],
  })
  const ui = await $.ui.mount({ plugin: 'open-claude', surface: 'terminal', component: 'Pane', props: PROPS, requestId: 'session' })
  expect(await ui.find({ text: /62%/ })).toBeDefined()
  expect(await ui.find({ text: /WOCHE/ })).toBeDefined()
  expect(await ui.find({ text: /─{5}/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"borderStyle":"round"')

  await ui.redraw({ ...PROPS, scroll: { offset: 0, bodyRows: 6 } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('borderStyle')
  expect(await ui.find({ text: /KONTEXT/ })).toBeDefined()

  await ui.redraw({ ...PROPS, bodyColumns: 22 })
  expect(await ui.find({ text: /─{5}/ })).toBe(undefined)
  expect(await ui.find({ text: /WOCHE/ })).toBe(undefined)

  await ui.redraw({ ...PROPS, placement: 'inline' })
  const tree = await ui.drawn()
  expect(tree).toMatchObject({ type: 'Text' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Ctx 62% · 5h 38% · 7d 21%')
})

test('datei fuers app-panel', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/x/p.json' })
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200000, tokens: 50000, percent: 25 } as never,
    rateLimits: [{ kind: 'five_hour', percentUsed: 10 }],
    changed: ['context', 'rateLimits'],
  })
  expect(w.at(-1)?.path).toBe('/tmp/x/p.json')
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ context: { percent: 25 }, limits: [{ percentUsed: 10 }] })
})

test('busy fuer den wach-halt', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/x/p.json' })
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  const busy = () => JSON.parse(w.at(-1)!.text).busy
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { context: {} } }) as never)
  let agents = [{ status: 'running' }]
  on('agent.list', () => ({ value: agents }) as never)
  on('tool.check', () => ({ decision: 'ask' }) as never)
  const done = { turnId: 't1', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false } as const
  await $.turn.start({ text: 'los', turnId: 't1' })
  expect(busy()).toBe(true)
  // Haupt-Turn fertig, Subagent laeuft noch: weiter busy.
  await $.turn.complete(done)
  expect(busy()).toBe(true)
  agents = [{ status: 'completed' }]
  await $.turn.complete(done)
  expect(busy()).toBe(false)
  // Rechte-Dialog: wartet auf den User, Turn-Ende loest das
  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ busy: false, waiting: true })
  await $.turn.complete(done)
  expect(JSON.parse(w.at(-1)!.text).waiting).toBe(false)
})

test('befehle aus der app', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/x/p.json' })
  const clock = mock.clock(on)
  const runs: string[] = []
  let cmd: string | undefined
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  let draft = 'halb'
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: draft, cursor: 0 } }) as never)
  on('prompt.fill', (_$, e) => (fills.push(e.text), { isFilled: true }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('fs.read', (_$, e) => {
    if (e.path !== '/tmp/x/p.cmd' || !cmd) throw new Error('fehlt')
    return { value: cmd }
  })
  on('command.run', (_$, e) => (runs.push(`${e.command} ${e.args}`), { text: '' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('env.set', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }) as never)
  on('store.get', () => ({ value: true }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  // Erster Blick ohne Datei, dann zwei Befehle; derselbe nicht doppelt
  await clock.advance(500)
  cmd = JSON.stringify({ at: 1, command: 'model', args: 'opus' })
  await clock.advance(1000)
  cmd = JSON.stringify({ at: 2, command: 'fast', args: '' })
  await clock.advance(500)
  expect(runs).toEqual(['model opus', 'fast '])
  // /mcp nur ins leere Eingabefeld, dann filled fuer die App
  cmd = JSON.stringify({ at: 3, command: 'mcp', args: '' })
  await clock.advance(500)
  expect(fills).toEqual([])
  draft = ''
  cmd = JSON.stringify({ at: 4, command: 'mcp', args: '' })
  await clock.advance(500)
  expect(fills).toEqual(['/mcp'])
  expect(JSON.parse(w.at(-1)!.text).filled).toBe(4)
  expect(runs).toHaveLength(2)
})

test('brainHint', () => {
  const t = { recall: false, remember: false, hinted: new Set<string>() }
  expect(brainHint(t, 'Grep', { pattern: 'x' })).toBe('search')
  expect(brainHint(t, 'Agent', { subagent_type: 'Explore' })).toBe('search')
  expect(brainHint(t, 'Agent', { subagent_type: 'Plan' })).toBe(null)
  expect(brainHint(t, 'Bash', { command: 'git add -A && git commit -m x' })).toBe('commit')
  expect(brainHint(t, 'Bash', { command: 'git status' })).toBe(null)
  expect(brainHint({ ...t, recall: true, remember: true }, 'Grep', {})).toBe(null)
  expect(brainHint({ ...t, recall: true, remember: true }, 'Bash', { command: 'git commit' })).toBe(null)
})
