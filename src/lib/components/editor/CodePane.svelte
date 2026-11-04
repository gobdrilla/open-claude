<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView } from "codemirror";
  import { basicSetup } from "./setup";
  import { expandSelection } from "./expandSel";
  import { EditorState, Transaction } from "@codemirror/state";
  import { keymap } from "@codemirror/view";
  import { indentWithTab, isolateHistory } from "@codemirror/commands";
  import { lintGutter, setDiagnostics } from "@codemirror/lint";
  import { Button, DiffDialog, Empty } from "$lib/atelier-ui";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { allowLsp, cursorAt, diff, edited, editor, flush, keep, navigate, peek, gitHook, prefs, reload, save, snapKey, snapshots, togglePanel, toggleWrap } from "$lib/editor.svelte";
  import { detectIndent, gutterMarks, huge, span } from "$lib/editor.logic";
  import { gitGutter, indentFolding, indentGuides, indentOf, lang, language, lspExt, setGitMarks, setRunMarks, setTestMarks, testGutter, theme, wrap } from "./cm";
  import { allConfigs, detect, run, runStart } from "$lib/run.svelte";
  import { runLines } from "$lib/run.logic";
  import { ghost } from "./ghost";
  import { wordHighlight } from "./wordHighlight";
  import { bracketColors } from "./bracketColors";
  import { gotoLineKey } from "./gotoline";
  import { findPanel } from "./findpanel";
  import { lens } from "./lens";
  import { ruler } from "./ruler";
  import { stickyScroll } from "./sticky";
  import { inlineBlame, syncBlame } from "./blame";
  import { peek as peekTests, testRun } from "$lib/testing.svelte";
  import { fails, marks } from "$lib/testing.logic";
  import { mention, selectionChanged } from "$lib/ide.svelte";
  import { attach, dismiss, lsp, lspDiagnostics, retry } from "$lib/lsp.svelte";
  import { serverFor } from "$lib/lsp.logic";
  import { fs } from "$lib/files";
  import { parseDiff, type DiffFile, type Hunk } from "$lib/diff";
  import { revertHunk } from "$lib/revert.logic";
  import type { HunkAction } from "$lib/components/git/DiffView.svelte";

  // path bleibt fuer die Lebensdauer der Instanz gleich (Dock mountet je Panel-ID neu).
  let { repo, path }: { repo: string; path: string } = $props();

  const s = $derived(editor(repo));
  const f = $derived(s.files[path]);

  let host = $state<HTMLDivElement>();
  /** Diff fuer "Vergleichen"; null = Dialog zu. */
  let compare = $state<string | null>(null);
  /** Buffer vs HEAD with context, after a click on a git gutter mark; null = dialog closed. */
  let head = $state<string | null>(null);
  /** The diff no longer matched the buffer when reverting; it was reloaded. */
  let stale = $state(false);
  /** reverted: refresh the open dialog, close it when nothing is left. */
  const loadHead = (reverted: boolean) =>
    view &&
    fs.gutter(repo, path, view.state.doc.toString(), true).then(
      (d) => {
        // Closed meanwhile: do not reopen.
        if (reverted && head === null) return;
        head = reverted && !d ? null : d;
      },
      (e) => (s.error = String(e)),
    );
  const showHead = () => ((stale = false), loadHead(false));
  // Into the buffer as one undoable change, not saved; only when the hunk still matches the buffer.
  const revert = (_: DiffFile, hunk: Hunk, sel: Set<number>) => {
    if (!view) return;
    const c = revertHunk(view.state.doc.toString(), hunk, sel);
    stale = !c;
    if (c) view.dispatch({ changes: c, annotations: isolateHistory.of("full") });
    void loadHead(true);
  };
  const revertActions: HunkAction[] = [{ label: "Zurücksetzen", lineLabel: "Zeilen zurücksetzen", run: revert }];

  const openCommit = (sha: string) => gitHook.showCommit(repo, sha);

  // Die Callbacks greifen nur auf den Store zu, nie auf die Komponente: der EditorState ueberlebt sie.
  const fresh = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        keymap.of([
          { key: "Mod-s", run: () => (void save(repo, path), true) },
          { key: "Alt-z", run: () => (toggleWrap(), true) },
          // Wie in VS Code: Datei/Auswahl als @-Erwaehnung an Claude.
          { key: "Mod-Alt-k", run: (v) => (mention(repo, path, v), true) },
          // Statt des Lint-Panels von basicSetup: Problems-Panel des Projekts.
          { key: "Mod-Shift-m", run: () => (togglePanel(repo, "problems"), true) },
          // Zurueck/Vor wie in VS Code. Strg+- ist unter Windows/Linux Zoom (Capture in +page), dort zaehlt Alt+Pfeil
          // (ersetzt cursorSyntaxLeft/Right); auf dem Mac ist Alt+Pfeil Wortsprung, darum Cmd+Alt+Pfeil.
          { key: "Ctrl--", run: () => navigate(repo, false) },
          { key: "Ctrl-Shift--", run: () => navigate(repo, true) },
          { key: "Alt-ArrowLeft", mac: "Mod-Alt-ArrowLeft", run: () => navigate(repo, false) },
          { key: "Alt-ArrowRight", mac: "Mod-Alt-ArrowRight", run: () => navigate(repo, true) },
          indentWithTab,
        ]),
        gotoLineKey,
        expandSelection,
        basicSetup,
        findPanel,
        theme,
        indentOf(detectIndent(doc)),
        indentGuides,
        indentFolding,
        wordHighlight,
        bracketColors,
        lang.of([]),
        lspExt.of([]),
        lintGutter(),
        lens,
        ruler,
        wrap.of(prefs.wrap ? EditorView.lineWrapping : []),
        testGutter(
          (id) => void testRun(repo, id),
          (label) => {
            const c = allConfigs(repo).find((c) => c.label === label);
            if (c) void runStart(repo, c);
          },
        ),
        // The state outlives this component (snapshots): reach the current one through a DOM event.
        gitGutter((v) => v.dom.dispatchEvent(new CustomEvent("gitdiff", { bubbles: true }))),
        ghost(path, () => prefs.ai),
        stickyScroll,
        inlineBlame(prefs.blame, repo, path, openCommit),
        EditorView.updateListener.of(
          (u) =>
            u.docChanged &&
            edited(repo, path, () => u.view.state.doc.toString(), u.transactions.some((t) => t.docChanged && !t.annotation(Transaction.remote))),
        ),
        EditorView.updateListener.of((u) => {
          if (!u.selectionSet && !(u.focusChanged && u.view.hasFocus)) return;
          selectionChanged(repo, path, u.view);
          const head = u.state.selection.main.head;
          const l = u.state.doc.lineAt(head);
          cursorAt(repo, path, l.number, head - l.from);
        }),
      ],
    });

  /** Zustand, dessen Dokument `text` ist. Nur die geaenderte Mitte wird ersetzt, als eigener Undo-Schritt. */
  const sync = (state: EditorState, text: string) => {
    const old = state.doc.toString();
    // remote: reloaded from disk, not typed (a preview tab stays one).
    return old === text ? null : state.update({ changes: span(old, text), annotations: [isolateHistory.of("full"), Transaction.remote.of(true)] });
  };

  // f wird beim Nachladen als Ganzes ersetzt: der Aufbau haengt nur daran, ob die Datei geladen ist.
  const ready = $derived(!!f);
  let view = $state.raw<EditorView>();
  /** Ohne Grammatik geoeffnet, weil die Datei zu gross ist. */
  let plain = $state(false);

  // Editor aufbauen, sobald die Datei geladen ist. Beim Abbau wandern Zustand (samt Undo) und Scrollposition in den Store.
  $effect(() => {
    if (!ready || !host) return;
    const parent = host;
    const key = snapKey(repo, path);
    const snap = untrack(() => snapshots.get(key));
    const v = untrack(() => {
      const state = snap?.state ?? fresh(f!.text);
      // Waehrend das Panel abgebaut war, kann die Datei nachgeladen worden sein.
      return new EditorView({ parent, state: sync(state, f!.text)?.state ?? state, scrollTo: snap?.scroll });
    });
    // Svelte removes the DOM before the teardown below runs, where scrollTop already reads 0: keep it while scrolling.
    let scroll = snap?.scroll;
    const keepScroll = () => (scroll = v.scrollSnapshot());
    v.scrollDOM.addEventListener("scroll", keepScroll, { passive: true });
    view = v;
    // Fokus nur fuer die aktive Datei, und nie aus Eingabefeldern (Umbenennen im Baum, Strg+P) heraus.
    if (untrack(() => s.active) === path && !document.activeElement?.closest("input, textarea, [role=dialog]")) v.focus();
    const loaded = lang.get(v.state);
    plain = Array.isArray(loaded) && !loaded.length && untrack(() => huge(f!.text));
    if (Array.isArray(loaded) && !loaded.length && !plain)
      language(path).then(
        (ext) => ext && v.dom.isConnected && v.dispatch({ effects: lang.reconfigure(ext) }),
        (e) => console.error("Grammatik", path, e), // Nicht ladbar: bleibt reiner Text.
      );
    return () => {
      flush(repo, path);
      // Geschlossene/umbenannte Dateien hinterlassen nichts; peek statt editor: nach drop() darf nichts neu entstehen.
      if (peek(repo)?.files[path]) snapshots.set(key, { state: v.state, scroll: v.dom.isConnected ? v.scrollSnapshot() : (scroll ?? v.scrollSnapshot()) });
      v.destroy();
      view = undefined;
    };
  });

  // Inhalt von aussen ersetzt (rev steigt): in den bestehenden Editor einspielen, damit Undo-Verlauf, Cursor,
  // Scrollposition und Fokus bleiben.
  $effect(() => {
    void f?.rev;
    const text = untrack(() => f?.text);
    const tr = view && text !== undefined ? sync(view.state, text) : null;
    if (tr) view!.dispatch(tr);
  });

  // Language-Server anbinden, sobald erlaubt; gen steigt bei Absturz/Neustart: altes Plugin abwerfen, neu anbinden.
  const sv = $derived(serverFor(path));
  const lspKey = $derived(sv && `${repo}\n${sv.server}`);
  $effect(() => {
    const v = view;
    if (!v || plain || !lspKey) return;
    void lsp.gen[lspKey];
    const on = s.lsp;
    let live = true;
    untrack(() => (on ? attach(repo, path) : Promise.resolve(null))).then((ext) => {
      const next = ext ?? [];
      // Ueberholt (Absturz/Neustart waehrend des Starts): nicht das Plugin des alten Clients einhaengen.
      if (live && v.dom.isConnected && lspExt.get(v.state) !== next) v.dispatch({ effects: lspExt.reconfigure(next) });
    });
    return () => void (live = false);
  });

  // Test-Explorer (Marken, Fehler) und Language-Server zusammen: setDiagnostics ersetzt immer alles, darum eine Quelle.
  let marked = false;
  $effect(() => {
    const t = peekTests(repo);
    const v = view;
    if (!v) return;
    const m = t ? marks(t.nodes, t.states, path) : [];
    const d = t ? fails(t.nodes, t.results, path) : [];
    const ld = lspDiagnostics(repo, path, v);
    if (!m.length && !d.length && !ld.length && !marked) return;
    marked = m.length > 0 || d.length > 0 || ld.length > 0;
    untrack(() => {
      const doc = v.state.doc;
      const diags = d
        .filter((x) => x.line <= doc.lines)
        .map((x) => ({ from: doc.line(x.line).from, to: doc.line(x.line).to, severity: "error" as const, message: x.msg }));
      v.dispatch(setDiagnostics(v.state, [...diags, ...ld]), { effects: setTestMarks.of(m) });
    });
  });

  // ▶ at entry points (package.json scripts, Main, fn main), 500 ms after the last change. Own derived: a RepoRun
  // created inside this effect would not be tracked by it.
  const runs = $derived(run(repo));
  let runMarked = false;
  $effect(() => {
    const v = view;
    const text = f?.text;
    if (!v || plain || text === undefined) return;
    void detect(repo);
    const cfgs = runs.configs.length ? allConfigs(repo) : [];
    const live = new Set(runs.runs.filter((x) => x.state === "running").map((x) => x.cfg.label));
    const t = setTimeout(() => {
      const m = runLines(path, text, cfgs).map((x) => ({ ...x, running: live.has(x.label) }));
      if (!v.dom.isConnected || (!m.length && !runMarked)) return;
      runMarked = m.length > 0;
      v.dispatch({ effects: setRunMarks.of(m) });
    }, 500);
    return () => clearTimeout(t);
  });

  // Git-Gutter: 800 ms nach der letzten Aenderung gegen HEAD vergleichen; nicht bei grossen Dateien.
  $effect(() => {
    const v = view;
    const text = f?.text;
    if (!v || plain || text === undefined) return;
    // Eine aeltere Antwort, die nach einer neueren ankommt, ueberschriebe sonst die aktuellen Marken.
    let stale = false;
    const t = setTimeout(
      () =>
        fs.gutter(repo, path, text).then(
          (d) => !stale && v.dom.isConnected && v.dispatch({ effects: setGitMarks.of(gutterMarks(parseDiff(d)[0]?.hunks ?? [])) }),
          () => {}, // Kein Git oder Fehler: ohne Marken.
        ),
      800,
    );
    return () => ((stale = true), clearTimeout(t));
  });

  // Click on a git gutter mark (event from gitGutter in fresh).
  $effect(() => {
    const h = host;
    h?.addEventListener("gitdiff", showHead);
    return () => h?.removeEventListener("gitdiff", showHead);
  });

  // Zeilenumbruch ist global: offene Editoren ziehen mit, wiederhergestellte Zustaende auch.
  $effect(() => {
    const w = prefs.wrap;
    view?.dispatch({ effects: wrap.reconfigure(w ? EditorView.lineWrapping : []) });
  });

  // Blame setting is global too.
  $effect(() => {
    const on = prefs.blame;
    if (view) syncBlame(view, on, repo, path, openCommit);
  });

  // Sprungziel (Stack-Link, Testdetails): Cursor auf die Zeile, mittig zeigen, Ziel verbrauchen.
  $effect(() => {
    const r = s.reveal;
    const v = view;
    if (!r || r.path !== path || !v) return;
    untrack(() => {
      const l = v.state.doc.line(Math.min(Math.max(1, r.line), v.state.doc.lines));
      const pos = l.from + Math.min(r.col ?? 0, l.length);
      // The caret, not the line start: a column past the visible width scrolls sideways (or down when wrapped).
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      v.focus();
      s.reveal = null;
    });
  });

  const showDiff = () =>
    diff(repo, path).then(
      (d) => (compare = d),
      (e) => (s.error = String(e)),
    );
