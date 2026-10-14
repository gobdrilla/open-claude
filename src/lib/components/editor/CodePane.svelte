<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView, basicSetup } from "codemirror";
  import { EditorState } from "@codemirror/state";
  import { keymap } from "@codemirror/view";
  import { indentWithTab, isolateHistory } from "@codemirror/commands";
  import { lintGutter, setDiagnostics } from "@codemirror/lint";
  import { Button } from "$lib/components/ui/button/index.js";
  import { DiffDialog, Empty } from "$lib/components/kit";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { allowLsp, cursorAt, diff, edited, editor, flush, keep, navigate, peek, prefs, reload, save, snapKey, snapshots, togglePanel, toggleWrap } from "$lib/editor.svelte";
  import { gutterMarks, huge, span } from "$lib/editor.logic";
  import { gitGutter, lang, language, lspExt, setGitMarks, setTestMarks, testGutter, theme, wrap } from "./cm";
  import { peek as peekTests, testRun } from "$lib/testing.svelte";
  import { fails, marks } from "$lib/testing.logic";
  import { mention, selectionChanged } from "$lib/ide.svelte";
  import { attach, dismiss, lsp, lspDiagnostics, retry } from "$lib/lsp.svelte";
  import { serverFor } from "$lib/lsp.logic";
  import { fs } from "$lib/files";
  import { parseDiff } from "$lib/diff";

  // path bleibt fuer die Lebensdauer der Instanz gleich (Dock mountet je Panel-ID neu).
  let { repo, path }: { repo: string; path: string } = $props();

  const s = $derived(editor(repo));
  const f = $derived(s.files[path]);

  let host = $state<HTMLDivElement>();
  /** Diff fuer "Vergleichen"; null = Dialog zu. */
  let compare = $state<string | null>(null);

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
        basicSetup,
        theme,
        lang.of([]),
        lspExt.of([]),
        lintGutter(),
        wrap.of(prefs.wrap ? EditorView.lineWrapping : []),
        testGutter((id) => void testRun(repo, id)),
        gitGutter,
        EditorView.updateListener.of((u) => u.docChanged && edited(repo, path, () => u.view.state.doc.toString())),
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
    return old === text ? null : state.update({ changes: span(old, text), annotations: isolateHistory.of("full") });
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
    const v = untrack(() => {
      const snap = snapshots.get(key);
      const state = snap?.state ?? fresh(f!.text);
      // Waehrend das Panel abgebaut war, kann die Datei nachgeladen worden sein.
      return new EditorView({ parent, state: sync(state, f!.text)?.state ?? state, scrollTo: snap?.scroll });
    });
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
      if (peek(repo)?.files[path]) snapshots.set(key, { state: v.state, scroll: v.scrollSnapshot() });
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

  // Zeilenumbruch ist global: offene Editoren ziehen mit, wiederhergestellte Zustaende auch.
  $effect(() => {
    const w = prefs.wrap;
    view?.dispatch({ effects: wrap.reconfigure(w ? EditorView.lineWrapping : []) });
  });

  // Sprungziel (Stack-Link, Testdetails): Cursor auf die Zeile, mittig zeigen, Ziel verbrauchen.
  $effect(() => {
    const r = s.reveal;
    const v = view;
    if (!r || r.path !== path || !v) return;
    untrack(() => {
      const l = v.state.doc.line(Math.min(Math.max(1, r.line), v.state.doc.lines));
      v.dispatch({ selection: { anchor: l.from + Math.min(r.col ?? 0, l.length) }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
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
      <div class="bg-warning/10 border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-xs">
        <TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        <span class="text-warning mr-auto">Datei wurde außerhalb {f.conflict === "deleted" ? "gelöscht" : "geändert"}.</span>
        <Button size="xs" variant="outline" onclick={() => reload(repo, path)}>Neu laden</Button>
        <Button size="xs" variant="outline" onclick={() => keep(repo, path)}>Meine behalten</Button>
        <Button size="xs" variant="outline" onclick={showDiff}>Vergleichen</Button>
      </div>
    {/if}
    {#if sv && lspKey && !s.lsp && !s.noLsp}
      <div class="text-muted-foreground border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1 text-xs">
        <span class="mr-auto">Language-Server für dieses Projekt aktivieren (Fehler, Vervollständigung, F12, F2)? Er führt Projektcode aus.</span>
        <Button size="xs" variant="outline" onclick={() => allowLsp(repo)}>Aktivieren</Button>
        <Button size="xs" variant="ghost" onclick={() => allowLsp(repo, false)}>Nicht für dieses Projekt</Button>
      </div>
    {:else if lspKey && lsp.status[lspKey]}
      <div class="bg-warning/10 border-border/60 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5 text-xs">
        <TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        <span class="text-warning mr-auto line-clamp-3 break-words whitespace-pre-line">{lsp.status[lspKey]}</span>
        <Button size="xs" variant="outline" onclick={() => retry(repo, sv!.server)}>Erneut versuchen</Button>
        <Button size="xs" variant="ghost" onclick={() => dismiss(repo, sv!.server)}>Ausblenden</Button>
      </div>
    {/if}
    {#if plain}
      <div class="text-muted-foreground border-border/60 shrink-0 border-b px-3 py-1 text-xs">Große Datei: ohne Highlighting</div>
    {/if}
    <div bind:this={host} class="min-h-0 flex-1 overflow-hidden"></div>
  </div>

  <DiffDialog diff={compare} title="Platte → meine Änderungen" description={path} empty="Kein Unterschied." onclose={() => (compare = null)} />
{/if}
