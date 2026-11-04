<script lang="ts">
  // Editor-Ansicht eines Projekts: verdrahtet Dock, Dateibaum und Code-Panels mit dem Store.
  // Haelt selbst keinen Zustand: beim Wechsel zu Terminal/Git wird sie abgebaut, Puffer und Layout liegen in $lib/editor.svelte.
  import Notice from "$lib/components/Notice.svelte";
  import { DropdownMenu } from "bits-ui";
  import { Button, Empty, IconButton, Select, fileIcon, menuContent, menuItem, menuSeparator } from "$lib/atelier-ui";
  import SaveIcon from "@lucide/svelte/icons/save";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import FlaskConicalIcon from "@lucide/svelte/icons/flask-conical";
  import PlayIcon from "@lucide/svelte/icons/play";
  import SquareIcon from "@lucide/svelte/icons/square";
  import FileCodeIcon from "@lucide/svelte/icons/file-code";
  import FolderTreeIcon from "@lucide/svelte/icons/folder-tree";
  import SquareTerminalIcon from "@lucide/svelte/icons/square-terminal";
  import SlidersIcon from "@lucide/svelte/icons/sliders-horizontal";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { tick } from "svelte";
  import BuildProfilesDialog from "./BuildProfilesDialog.svelte";
  import RunConfigsDialog from "./RunConfigsDialog.svelte";
  import ListPlusIcon from "@lucide/svelte/icons/list-plus";
  import { FILES, PREVIEW, PROBLEMS, RUN, SEARCH, TESTS, activate, groupOf, mainGroup, panelPath, splitAt, type PanelId } from "$lib/dock";
  import { closeTab, editor, focus, permanent, resetLayout, save, setLayout, setProfile, setRun, togglePanel, watch } from "$lib/editor.svelte";
  import { allConfigs, chosen, detect, run, runRestart, runStart, runStop } from "$lib/run.svelte";
  import { BUILTIN, type RunConfig } from "$lib/run.logic";
  import { MOD, SHIFT } from "$lib/editor.logic";
  import Dock, { type TabInfo } from "./Dock.svelte";
  import FileTree from "./FileTree.svelte";
  import CodePane from "./CodePane.svelte";
  import QuickOpen from "./QuickOpen.svelte";
  import TabSwitcher from "./TabSwitcher.svelte";
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
  const found = $derived(problems(lsp.diags, repo));
  // Badge color follows the worst finding (1 = error, 2 = warning).
  const worst = $derived(Math.min(...found.map((p) => p.d.severity ?? 1)));
  let quick = $state(false);
  let quickInit = $state("");
  let profilesOpen = $state(false);
  let customOpen = $state(false);
  // Action entries at the end of the run selects; bumping `pick` remounts them so they keep showing the real value.
  const EDIT = "__edit__";
  let pick = $state(0);

  // Aenderungen von aussen (claude im Terminal) nur verfolgen, solange die Ansicht sichtbar ist.
  $effect(() => watch(repo));

  // Run-Leiste: Ziele einmal je Sitzung erkennen (liest nur). Gestartet wird allein per Klick oder F5.
  $effect(() => void detect(repo));
  const r = $derived(run(repo));
  // Read r first: a RepoRun created inside one of these deriveds would not be tracked by it (Svelte skips state a
  // reaction created itself), and the target list would stay empty after the detection on a cold start.
  const cfg = $derived(r && chosen(repo));
  const cfgs = $derived(r && allConfigs(repo));
  // Toolbar buttons act on the selected target; other targets keep running (tabs in the output).
  const running = $derived(!!cfg && r.of(cfg.label)?.state === "running");
  const kinds: [RunConfig["target"]["kind"], string][] = [
    ["npm", "npm-Scripts"],
    ["dotnet", ".NET"],
    ["cargo", "Cargo"],
    ["shell", "Eigene"],
  ];

  function info(id: PanelId): TabInfo {
    // Panels close via their toolbar toggle; only file tabs carry an x.
    if (id === FILES) return { title: "Dateien", icon: FolderTreeIcon, closable: false };
    if (id === PREVIEW) return { title: "Vorschau", icon: PanelRightIcon, closable: false };
    if (id === TESTS) return { title: "Tests", icon: FlaskConicalIcon, closable: false };
    if (id === RUN) return { title: "Ausgabe", icon: SquareTerminalIcon, closable: false };
    if (id === PROBLEMS) return { title: "Probleme", icon: CircleAlertIcon, closable: false };
    if (id === SEARCH) return { title: "Suche", icon: SearchIcon, closable: false };
    const path = panelPath(id) ?? "";
    const f = s.files[path];
    // Auf der Platte geloescht, Puffer hat noch Aenderungen: der Tab bleibt und sagt es.
    const gone = f?.conflict === "deleted" ? " (gelöscht)" : "";
    const { icon, tint } = fileIcon(path);
    const preview = s.preview === path;
    const hint = path + gone + (preview ? " – Vorschau, Doppelklick behält den Tab" : "");
    return { title: path.slice(path.lastIndexOf("/") + 1) + gone, hint, dirty: f?.dirty, icon, tint, preview };
  }

  // Output docks at the bottom like runStart does; closing asks first while something runs.
  function toggleRun() {
    const g = groupOf(s.layout, RUN);
    if (g && g.active !== RUN) setLayout(repo, activate(s.layout, RUN));
    else if (g) void closeTab(repo, RUN);
    else setLayout(repo, splitAt(s.layout, RUN, mainGroup(s.layout).id, "bottom"));
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
      const c = chosen(repo);
      if (e.shiftKey && (e.ctrlKey || e.metaKey)) void runRestart(repo, c?.label);
      else if (e.shiftKey) void (c && runStop(repo, c.label));
      else if (!e.ctrlKey && !e.metaKey) void runStart(repo);
      return;
    }
    // Go to line like VS Code: Ctrl+G everywhere, also on the Mac (Cmd+G stays find next there). CodeMirror swallows it (gotoline.ts).
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      [quickInit, quick] = [":", true];
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
<TabSwitcher {repo} />

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
  <Empty icon={FileCodeIcon} hint="{MOD}+P">Datei im Baum wählen oder schnell öffnen.</Empty>
{/snippet}

