import { expect, mock, test } from 'claude-code/testing'

import { NARRATE, bar, brainHint, guard, level, pace, summarize, withNarrate } from '../hooks/register'

const HOUR = 3_600_000
// Testharness macht /tmp/x unter Windows zu C:\tmp\x
const posix = (p?: string) => p?.replace(/\\/g, '/').replace(/^[a-z]:/i, '')

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
  expect(posix(w.at(-1)?.path)).toBe('/tmp/x/p.json')
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
  on('classic.PermissionRequest', () => ({}) as never)
  on('tool.call', () => ({ result: '' }) as never)
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
  // ask allein (Auto-Modus entscheidet ohne Dialog): kein Warten
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ busy: true, waiting: false })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ busy: false, waiting: true, waitingFor: { tool: 'Bash', summary: 'ls' } })
  await $.turn.complete(done)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ waiting: false, waitingFor: null })
  // Freigabe: Tool laeuft, waitingFor leer
  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm i' } } as never)
  expect(JSON.parse(w.at(-1)!.text).waitingFor).toEqual({ tool: 'Bash', summary: 'npm i' })
  await $.tool.call({ tool: 'Bash', command: 'npm i' } as never)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ busy: true, waiting: false, waitingFor: null })
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
  let reads = 0
  on('fs.read', (_$, e) => {
    if (posix(e.path) === '/tmp/x/p.cmd') reads++
    if (posix(e.path) !== '/tmp/x/p.cmd' || !cmd) throw new Error('fehlt')
    return { value: cmd }
  })
  on('command.run', (_$, e) => (runs.push(`${e.command} ${e.args}`), { text: '' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('env.set', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  let model = 'claude-sonnet-5'
  on('session.model', () => ({ value: model }) as never)
  on('store.get', () => ({ value: true }) as never)
  on('store.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  // Zweiter Start im selben Prozess legt keine zweiten Timer an
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  // Erster Blick ohne Datei, dann zwei Befehle; derselbe nicht doppelt
  await clock.advance(500)
  expect(reads).toBe(1)
  model = 'claude-opus-5-5'
  cmd = JSON.stringify({ at: 1, command: 'model', args: 'opus' })
  await clock.advance(1000)
  // Neues Modell sofort im Panel, nicht erst beim naechsten turn.step (sonst springt die Kopfleiste zurueck)
  expect(JSON.parse(w.at(-1)!.text).model).toBe('claude-opus-5-5')
  cmd = JSON.stringify({ at: 2, command: 'fast', args: '' })
  await clock.advance(500)
  cmd = JSON.stringify({ at: 5, command: 'effort', args: 'high' })
  await clock.advance(500)
  expect(JSON.parse(w.at(-1)!.text).effort).toBe('high')
  expect(runs).toEqual(['model opus', 'fast ', 'effort high'])
  // /mcp nur ins leere Eingabefeld, dann filled fuer die App
  cmd = JSON.stringify({ at: 3, command: 'mcp', args: '' })
  await clock.advance(500)
  expect(fills).toEqual([])
  draft = ''
  cmd = JSON.stringify({ at: 4, command: 'mcp', args: '' })
  await clock.advance(500)
  expect(fills).toEqual(['/mcp'])
  expect(JSON.parse(w.at(-1)!.text).filled).toBe(4)
  expect(runs).toHaveLength(3)
})

test('panel-pfad aus dem store nach reload', async ($, on) => {
  mock.env(on, {})
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('env.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.model', () => ({ value: 'm' }) as never)
  on('store.get', (_$, e) => ({ value: e.key === 'panelFiles' ? { s1: '/tmp/x/p.json', s2: '/tmp/y/q.json' } : true }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(posix(w.at(-1)?.path)).toBe('/tmp/x/p.json')
})

test('panelFiles hoechstens 20 eintraege', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/neu/p.json' })
  const sets: Record<string, string>[] = []
  on('fs.write', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('env.set', () => ({ value: undefined }) as never)
  on('session.id', () => ({ value: 'neu' }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  on('session.model', () => ({ value: 'm' }) as never)
  const old = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`s${i}`, `/tmp/${i}/p.json`]))
  on('store.get', (_$, e) => ({ value: e.key === 'panelFiles' ? old : true }) as never)
  on('store.set', (_$, e) => (e.key === 'panelFiles' && sets.push(e.value as never), { value: undefined }) as never)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  // Aelteste fallen raus, die neue Sitzung bleibt
  expect(Object.keys(sets[0])).toHaveLength(20)
  expect(sets[0].neu).toBe('/tmp/neu/p.json')
  expect(sets[0].s0).toBeUndefined()
})

test('rueckfrage setzt waiting', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/x/p.json' })
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  on('tool.call', () => ({ result: '' }) as never)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Welche?' }] } as never)
  // Nach der Antwort wieder busy
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ busy: true, waiting: false, waitingFor: null })
  expect(w.map(x => JSON.parse(x.text)).some(s => s.waiting && s.waitingFor?.summary === 'Welche?')).toBe(true)
})

test('clean-images meldet fehler', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }) as never)
  on('session.id', () => ({ value: 's1' }) as never)
  on('mcp.call', () => {
    throw new Error('aus')
  })
  const r = await $.command.run({ command: 'clean-images', args: 'alle' })
  expect(r.text).toContain("L'Atelier de Claude nicht erreichbar")
  expect(toasts[0]).toBe(r.text)
})

