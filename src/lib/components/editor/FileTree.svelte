<script lang="ts">
  import { confirm } from "$lib/confirm.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { ContextMenu } from "bits-ui";
  import Notice from "$lib/components/Notice.svelte";
  import { Button, ContextItem, Empty, IconButton, PromptDialog, RefreshButton, Row as RowButton, fileIcon, menuContent, paneBar } from "$lib/atelier-ui";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import FilePlusIcon from "@lucide/svelte/icons/file-plus";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import FolderXIcon from "@lucide/svelte/icons/folder-x";
  import { fs, type Entry } from "$lib/files";
  import { editor, open, permanent, setExpanded, renamed, removed, poll } from "$lib/editor.svelte";
  import { rows, join, dirname, treeKey, type Row } from "$lib/tree";
  import { FILES_APP, atRef, under } from "$lib/editor.logic";
  import { sendToClaude } from "$lib/ide.svelte";
  import { showHistory } from "$lib/history.svelte";
  import { t } from "$lib/i18n";

  let { repo }: { repo: string } = $props();

  const s = $derived(editor(repo));
  let error = $state("");
  /** Projektordner nicht lesbar: steht statt des Baums da, bis "Neu laden" klappt. */
  let rootError = $state("");

  // Listing je Ordner, eine Ebene. Nur Projektordner und aufgeklappte Ordner werden gelesen.
  let lists = $state<Record<string, Entry[]>>({});
  // mtime, mit der ein Ordner zuletzt gelistet wurde (nicht reaktiv): weicht s.dirs ab, wird neu gelesen.
  const seen = new Map<string, number | null | undefined>();

  $effect(() => {
    const watched = ["", ...s.expanded];
    for (const dir of watched) {
      const mtime = s.dirs[dir];
      if (seen.has(dir) && seen.get(dir) === mtime) continue;
      seen.set(dir, mtime);
      load(dir);
    }
    // Zugeklappte werden nicht mehr beobachtet: beim naechsten Aufklappen frisch lesen.
    for (const dir of seen.keys()) if (!watched.includes(dir)) seen.delete(dir);
  });

  async function load(dir: string) {
    try {
      lists[dir] = await fs.list(repo, dir);
      if (!dir) rootError = "";
    } catch (e) {
      // Aufgeklappter Ordner ist weg (geloescht, Branch gewechselt): still zuklappen.
      if (dir) setExpanded(repo, dir, false);
      // Schon geladener Baum bleibt stehen, der Fehler kommt dann als Notice.
      else if (lists[""]) error = String(e);
      else rootError = String(e);
    }
  }

  const visible = $derived(rows(lists, s.expanded));

  function click(r: Row) {
    if (r.dir) setExpanded(repo, r.path, !r.open);
    // Single click: preview tab (like VS Code), double click keeps it.
    else open(repo, r.path, undefined, undefined, true);
  }

  let box = $state<HTMLElement>();
  function onKey(e: KeyboardEvent) {
    const btns = [...(box?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    const k = i < 0 || e.altKey || e.ctrlKey || e.metaKey ? null : treeKey(visible, i, e.key);
    if (!k) return;
    e.preventDefault();
    if (k.toggle) setExpanded(repo, k.toggle, !s.expanded.includes(k.toggle));
    if (k.focus !== undefined) btns[k.focus]?.focus();
  }

  async function run(action: () => Promise<void>) {
    error = "";
    try {
      await action();
    } catch (e) {
      error = String(e);
    }
    // Auch nach einem Fehler: die Platte kann sich trotzdem geaendert haben.
    await poll(repo).catch(() => {});
  }

  // Texteingabe fuer Neue Datei / Neuer Ordner / Umbenennen.
  let prompt = $state<{ title: string; run: (v: string) => Promise<void> } | null>(null);
  let promptValue = $state("");
  function askPrompt(title: string, value: string, action: (v: string) => Promise<void>) {
    prompt = { title, run: action };
    promptValue = value;
  }
  function doPrompt() {
    if (!prompt) return;
    const action = prompt.run;
    const value = promptValue.trim();
    prompt = null;
    if (value) run(() => action(value));
  }

  function create(dir: string, isDir: boolean) {
    const title = dir
      ? t(isDir ? "Neuer Ordner in {dir}" : "Neue Datei in {dir}", { dir })
      : t(isDir ? "Neuer Ordner im Projektordner" : "Neue Datei im Projektordner");
    askPrompt(title, "", async (name) => {
      const path = join(dir, name);
      await fs.create(repo, path, isDir);
      if (dir) setExpanded(repo, dir, true);
      if (!isDir) await open(repo, path);
    });
  }

  function rename(r: Row) {
    askPrompt(t("{name} umbenennen", { name: r.name }), r.name, async (name) => {
      const to = join(dirname(r.path), name);
      if (to === r.path) return;
      await fs.rename(repo, r.path, to);
      renamed(repo, r.path, to);
    });
  }

  async function remove(r: Row) {
    const dirty = Object.values(s.files).some((f) => f.dirty && under(f.path, r.path));
    const message = t("„{path}“ in den Papierkorb legen?", { path: r.path }) + (dirty ? "\n" + t("Ungespeicherte Änderungen im Editor gehen verloren.") : "");
    if (!(await confirm(message, t("Löschen")))) return;
    run(async () => {
      await fs.delete(repo, r.path);
      removed(repo, r.path);
    });
  }

  // reveal oeffnet Ordner: bei Dateien den, in dem sie liegen.
  function reveal(dir: string) {
    const path = dir ? `${repo}/${dir}` : repo;
    run(() => invoke("reveal", { path: repo.includes("\\") ? path.replaceAll("/", "\\") : path }));
  }
</script>

<div class="flex h-full flex-col text-ui">
  <div class="{paneBar} pl-2.5">
    <span class="text-foreground min-w-0 flex-1 truncate text-meta font-semibold" title={repo}
      >{repo.split(/[\\/]/).pop()}</span
    >
    <IconButton label={t("Neue Datei")} title={t("Neue Datei im Projektordner")} onclick={() => create("", false)}
      ><FilePlusIcon class="size-3" /></IconButton
    >
    <IconButton label={t("Neuer Ordner")} title={t("Neuer Ordner im Projektordner")} onclick={() => create("", true)}
      ><FolderPlusIcon class="size-3" /></IconButton
    >
  </div>
  <Notice bind:text={error} />

  {#if !lists[""]}
    {#if rootError}
      <Empty icon={FolderXIcon}>
        <p class="whitespace-pre-wrap select-text">{rootError}</p>
        {#snippet action()}<RefreshButton loading={false} onclick={() => ((rootError = ""), load(""))} />{/snippet}
      </Empty>
    {:else}
      <Empty>{t("Lädt …")}</Empty>
    {/if}
  {:else if !lists[""].length}
    <Empty icon={FolderIcon}>
      {t("Der Projektordner ist leer.")}
      {#snippet action()}<Button size="xs" variant="outline" onclick={() => create("", false)}><FilePlusIcon /> {t("Neue Datei")}</Button>{/snippet}
    </Empty>
  {:else}
  <div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1" bind:this={box} onkeydown={onKey} role="tree" tabindex="-1">
    {#each visible as r (r.path)}
      <!-- Neues landet im Ordner selbst bzw. neben der Datei. -->
      {@const dir = r.dir ? r.path : dirname(r.path)}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <RowButton
            dim={r.ignored}
            text="md" selected={r.path === s.active} class="h-6 pr-2"
            style="padding-left:{4 + r.depth * 12}px"
            onclick={(e) => ((e.currentTarget as HTMLElement).focus(), click(r))}
            ondblclick={() => !r.dir && permanent(repo, r.path)}
            data-tree-row
            aria-expanded={r.dir ? r.open : undefined}
            title={r.path}
          >
            <ChevronRightIcon
              class="size-3 shrink-0 transition-transform {r.open ? 'rotate-90' : ''} {r.dir ? '' : 'invisible'}"
            />
            <!-- Ordner ohne Icon, der Chevron reicht -->
            {#if !r.dir}{@const ic = fileIcon(r.path)}<ic.icon class="size-3.5 shrink-0 {ic.tint}" />{/if}
            <span class="min-w-0 flex-1 truncate">{r.name}</span>
            {#if s.files[r.path]?.dirty}<span class="bg-primary size-1.5 shrink-0 rounded-full"></span>{/if}
          </RowButton>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content class={menuContent}>
            <ContextItem label={t("An Claude")} onSelect={() => sendToClaude(repo, atRef(r.path))} />
            <ContextItem label={t("Neue Datei")} onSelect={() => create(dir, false)} />
            <ContextItem label={t("Neuer Ordner")} onSelect={() => create(dir, true)} />
            <ContextItem label={t("Umbenennen")} onSelect={() => rename(r)} />
            {#if !r.dir}<ContextItem label={t("Lokale Historie")} onSelect={() => showHistory(repo, r.path)} />{/if}
            <ContextItem label={t("Im {app} zeigen", { app: FILES_APP })} onSelect={() => reveal(dir)} />
            <ContextItem label={t("Löschen")} onSelect={() => remove(r)} destructive />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    {/each}
  </div>
  {/if}
</div>

<PromptDialog
  open={prompt !== null}
  title={prompt?.title ?? ""}
  bind:value={promptValue}
  onsubmit={doPrompt}
  oncancel={() => (prompt = null)}
/>