{#snippet toggle(id: "files" | "preview" | "tests" | "search" | "problems" | "run", label: string, Icon: typeof SaveIcon, title = label)}
  <!-- Pressed only while visible: a tab behind another one in its group is not -->
  {@const on = groupOf(s.layout, id)?.active === id}
  <!-- Narrow window: icon only, the tooltip keeps the name. -->
  <Button
    variant="toggle"
    size="xs"
    aria-pressed={on}
    title="{title} {on ? 'ausblenden' : 'einblenden'}"
    onclick={() => (id === "run" ? toggleRun() : id === "search" && !on ? findInFiles() : togglePanel(repo, id))}
    ><Icon /> <span class="@max-[72rem]:hidden">{label}</span>
    {#if id === "problems" && found.length}
      <span
        class="text-meta rounded-full px-1.5 tabular-nums {worst === 1
          ? 'bg-destructive/15 text-destructive'
          : worst === 2
            ? 'bg-warning/15 text-warning'
            : 'bg-muted text-muted-foreground'}">{found.length}</span
      >
    {/if}</Button
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui">
  <div class="bg-chrome border-border @container flex items-center gap-0.5 border-b px-2 py-1">
    <Button
      variant="quiet"
      size="xs"
      disabled={!s.active || !s.files[s.active]?.dirty}
      title="Speichern ({MOD}+S)"
      onclick={() => save(repo)}><SaveIcon /> Speichern</Button
    >
    {#if dirty}
      <span class="text-muted-foreground ml-1 flex items-center gap-1.5 text-meta" role="status">
        <span class="bg-primary size-1.5 rounded-full"></span>
        {dirty} ungespeichert
      </span>
    {/if}
    <span class="bg-background/60 ring-foreground/10 ml-3 flex items-center gap-0.5 rounded-md p-0.5 ring-1">
      {#if running}<span class="bg-success mx-1 size-1.5 animate-pulse rounded-full" title="Läuft"></span>{/if}
      <span class="text-muted-foreground pl-1.5 text-meta @max-[72rem]:hidden">Startziel</span>
      {#key pick}
        <Select
          class="h-5 max-w-60 border-0 bg-transparent font-mono text-meta"
          value={cfg?.label ?? ""}
          groups={[
            ...kinds.map(([kind, label]) => ({
              label,
              options: cfgs.filter((c) => c.target.kind === kind).map((c) => [c.label, c.label] as const),
            })),
            { options: [["Eigene Startziele …", EDIT] as const] },
          ]}
          placeholder="Nichts zum Starten"
          aria-label="Startziel"
          title="Startziel (F5 startet)"
          onchange={(v) => (v === EDIT ? ((customOpen = true), pick++) : setRun(repo, v))}
        />
        <Select
          class="h-5 max-w-32 border-0 bg-transparent text-meta"
          value={s.profile}
          options={[...[...BUILTIN, ...s.profiles].map((p) => [p.name, p.name] as const), ["Profile verwalten …", EDIT]]}
          aria-label="Build-Profil"
          title="Build-Profil"
          onchange={(v) => (v === EDIT ? ((profilesOpen = true), pick++) : setProfile(repo, v))}
        />
      {/key}
      <Button
        variant="quiet"
        size="xs"
        class={cfg && !running ? "text-success hover:text-success" : ""}
        disabled={!cfg || running}
        title={cfg ? `${cfg.label} starten (F5) – führt Code aus dem Projekt aus` : "Nichts zum Starten"}
        onclick={() => runStart(repo, cfg ?? undefined)}><PlayIcon /> <span class="@max-[72rem]:hidden">Starten</span></Button
      >
      <Button
        variant="quiet"
        size="xs"
        class={running ? "text-destructive hover:text-destructive" : ""}
        disabled={!running}
        title="Stoppen (Umschalt+F5)"
        onclick={() => cfg && runStop(repo, cfg.label)}><SquareIcon class="fill-current" /> <span class="@max-[72rem]:hidden">Stoppen</span></Button
      >
      <Button
        variant="quiet"
        size="xs"
        disabled={!r.of(cfg?.label)}
        title="Neu starten ({MOD}+{SHIFT}+F5)"
        onclick={() => runRestart(repo, cfg?.label)}><RotateCcwIcon /> <span class="@max-[72rem]:hidden">Neu starten</span></Button
      >
    </span>
    <span class="flex-1"></span>
    <span class="bg-muted/60 flex items-center gap-0.5 rounded-md p-0.5">
      {@render toggle("files", "Dateien", PanelLeftIcon)}
      {@render toggle("search", "Suche", SearchIcon, `Suche (${MOD}+{SHIFT}+F)`)}
      {@render toggle("tests", "Tests", FlaskConicalIcon)}
      {@render toggle("preview", "Vorschau", PanelRightIcon)}
      {@render toggle("problems", "Probleme", CircleAlertIcon, `Probleme (${MOD}+{SHIFT}+M)`)}
      {#if r.current || groupOf(s.layout, RUN)}{@render toggle("run", "Ausgabe", SquareTerminalIcon)}{/if}
    </span>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <IconButton {...props} size="md" label="Weitere Optionen"><EllipsisIcon class="size-3.5" /></IconButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" class={menuContent}>
          <DropdownMenu.Item class={menuItem} onSelect={() => (customOpen = true)}
            ><ListPlusIcon class="size-3.5" /> Eigene Startziele …</DropdownMenu.Item
          >
          <DropdownMenu.Item class={menuItem} onSelect={() => (profilesOpen = true)}
            ><SlidersIcon class="size-3.5" /> Build-Profile verwalten …</DropdownMenu.Item
          >
          <DropdownMenu.Separator class={menuSeparator} />
          <DropdownMenu.Item
            class={menuItem}
            title="Dateien links, Editor in der Mitte; offene Dateien bleiben, ein laufender Prozess stoppt"
            onSelect={() => resetLayout(repo)}><LayoutDashboardIcon class="size-3.5" /> Layout zurücksetzen</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
  <Notice bind:text={() => s.error, (v) => (s.error = v)} />
  <div class="min-h-0 flex-1 p-1">
    <Dock
      layout={s.layout}
      onlayout={(l) => setLayout(repo, l)}
      onclose={(p) => closeTab(repo, p)}
      onfocus={(p) => focus(repo, p)}
      ontabdblclick={(p) => permanent(repo, panelPath(p) ?? "")}
      tab={info}
      {panel}
      {empty}
    />
  </div>
</div>

<BuildProfilesDialog bind:open={profilesOpen} {repo} />
<RunConfigsDialog bind:open={customOpen} {repo} />