test('brainHint', () => {
  const t = { recall: false, remember: false, hinted: new Set<string>() }
  expect(brainHint(t, 'Grep', { pattern: 'x' })).toBe('search')
  expect(brainHint(t, 'Agent', { subagent_type: 'Explore' })).toBe('search')
  expect(brainHint(t, 'Agent', { subagent_type: 'Plan' })).toBe(null)
  expect(brainHint(t, 'Bash', { command: 'git add -A && git commit -m x' })).toBe('commit')
  expect(brainHint(t, 'Bash', { command: 'git status' })).toBe(null)
  expect(brainHint(t, 'PowerShell', { command: 'git commit -m x' })).toBe('commit')
  expect(brainHint({ ...t, recall: true, remember: true }, 'Grep', {})).toBe(null)
  expect(brainHint({ ...t, recall: true, remember: true }, 'Bash', { command: 'git commit' })).toBe(null)
})

test('withNarrate', () => {
  type P = { text: string; command?: unknown; context?: readonly string[] }
  const p = (x: P) => withNarrate(x).context
  expect(p({ text: 'mach X' })).toEqual([NARRATE])
  expect(p({ text: 'mach X', context: ['a'] })).toEqual(['a', NARRATE])
  // Slash-Commands bleiben unberuehrt
  expect(p({ text: '/panel', command: { name: 'panel' } })).toBe(undefined)
})

