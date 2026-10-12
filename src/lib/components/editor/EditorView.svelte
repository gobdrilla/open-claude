<script lang="ts">
  // Editor-Ansicht eines Projekts: verdrahtet Dock, Dateibaum und Code-Panels mit dem Store.
  // Haelt selbst keinen Zustand: beim Wechsel zu Terminal/Git wird sie abgebaut, Puffer und Layout liegen in $lib/editor.svelte.
  import Notice from "$lib/components/Notice.svelte";
  import { Empty, Select, fileIcon } from "$lib/components/kit";
  import { Button } from "$lib/components/ui/button/index.js";
  import SaveIcon from "@lucide/svelte/icons/save";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import FlaskConicalIcon from "@lucide/svelte/icons/flask-conical";
  import PlayIcon from "@lucide/svelte/icons/play";
  import RotateCwIcon from "@lucide/svelte/icons/rotate-cw";
  import SquareIcon from "@lucide/svelte/icons/square";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import SquareTerminalIcon from "@lucide/svelte/icons/square-terminal";
  import SlidersIcon from "@lucide/svelte/icons/sliders-horizontal";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { tick } from "svelte";
  import BuildProfilesDialog from "./BuildProfilesDialog.svelte";
  import { FILES, PREVIEW, PROBLEMS, RUN, SEARCH, TESTS, activate, groupOf, panelPath, type PanelId } from "$lib/dock";
  import { closeTab, editor, focus, resetLayout, save, setLayout, setProfile, setRun, togglePanel, watch } from "$lib/editor.svelte";
  import { chosen, detect, run, runRestart, runStart, runStop } from "$lib/run.svelte";
  import { BUILTIN, type RunConfig } from "$lib/run.logic";
  import Dock, { type TabInfo } from "./Dock.svelte";
  import FileTree from "./FileTree.svelte";
  import CodePane from "./CodePane.svelte";
  import QuickOpen from "./QuickOpen.svelte";
  import PreviewPane from "./PreviewPane.svelte";
  import TestPane from "./TestPane.svelte";
  import RunPane from "./RunPane.svelte";
  import ProblemsPane from "./ProblemsPane.svelte";
  import SearchPane from "./SearchPane.svelte";
  import { lsp } from "$lib/lsp.svelte";
  import { problems } from "$lib/lsp.logic";

  let { repo }: { repo: string } = $props();

  const s = $derived(editor(repo));
  const dirty = $derived(Object.values(s.files).filter((f) => f.dirty).length);
  const errors = $derived(problems(lsp.diags, repo).filter((p) => (p.d.severity ?? 1) === 1).length);
  let quick = $state(false);
  let quickInit = $state("");
  let profilesOpen = $state(false);

  // Aenderungen von aussen (claude im Terminal) nur verfolgen, solange die Ansicht sichtbar ist.
  $effect(() => watch(repo));

  // Run-Leiste: Ziele einmal je Sitzung erkennen (liest nur). Gestartet wird allein per Klick oder F5.
  $effect(() => void detect(repo));
  const r = $derived(run(repo));
  const cfg = $derived(chosen(repo));
  const running = $derived(r.current?.state === "running");
  const kinds: [RunConfig["target"]["kind"], string][] = [
    ["npm", "npm-Scripts"],
    ["dotnet", ".NET"],
    ["cargo", "Cargo"],
  ];

  function info(id: PanelId): TabInfo {
    if (id === FILES) return { title: "Dateien", icon: FolderTreeIcon };
    if (id === PREVIEW) return { title: "Vorschau", icon: PanelRightIcon };
    if (id === TESTS) return { title: "Tests", icon: FlaskConicalIcon };
    if (id === RUN) return { title: "Ausgabe", icon: SquareTerminalIcon };
    if (id === PROBLEMS) return { title: "Probleme", icon: CircleAlertIcon };
    if (id === SEARCH) return { title: "Suche", icon: SearchIcon };
    const path = panelPath(id) ?? "";
    const f = s.files[path];
    // Auf der Platte geloescht, Puffer hat noch Aenderungen: der Tab bleibt und sagt es.
    const gone = f?.conflict === "deleted" ? " (gelöscht)" : "";
    const { icon, tint } = fileIcon(path);
    return { title: path.slice(path.lastIndexOf("/") + 1) + gone, hint: path + gone, dirty: f?.dirty, icon, tint };
  }

  // Wie VS Code: Suche zeigen und ins Feld springen, nie ausblenden.
  async function findInFiles() {
    if (groupOf(s.layout, SEARCH)) setLayout(repo, activate(s.layout, SEARCH));
    else togglePanel(repo, "search");
    await tick();
    document.querySelector<HTMLInputElement>("[data-search]")?.select();
  }

  function onKey(e: KeyboardEvent) {
    // Wie VS Code: F5 startet, Umschalt+F5 stoppt, Strg+Umschalt+F5 startet neu. Sonst laedt die WebView die Seite neu.
    if (e.key === "F5" && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) void runRestart(repo);
      else if (e.shiftKey) void runStop(repo);
      else if (!e.ctrlKey && !e.metaKey) void runStart(repo);
      return;
    }
    // CodeMirror speichert die eigene Datei selbst (Mod-s) und setzt dann defaultPrevented; Mod-Shift-m ebenso.
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "f") void findInFiles();
      else if (k === "o") [quickInit, quick] = ["@", true];
      else if (k !== "m") return;
      else if (!e.defaultPrevented) togglePanel(repo, "problems");
      e.preventDefault();
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "s") {
      if (!e.defaultPrevented) save(repo);
    } else if (key === "p") [quickInit, quick] = ["", true];
    // Nicht, wenn CodeMirror die Taste schon nutzt (Ctrl-T vertauscht auf dem Mac Zeichen).
    else if (key === "t" && !e.defaultPrevented) [quickInit, quick] = ["#", true];
    else return;
    // Auch Strg+P: sonst oeffnet die WebView den Druckdialog.
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onKey} />

