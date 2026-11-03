<script lang="ts">
  import Notice from "$lib/components/Notice.svelte";
  import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Empty, Input, RefreshButton, Row, Textarea, TextButton } from "$lib/atelier-ui";
  import { confirm } from "$lib/confirm.svelte";
  import Markdown from "$lib/components/Markdown.svelte";
  import { untrack } from "svelte";
  import { age } from "$lib/utils";
  import { git, forge, type ForgeKind, type Release, type ReleaseAsset, type ReleaseInput } from "$lib/git";
  import { invoke } from "@tauri-apps/api/core";
  import { FILES_APP } from "$lib/editor.logic";
  import Splitter, { stored } from "$lib/components/Splitter.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PackageIcon from "@lucide/svelte/icons/package";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";

  let { repo, refreshKey }: { repo: string; refreshKey: number } = $props();

  const PAGE = 30;

  let originUrl = $state<string | null>(null);
  let kind = $state<ForgeKind | null>(null);
  let items = $state<Release[]>([]);
  let page = $state(0);
  let done = $state(false);
  let loading = $state(false);
  /** Remote passt zu keinem Konto (ForgeList null). */
  let noAccount = $state(false);
  let error = $state("");
  let busy = $state(false);
  let selected = $state<Release | null>(null);
  let listW = $state(stored("git.releases", 280));

  // gen verwirft Antworten, die ein neueres reload() ueberholt hat.
  let gen = 0;

  const host = $derived(originUrl?.match(/^(?:[\w+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/)?.[1] ?? "");
  const latestId = $derived(items.find((r) => !r.draft && !r.prerelease)?.id ?? null);

  async function reload(select: Release | null = selected) {
    const g = ++gen;
    loading = true;
    error = "";
    try {
      const remotes = await git.remotes(repo);
      if (g !== gen) return;
      originUrl = remotes.find((r) => r.name === "origin")?.url ?? null;
      const res = originUrl ? await forge.releases(repo, originUrl, 1) : null;
      if (g !== gen) return;
      noAccount = !!originUrl && !res;
      kind = res?.kind ?? null;
      items = res?.items ?? [];
      page = 1;
      done = !res || res.items.length < PAGE;
      // Gespeichertes Release kann ausserhalb der ersten Seite liegen: dann den gelieferten Stand zeigen.
      // Without a (still existing) selection, preselect the newest release.
      selected = (select && (items.find((r) => r.id === select.id) ?? (select === selected ? null : select))) || (items[0] ?? null);
    } catch (e) {
      if (g === gen) error = String(e);
    } finally {
      if (g === gen) loading = false;
    }
  }

  async function loadMore() {
    if (!originUrl || done || loading) return;
    const g = gen;
    loading = true;
    try {
      const res = await forge.releases(repo, originUrl, page + 1);
      if (g !== gen) return;
      const next = res?.items ?? [];
      items = [...items, ...next.filter((r) => !items.some((o) => o.id === r.id))];
      page++;
      done = next.length < PAGE;
    } catch (e) {
      if (g === gen) error = String(e);
    } finally {
      if (g === gen) loading = false;
    }
  }

  $effect(() => {
    repo;
    refreshKey;
    untrack(() => reload());
  });

  async function run(action: () => Promise<Release | null>, fail = (e: string) => (error = e)) {
    busy = true;
    error = "";
    try {
      const r = await action();
      await reload(r);
      return true;
    } catch (e) {
      fail(String(e));
      return false;
    } finally {
      busy = false;
    }
  }

  // ---------- Download ----------

  // Asset-URL -> "laeuft" bzw. Pfad im Downloads-Ordner; zweiter Klick zeigt die Datei im Dateimanager.
  let downloads = $state<Record<string, "…" | string>>({});

  async function download(a: ReleaseAsset) {
    const d = downloads[a.url];
    if (d === "…") return;
    if (d) return invoke("reveal", { path: d }).catch(() => delete downloads[a.url]);
    if (!originUrl) return;
    downloads[a.url] = "…";
    try {
      downloads[a.url] = await forge.download(repo, originUrl, a);
    } catch (e) {
      delete downloads[a.url];
      error = String(e);
    }
  }

  // ---------- Formular ----------

  let form = $state<(ReleaseInput & { id: string | null }) | null>(null);
  let branch = $state("");
  let preview = $state(false);
  // Fehler beim Speichern im Dialog zeigen, sonst landen sie unsichtbar hinter ihm.
  let formError = $state("");
  // Ausgangsstand des Formulars: Escape/Klick daneben fragt nur nach, wenn etwas geaendert wurde.
  let formStart = "";

  function openForm(r: Release | null) {
    preview = false;
    formError = "";
    form = r
      ? { id: r.id, tag: r.tag, name: r.name, body: r.body, draft: r.draft, prerelease: r.prerelease, target: null }
      : { id: null, tag: "", name: "", body: "", draft: false, prerelease: false, target: null };
    formStart = JSON.stringify(form);
    git.status(repo).then((s) => (branch = s.branch ?? "")).catch(() => (branch = ""));
  }

  async function save() {
    if (!form || !originUrl || !form.tag.trim()) return;
    const url = originUrl;
    const { id, ...input } = form;
    const ok = await run(() =>
      forge.releaseSave(repo, url, id, {
        ...input,
        tag: input.tag.trim(),
        name: input.name.trim() || input.tag.trim(),
        target: input.target?.trim() || null,
      }),
      (e) => (formError = e),
    );
    if (ok) form = null;
  }

  async function dismissForm() {
    if (busy) return;
    if (JSON.stringify(form) === formStart || (await confirm("Änderungen am Release verwerfen?", "Verwerfen"))) form = null;
  }

  function publish(r: Release) {
    const url = originUrl!;
    run(() =>
      forge.releaseSave(repo, url, r.id, { tag: r.tag, name: r.name, body: r.body, draft: false, prerelease: r.prerelease, target: null }),
    );
  }

  let confirmDelete = $state<Release | null>(null);
  async function doDelete() {
    const r = confirmDelete;
    confirmDelete = null;
    if (!r || !originUrl) return;
    const url = originUrl;
    await run(async () => {
      await forge.releaseDelete(repo, url, r.id);
      return null;
    });
  }

  function size(n: number) {
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) (n /= 1024), i++;
    return `${i ? n.toFixed(1) : n} ${units[i]}`;
  }
</script>

<div class="flex h-full min-h-0 flex-col text-ui">
  <Notice bind:text={error} />

  {#if (!originUrl && !loading) || noAccount}
    <p class="text-muted-foreground flex items-center justify-center gap-2 px-2 py-4 text-meta">
      {#if !originUrl}Kein Remote origin.{:else}Kein GitHub-/GitLab-Konto für {host} — unter Git-Konten anmelden.{/if}
      <RefreshButton {loading} onclick={() => reload()} />
    </p>
  {:else}
    <div class="flex min-h-0 flex-1">
      <div class="border-border flex shrink-0 flex-col border-r" style="width:{listW}px; max-width:60%">
        <div class="border-border flex items-center gap-2 border-b px-2 py-1.5">
          <span class="text-muted-foreground flex-1 truncate">{host}</span>
          <RefreshButton {loading} onclick={() => reload()} />
          <Button size="xs" variant="outline" disabled={busy || !kind} onclick={() => openForm(null)}>
            <PlusIcon class="size-3" />Neues Release
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Releases">
          {#each items as r (r.id)}
            <Row
              role="option"
              aria-selected={selected?.id === r.id}
              flush
              selected={selected?.id === r.id}
              class="gap-2"
              onclick={() => (selected = r)}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-meta" title={r.name || r.tag}>{r.name || r.tag}</span>
                {#if r.name && r.name !== r.tag}
                  <span class="text-muted-foreground block truncate font-mono text-meta">{r.tag}</span>
                {/if}
              </span>
              {#if r.draft}<Badge variant="outline" class="shrink-0 text-meta">Draft</Badge>{/if}
              {#if r.prerelease}<Badge variant="outline" class="shrink-0 text-meta text-warning border-warning/40">Pre-Release</Badge>{/if}
              {#if r.id === latestId}<Badge variant="outline" class="text-primary border-primary/50 shrink-0 text-meta">Latest</Badge>{/if}
              <span class="text-muted-foreground w-10 shrink-0 text-right font-mono text-meta tabular-nums">
                {age(r.published_at ?? r.created_at)}
              </span>
            </Row>
          {/each}
          {#if loading}
            <p class="text-muted-foreground px-2 py-2 text-center text-meta">Lädt …</p>
          {:else if items.length && !done}
            <TextButton size="sm" block onclick={loadMore}>Mehr laden</TextButton>
          {/if}
        </div>
      </div>
      <Splitter bind:size={listW} min={180} key="git.releases" />
      <div class="min-w-0 flex-1 overflow-y-auto">
        {#if selected}
          {@const r = selected}
          <div class="space-y-2 px-3 py-2">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="min-w-0 flex-1 truncate text-body font-semibold">{r.name || r.tag}</h2>
              <Button size="xs" variant="ghost" onclick={() => forge.openUrl(r.web_url).catch((e) => (error = String(e)))}>
                <ExternalLinkIcon class="size-3" />Im Browser
              </Button>
              {#if kind === "github" && r.draft}
                <Button size="xs" disabled={busy} onclick={() => publish(r)}>Veröffentlichen</Button>
              {/if}
              <Button size="xs" variant="outline" disabled={busy} onclick={() => openForm(r)}>Bearbeiten</Button>
              <Button size="xs" variant="destructive" disabled={busy} onclick={() => (confirmDelete = r)}>Löschen</Button>
            </div>
            <p class="text-muted-foreground text-meta">
              {#if r.name && r.name !== r.tag}<span class="font-mono">{r.tag}</span> · {/if}{r.author} · {new Date(r.published_at ?? r.created_at).toLocaleString("de-DE")}
            </p>
            {#if r.body}
              <Markdown text={r.body} base={r.web_url} onerror={(e) => (error = e)} />
            {:else}
              <p class="text-muted-foreground text-meta italic">Keine Beschreibung.</p>
            {/if}
            {#if r.assets.length}
              <ul class="border-border space-y-0.5 border-t pt-2">
                {#each r.assets as a (a.url)}
                  {@const d = downloads[a.url]}
                  <li>
                    <Row
                      density="compact"
                      class="group gap-2 px-1"
                      title={d === "…" ? "Wird heruntergeladen …" : d ? `Im ${FILES_APP} zeigen: ${d}` : "In den Downloads-Ordner laden"}
                      onclick={() => download(a)}
                    >
                      {#if d === "…"}
                        <LoaderIcon class="text-muted-foreground size-3 shrink-0 animate-spin" />
                      {:else if d}
                        <FolderOpenIcon class="text-primary size-3 shrink-0" />
                      {:else}
                        <PackageIcon class="text-muted-foreground size-3 shrink-0 group-hover:hidden" />
                        <DownloadIcon class="text-muted-foreground hidden size-3 shrink-0 group-hover:block" />
                      {/if}
                      <span class="min-w-0 flex-1 truncate">{a.name}</span>
                      <span class="text-muted-foreground shrink-0 font-mono text-meta">{size(a.size)}</span>
                      {#if kind === "github"}
                        <span class="text-muted-foreground w-16 shrink-0 text-right font-mono text-meta">{a.downloads} ↓</span>
                      {/if}
                    </Row>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else if !loading}
          <Empty icon={PackageIcon}>
            Noch keine Releases.
            {#snippet action()}
              <Button size="sm" variant="outline" disabled={busy || !kind} onclick={() => openForm(null)}>
                <PlusIcon class="size-3" />Neues Release
              </Button>
            {/snippet}
          </Empty>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Funktions-Binding: Schliessen laesst sich so per Rueckfrage noch abbrechen -->
<Dialog.Root bind:open={() => form !== null, (v) => !v && dismissForm()}>
  <Dialog.Content class="sm:max-w-lg">
    {#if form}
      {@const lockTag = form.id !== null && kind === "gitlab"}
      <Dialog.Header>
        <Dialog.Title>{form.id ? "Release bearbeiten" : "Neues Release"}</Dialog.Title>
      </Dialog.Header>
      <div class="space-y-2 text-ui">
        <label class="block space-y-1">
          <span class="text-muted-foreground">Tag</span>
          <Input bind:value={form.tag} placeholder="v1.0.0" disabled={lockTag} autofocus />
        </label>
        {#if !lockTag}
          <label class="block space-y-1">
            <span class="text-muted-foreground">Ziel, falls der Tag noch nicht existiert (Branch oder SHA)</span>
            <Input bind:value={form.target} placeholder={branch || "HEAD"} />
          </label>
        {/if}
        <label class="block space-y-1">
          <span class="text-muted-foreground">Name</span>
          <Input bind:value={form.name} placeholder={form.tag || "Name"} />
        </label>
        <div class="space-y-1">
          <div class="flex items-center">
            <label for="release-body" class="text-muted-foreground flex-1">Beschreibung (Markdown)</label>
            <TextButton size="sm" onclick={() => (preview = !preview)}>{preview ? "Bearbeiten" : "Vorschau"}</TextButton>
          </div>
          {#if preview}
            <div class="border-input h-[212px] overflow-y-auto rounded-md border px-3 py-2">
              {#if form.body.trim()}
                <Markdown text={form.body} onerror={(e) => (error = e)} />
              {:else}
                <p class="text-muted-foreground text-meta italic">Keine Beschreibung.</p>
              {/if}
            </div>
          {:else}
            <Textarea id="release-body" bind:value={form.body} rows={10} density="xs" class="font-mono" />
          {/if}
        </div>
        {#if kind === "github"}
          <div class="flex gap-4">
            <Checkbox bind:checked={form.draft}>Draft</Checkbox>
            <Checkbox bind:checked={form.prerelease}>Pre-Release</Checkbox>
          </div>
        {/if}
      </div>
      {#if formError}<p class="text-destructive text-ui whitespace-pre-wrap">{formError}</p>{/if}
      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onclick={() => (form = null)}>Abbrechen</Button>
        <Button size="sm" disabled={busy || !form.tag.trim()} onclick={save}>{busy ? "Speichert …" : "Speichern"}</Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  open={confirmDelete !== null}
  title="Release löschen"
  message={confirmDelete ? `Release „${confirmDelete.name || confirmDelete.tag}“ löschen? Der Git-Tag ${confirmDelete.tag} bleibt erhalten.` : ""}
  action="Löschen"
  onconfirm={doDelete}
  oncancel={() => (confirmDelete = null)}
/>