test('summarize', () => {
  expect(summarize('Bash', { command: 'npm   i\n  --save' })).toBe('npm i --save')
  expect(summarize('Read', { file_path: '/src/lib/components/editor/FileTree.svelte' })).toBe('/src/lib/components/editor/FileTree.svelte')
  expect(summarize('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev')
  // Werte erst zur Laufzeit einsetzen: als Literal haelt ein Secret-Scanner (GitGuardian) sie fuer echt.
  const v = 'platzhalter'
  expect(summarize('Bash', { command: `curl -H "Authorization: Bearer ${v}" x` })).toBe('curl -H "Authorization: Bearer ***" x')
  expect(summarize('Bash', { command: `API_KEY=${v} gh --token ghp_${v} sk-${v} xoxb-${v}` })).toBe('API_KEY=*** gh --token *** sk-*** xoxb-***')
  for (const [cmd, out] of [
    [`x --api-key=${v} --password ${v} --verbose`, 'x --api-key=*** --password *** --verbose'],
    [`curl -u bob:${v} https://al:${v}@host/a?token=${v}&b=1`, 'curl -u bob:*** https://al:***@host/a?token=***&b=1'],
    [`curl -H 'Authorization: token ${v}' http://h`, "curl -H 'Authorization: token ***' http://h"],
  ]) expect(summarize('Bash', { command: cmd })).toBe(out)
  expect(summarize('Bash', { command: 'git show 3f2a9c1d4e5b6a7f8091a2b3c4d5e6f7a8b9c0d1' })).toBe('git show ***')
  expect(summarize('Bash', { command: 'x'.repeat(200) })).toHaveLength(120)
  expect(summarize('Agent', {})).toBe('')
})

test('guardrails', () => {
  const A = 'mcp__plugin_open-claude_open-claude__'
  const g = (c: string, cwd?: string) => guard('Bash', { command: c }, cwd)?.why
  expect(guard(`${A}forge_write`, { method: 'delete', path: '/repos/a/b' })?.why).toMatch(/DELETE/)
  expect(guard(`${A}git`, { args: ['push', '--force', 'origin', 'x'] })?.why).toMatch(/Force-Push/)
  expect(g('git push -f origin x')).toMatch(/Force-Push/)
  expect(g('git push --force-with-lease')).toMatch(/Force-Push/)
  expect(g('git reset --hard HEAD~1')).toMatch(/reset --hard/)
  expect(guard(`${A}git`, { args: ['reset', '--hard'] })?.why).toMatch(/reset --hard/)
  expect(g('rm -rf ~/x')).toMatch(/rm -rf/)
  expect(g('cd a && rm -fr /tmp/x', '/repo')).toMatch(/rm -rf/)
  expect(g('rm -rf ../x', '/repo')).toMatch(/rm -rf/)
  expect(g('rm -rf "/etc/x"', '/repo')).toMatch(/rm -rf/)
  expect(g("rm -rf '~/x'")).toMatch(/rm -rf/)
  expect(g('rm -rf "$HOME"')).toMatch(/rm -rf/)
  expect(g('git push origin +main')).toMatch(/Force-Push/)
  expect(g('rm -rf /tmp/claude-501/../../etc', '/repo')).toMatch(/rm -rf/)
  expect(g('rm -rf /tmp/claude-501', '/repo')).toMatch(/rm -rf/)
  // Negativ: Scratchpad von Claude Code
  expect(g('rm -rf /private/tmp/claude-501/-Users-x/abc/scratchpad/binfinal && cp -R a b', '/repo')).toBe(undefined)
  expect(g('rm -rf /tmp/claude-1000/x/scratchpad', '/repo')).toBe(undefined)
  expect(g('rm -rf C:\\Users\\m\\AppData\\Local\\Temp\\claude-m\\x', '/repo')).toBe(undefined)
  // Negativ: normales push, rm im Repo, rm ohne -r
  expect(g('git push origin feature')).toBe(undefined)
  expect(g('git push -u origin feature')).toBe(undefined)
  expect(g('git push origin x && rm -f build.log')).toBe(undefined)
  expect(g('git push origin x; ls -f')).toBe(undefined)
  expect(guard(`${A}git`, { args: ['push', 'origin', 'x'] })).toBe(undefined)
  expect(guard(`${A}forge_write`, { method: 'POST', path: '/x' })).toBe(undefined)
  expect(guard(`${A}forge_write`, { method: 'POST', path: '/repos/a/b/pulls' })?.why).toMatch(/anlegen/)
  expect(guard(`${A}forge_write`, { method: 'POST', path: '/projects/a%2Fb/merge_requests' })?.why).toMatch(/anlegen/)
  expect(guard(`${A}forge_write`, { method: 'PUT', path: '/repos/a/b/pulls/3/merge' })?.why).toMatch(/mergen/)
  expect(guard(`${A}forge_write`, { method: 'PATCH', path: '/repos/a/b/pulls/3', body: { state: 'closed' } })?.why).toMatch(/schließen/)
  expect(guard(`${A}forge_write`, { method: 'PUT', path: '/projects/1/merge_requests/3', body: { state_event: 'close' } })?.why).toMatch(/schließen/)
  expect(guard(`${A}forge_write`, { method: 'POST', path: '/repos/a/b/pulls/3/comments' })).toBe(undefined)
  expect(g('rm -rf build', '/repo')).toBe(undefined)
  expect(g('rm -rf /repo/build', '/repo')).toBe(undefined)
  // Windows: PowerShell/cmd, Laufwerke, Backslash, Git-Bash-Pfade
  const w = (c: string) => guard('PowerShell', { command: c }, 'C:\\repo')?.why
  expect(w('Remove-Item -Recurse -Force C:\\Users\\x')).toMatch(/rm -rf/)
  expect(w('rd /s /q ..\\other')).toMatch(/rm -rf/)
  expect(w('Remove-Item -Recurse -Force build')).toBe(undefined)
  expect(w('Remove-Item -Recurse -Force c:\\repo\\dist')).toBe(undefined)
  expect(w('Remove-Item -Recurse -Force C:\\Repo\\dist')).toBe(undefined)
  expect(w('Remove-Item -Recurse -Force C:\\Repo2\\dist')).toMatch(/rm -rf/)
  expect(w('Remove-Item -Recurse C:\\x')).toBe(undefined)
  expect(g('rm -rf /c/repo/dist', 'C:\\repo')).toBe(undefined)
  expect(g('rm -rf /c/other', 'C:\\repo')).toMatch(/rm -rf/)
  expect(g('rm -f /tmp/x')).toBe(undefined)
})

test('guardrail: ask + banner, normales push frei', async ($, on) => {
  mock.env(on, { OPEN_CLAUDE_PANEL: '/tmp/x/p.json', PWD: '/repo' })
  const w: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => (w.push(e), { value: undefined }))
  on('classic.PermissionRequest', () => ({}) as never)
  on('tool.check', (_$, e) => ({ decision: (e.input as { command: string }).command === 'git reset --hard' ? 'deny' : 'allow' }) as never)
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin x' } } as never)
  expect(r).toMatchObject({ decision: 'ask', reason: expect.stringContaining('Force-Push') })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'git push --force origin x' } } as never)
  expect(JSON.parse(w.at(-1)!.text)).toMatchObject({ waiting: true, waitingFor: { tool: 'Bash', summary: 'git push --force origin x' } })
  w.length = 0
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'git push origin x' } } as never)).toMatchObject({ decision: 'allow' })
  expect(w).toHaveLength(0)
  // deny aus next() bleibt deny
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'git reset --hard' } } as never)).toMatchObject({ decision: 'deny' })
})

test('shell-regel immer, atelier-regel nur mit editor_state', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const ids = async (tools: string[]) => (await $.prompt.compose({ tools, model: 'm', promptModel: 'm', surfaces: [], outputStyle: null, traits: [] })).sections.map(s => s.id)
  expect(await ids(['mcp__plugin_open-claude_open-claude__editor_state'])).toEqual(['open-claude:shell', 'open-claude:atelier'])
  expect(await ids(['Bash'])).toEqual(['open-claude:shell'])
})
