<script lang="ts" module>
  // Eingabe je Projekt auf Modulebene: das Dock baut das Panel bei jedem Tabwechsel neu auf.
  type Input = { q: string; regex: boolean; caseSensitive: boolean };
  const inputs = new Map<string, Input>();
  function input(repo: string): Input {
    if (!inputs.has(repo)) {
      const i = $state({ q: "", regex: false, caseSensitive: false });
      inputs.set(repo, i);
    }
    return inputs.get(repo)!;
  }
</script>

<script lang="ts">
  // Suche ueber alle Projektdateien (fs_search). Klick springt zur Fundstelle.
  import Notice from "$lib/components/Notice.svelte";
  import { ContextItem, Empty, fileIcon, menuContent, paneBar } from "$lib/components/kit";
  import { ContextMenu } from "bits-ui";
  import { sendToClaude } from "$lib/ide.svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { fs, type Hit } from "$lib/files";
  import { open } from "$lib/editor.svelte";
  import { MOD, atRef } from "$lib/editor.logic";

  let { repo }: { repo: string } = $props();

  const s = $derived(input(repo));
  let hits = $state<Hit[]>([]);
  let error = $state("");
  let busy = $state(false);

  $effect(() => {
    const { q, regex, caseSensitive } = s;
    if (!q) return void ((hits = []), (busy = false));
    // Schon beim Tippen: sonst blitzt im Debounce "Keine Treffer." auf.
    busy = true;
    let stale = false;
    const t = setTimeout(() => {
      fs.search(repo, q, regex, caseSensitive).then(
        (h) => !stale && ((hits = h), (error = "")),
        (e) => !stale && ((hits = []), (error = String(e))),
      ).finally(() => !stale && (busy = false));
    }, 300);
    return () => ((stale = true), clearTimeout(t));
  });

  // Ohne Object.groupBy: das fehlt in aelteren WebKitGTK (Linux-Distros mit WebKitGTK < 2.44).
  const groups = $derived.by(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  });
</script>

{#snippet flag(label: string, title: string, on: boolean, set: (v: boolean) => void)}
  <button
    class="shrink-0 rounded px-1 font-mono text-[11px] {on ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'}"
    {title}
    aria-pressed={on}
    onclick={() => set(!on)}>{label}</button
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col text-xs">
  <div class={paneBar}>
    <input
      class="border-input bg-background min-w-0 flex-1 rounded border px-1.5 py-0.5 text-[11px] outline-none"
      placeholder="In Dateien suchen …"
      aria-label="In Dateien suchen"
      data-search
      spellcheck={false}
      bind:value={s.q}
    />
    {@render flag("Aa", "Groß-/Kleinschreibung beachten", s.caseSensitive, (v) => (s.caseSensitive = v))}
    {@render flag(".*", "Regulärer Ausdruck", s.regex, (v) => (s.regex = v))}
  </div>
  <Notice bind:text={error} timeout={0} />
  {#if !s.q || !hits.length}
    <Empty icon={SearchIcon}>{busy ? "Suche …" : s.q ? "Keine Treffer." : `Suchbegriff eingeben (${MOD}+Umschalt+F).`}</Empty>
  {:else}
    <div class="text-muted-foreground px-2 py-0.5 text-[10px]" role="status">
      {hits.length >= 2000 ? "Über 2000" : hits.length} Treffer in {groups.length} Dateien
    </div>
    <ul class="min-h-0 flex-1 overflow-y-auto pb-1" aria-label="Suchergebnisse">
      {#each groups as [path, list] (path)}
        {@const ic = fileIcon(path)}
        <li>
          <div class="flex items-center gap-1.5 px-2 py-0.5 font-medium" title={path}>
            <ic.icon class="size-3.5 shrink-0 {ic.tint}" />
            <span class="truncate">{path}</span>
            <span class="text-muted-foreground ml-auto text-[10px]">{list.length}</span>
          </div>
          {#each list as h (h.line)}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <button
                  class="hover:bg-accent flex w-full items-baseline gap-2 py-0.5 pr-2 pl-7 text-left"
                  onclick={() => open(repo, path, h.line, h.col)}
                >
                  <span class="text-muted-foreground w-8 shrink-0 text-right font-mono text-[10px]">{h.line}</span>
                  <span class="truncate font-mono text-[11px]">{h.text}</span>
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content class={menuContent}>
                  <ContextItem label="An Claude" onSelect={() => sendToClaude(repo, atRef(path, `#L${h.line}`))} />
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
</div>