</script>

{#if !f}
  <Empty>Lädt …</Empty>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    {#if f.conflict}
      <div class="bg-warning/10 border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-ui">
        <TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        <span class="text-warning min-w-48 flex-1">Datei wurde außerhalb {f.conflict === "deleted" ? "gelöscht" : "geändert"}.</span>
        <span class="ml-auto flex shrink-0 gap-1.5">
          <Button size="xs" variant="outline" onclick={() => reload(repo, path)}>Neu laden</Button>
          <Button size="xs" variant="outline" onclick={() => keep(repo, path)}>Meine behalten</Button>
          <Button size="xs" variant="outline" onclick={showDiff}>Vergleichen</Button>
        </span>
      </div>
    {/if}
    {#if sv && lspKey && !s.lsp && !s.noLsp}
      <div class="text-muted-foreground border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1 text-ui">
        <!-- Knoepfe brechen nur gemeinsam um, nie einzeln -->
        <span class="min-w-48 flex-1">Language-Server für dieses Projekt aktivieren (Fehler, Vervollständigung, F12, F2)? Er führt Projektcode aus.</span>
        <span class="ml-auto flex shrink-0 gap-1.5">
          <Button size="xs" variant="outline" onclick={() => allowLsp(repo)}>Aktivieren</Button>
          <Button size="xs" variant="ghost" onclick={() => allowLsp(repo, false)}>Nicht für dieses Projekt</Button>
        </span>
      </div>
    {:else if lspKey && lsp.status[lspKey]}
      <div class="bg-warning/10 border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-ui">
        <TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        <span class="text-warning line-clamp-3 min-w-48 flex-1 break-words whitespace-pre-line">{lsp.status[lspKey]}</span>
        <span class="ml-auto flex shrink-0 gap-1.5">
          <Button size="xs" variant="outline" onclick={() => retry(repo, sv!.server)}>Erneut versuchen</Button>
          <Button size="xs" variant="ghost" onclick={() => dismiss(repo, sv!.server)}>Ausblenden</Button>
        </span>
      </div>
    {/if}
    {#if plain}
      <div class="text-muted-foreground border-border/60 shrink-0 border-b px-3 py-1 text-ui">Große Datei: ohne Highlighting</div>
    {/if}
    <div bind:this={host} data-path={path} class="min-h-0 flex-1 overflow-hidden"></div>
  </div>

  <DiffDialog diff={head} title={path.split("/").pop() ?? path} description="Änderungen seit dem letzten Commit" {repo} empty="Kein Unterschied." actions={revertActions} onclose={() => (head = null)}>
    {#if stale}
      <span class="text-warning ml-auto shrink-0 text-ui">Datei wurde inzwischen geändert – Diff neu geladen, bitte erneut wählen.</span>
    {/if}
  </DiffDialog>
  <DiffDialog diff={compare} title="Platte → meine Änderungen" description={path} empty="Kein Unterschied." onclose={() => (compare = null)} />
{/if}