<QuickOpen {repo} bind:open={quick} initial={quickInit} />

{#snippet panel(id: PanelId)}
  {#if id === FILES}
    <FileTree {repo} />
  {:else if id === PREVIEW}
    <PreviewPane {repo} />
  {:else if id === TESTS}
    <TestPane {repo} />
  {:else if id === RUN}
    <RunPane {repo} />
  {:else if id === PROBLEMS}
    <ProblemsPane {repo} />
  {:else if id === SEARCH}
    <SearchPane {repo} />
  {:else}
    <CodePane {repo} path={panelPath(id) ?? ""} />
  {/if}
{/snippet}

{#snippet empty()}
  <Empty icon={FileCodeIcon}
    >Datei im Baum wählen oder <kbd class="border-border/60 bg-secondary rounded border px-1 font-mono text-[10px]">Strg+P</kbd></Empty
  >
{/snippet}

{#snippet toggle(id: "files" | "preview" | "tests" | "search" | "problems", label: string, Icon: typeof SaveIcon, title = label)}
  {@const on = !!groupOf(s.layout, id)}
  <Button
    variant="ghost"
    size="xs"
    class={on ? "bg-background text-foreground ring-foreground/10 ring-1 [&_svg]:text-primary" : "text-muted-foreground"}
    aria-pressed={on}
    title="{title} {on ? 'ausblenden' : 'einblenden'}"
    onclick={() => togglePanel(repo, id)}><Icon /> {label}</Button
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col text-xs">
  <div class="bg-chrome border-border flex items-center gap-0.5 border-b px-2 py-1">
    <Button
      variant="ghost"
      size="xs"
      class="text-muted-foreground"
      disabled={!s.active || !s.files[s.active]?.dirty}
      title="Speichern (Strg+S)"
      onclick={() => save(repo)}><SaveIcon /> Speichern</Button
    >
    {#if dirty}
      <span class="text-muted-foreground ml-1 flex items-center gap-1.5 text-[11px]" role="status">
        <span class="bg-primary size-1.5 rounded-full"></span>
        {dirty} ungespeichert
      </span>
    {/if}
    <span class="bg-background/60 ring-foreground/10 ml-3 flex items-center gap-0.5 rounded-md p-0.5 ring-1">
      {#if running}<span class="bg-success mx-1 size-1.5 animate-pulse rounded-full" title="Läuft"></span>{/if}
      <Select
        class="h-5 max-w-60 border-0 bg-transparent font-mono text-[11px]"
        value={cfg?.label ?? ""}
        groups={kinds.map(([kind, label]) => ({
          label,
          options: r.configs.filter((c) => c.target.kind === kind).map((c) => [c.label, c.label] as const),
        }))}
        placeholder="Nichts zum Starten"
        disabled={!r.configs.length}
        aria-label="Startziel"
        title="Startziel (F5 startet)"
        onchange={(v) => setRun(repo, v)}
      />
      <Select
        class="h-5 max-w-32 border-0 bg-transparent text-[11px]"
        value={s.profile}
        options={[...BUILTIN, ...s.profiles].map((p) => [p.name, p.name] as const)}
        aria-label="Build-Profil"
        title="Build-Profil"
        onchange={(v) => setProfile(repo, v)}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-muted-foreground"
        title="Build-Profile verwalten"
        aria-label="Build-Profile verwalten"
        onclick={() => (profilesOpen = true)}><SlidersIcon /></Button
      >
      <Button
        variant="ghost"
        size="icon-xs"
        class={cfg && !running ? "text-success hover:text-success" : "text-muted-foreground"}
        disabled={!cfg || running}
        title={cfg ? `${cfg.label} starten (F5) – führt Code aus dem Projekt aus` : "Nichts zum Starten"}
        onclick={() => runStart(repo, cfg ?? undefined)}><PlayIcon /></Button
      >
      <Button
        variant="ghost"
        size="icon-xs"
        class={running ? "text-destructive hover:text-destructive" : "text-muted-foreground"}
        disabled={!running}
        title="Stoppen (Umschalt+F5)"
        onclick={() => runStop(repo)}><SquareIcon /></Button
      >
      <Button
        variant="ghost"
        size="icon-xs"
        class="text-muted-foreground"
        disabled={!r.current}
        title="Neu starten (Strg+Umschalt+F5)"
        onclick={() => runRestart(repo)}><RotateCwIcon /></Button
      >
    </span>
    <span class="flex-1"></span>
    {@render toggle("files", "Dateien", PanelLeftIcon)}
    {@render toggle("search", "", SearchIcon, "Suche (Strg+Umschalt+F)")}
    {@render toggle("tests", "Tests", FlaskConicalIcon)}
    {@render toggle("preview", "Vorschau", PanelRightIcon)}
    {@render toggle("problems", errors ? String(errors) : "", CircleAlertIcon, "Probleme (Strg+Umschalt+M)")}
    <Button
      variant="ghost"
      size="icon-xs"
      class="text-muted-foreground"
      aria-label="Layout zurücksetzen"
      title="Layout zurücksetzen: Dateien links, Editor in der Mitte; offene Dateien bleiben, ein laufender Prozess stoppt"
      onclick={() => resetLayout(repo)}><RotateCcwIcon /></Button
    >
  </div>
  <Notice bind:text={() => s.error, (v) => (s.error = v)} />
  <div class="min-h-0 flex-1 p-1">
    <Dock
      layout={s.layout}
      onlayout={(l) => setLayout(repo, l)}
      onclose={(p) => closeTab(repo, p)}
      onfocus={(p) => focus(repo, p)}
      tab={info}
      {panel}
      {empty}
    />
  </div>
</div>

<BuildProfilesDialog bind:open={profilesOpen} {repo} />
