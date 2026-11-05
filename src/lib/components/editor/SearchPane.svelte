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
  import { ContextItem, Empty, IconButton, Input as TextInput, Row, fileIcon, menuContent, paneBar } from "$lib/atelier-ui";
  import { ContextMenu } from "bits-ui";
  import { sendToClaude } from "$lib/ide.svelte";
  import SearchIcon from "@lucide/svelte/icons/search";
  import { fs, type Hit } from "$lib/files";
  import { open } from "$lib/editor.svelte";
  import { MOD, SHIFT, atRef } from "$lib/editor.logic";
  import { t } from "$lib/i18n";

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

  // Treffer in der (getrimmten) Zeile finden und etwas Kontext davor behalten, damit er
  // im schmalen Panel nicht hinter dem Abschneiden verschwindet.
  const LEAD = 12;
  function snippet(text: string): [string, string, string] {
    let at = -1;
    let len = 0;
    try {
      if (s.regex) {
        const m = new RegExp(s.q, s.caseSensitive ? "" : "i").exec(text);
        if (m) [at, len] = [m.index, m[0].length];
      } else {
        at = s.caseSensitive ? text.indexOf(s.q) : text.toLowerCase().indexOf(s.q.toLowerCase());
        len = s.q.length;
      }
    } catch {
      /* ungueltiger Ausdruck: ganze Zeile zeigen */
    }
    if (at < 0) return [text, "", ""];
    const from = at > LEAD ? at - LEAD : 0;
    return [(from ? "…" : "") + text.slice(from, at), text.slice(at, at + len), text.slice(at + len)];
  }

  // Ohne Object.groupBy: das fehlt in aelteren WebKitGTK (Linux-Distros mit WebKitGTK < 2.44).
  const groups = $derived.by(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m];
  });
</script>

{#snippet flag(label: string, title: string, on: boolean, set: (v: boolean) => void)}
  <IconButton
    size="text"
    pressed={on}
    label={title}
    onclick={() => set(!on)}>{label}</IconButton
  >
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui">
  <div class={paneBar}>
    <TextInput
      density="xs"
      class="min-w-0 flex-1"
      placeholder={t("In Dateien suchen …")}
      aria-label={t("In Dateien suchen")}
      data-search
      spellcheck={false}
      bind:value={s.q}
    />
    {@render flag("Aa", t("Groß-/Kleinschreibung beachten"), s.caseSensitive, (v) => (s.caseSensitive = v))}
    {@render flag(".*", t("Regulärer Ausdruck"), s.regex, (v) => (s.regex = v))}
  </div>
  <Notice bind:text={error} timeout={0} />
  {#if !s.q || !hits.length}
    <Empty icon={SearchIcon} hint={s.q ? undefined : `${MOD}+${SHIFT}+F`}>{busy ? t("Suche …") : s.q ? t("Keine Treffer.") : t("Suchbegriff eingeben.")}</Empty>
  {:else}
    <div class="text-muted-foreground px-2 py-0.5 text-meta" role="status">
      {t("{n} Treffer in {files} Dateien", { n: hits.length >= 2000 ? t("Über 2000") : hits.length, files: groups.length })}
    </div>
    <ul class="min-h-0 flex-1 overflow-y-auto pb-1" aria-label={t("Suchergebnisse")}>
      {#each groups as [path, list] (path)}
        {@const ic = fileIcon(path)}
        <li>
          <div class="flex items-center gap-1.5 px-2 py-0.5 font-medium" title={path}>
            <ic.icon class="size-3.5 shrink-0 {ic.tint}" />
            <span class="truncate">{path}</span>
            <span class="text-muted-foreground ml-auto text-meta">{list.length}</span>
          </div>
          {#each list as h (h.line)}
            {@const [pre, hit, post] = snippet(h.text)}
            <ContextMenu.Root>
              <ContextMenu.Trigger>
                <Row flush density="compact" text="md" class="items-baseline gap-2 pr-2 pl-7" onclick={() => open(repo, path, h.line, h.col)}>
                  <span class="text-muted-foreground w-10 shrink-0 text-right font-mono text-meta tabular-nums">{h.line}</span>
                  <span class="truncate font-mono text-meta whitespace-pre">{pre}<mark class="bg-primary/20 text-foreground rounded-sm">{hit}</mark>{post}</span>
                </Row>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content class={menuContent}>
                  <ContextItem label={t("An Claude")} onSelect={() => sendToClaude(repo, atRef(path, `#L${h.line}`))} />
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          {/each}
        </li>
      {/each}
    </ul>
  {/if}
</div>
