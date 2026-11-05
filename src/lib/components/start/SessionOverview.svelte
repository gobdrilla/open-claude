<script lang="ts" module>
  import type { TabState } from "$lib/claudemode";

  // Subset of the mod's session panel (claude_panel), see src-tauri/mods/atelier/types/index.d.ts.
  export type Panel = {
    context?: { tokens: number | null; window: number; percent: number | null };
    active?: { tool: string; target: string; state: string }[];
    todos?: { content: string; status: string }[];
    limits?: { kind: string; percentUsed: number; resetsAt?: string }[];
    busy?: boolean;
    waiting?: boolean;
    waitingFor?: { tool: string; summary: string } | null;
  };
  export type SessionItem = { id: string; name: string; state: TabState; panel?: Panel | null };
</script>

<script lang="ts">
  import { Button } from "$lib/atelier-ui";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-question-mark";
  import { t } from "$lib/i18n";

  // Start page: sessions waiting for the user (running sessions are the tabs at the top). Hidden when empty.
  let { items, onopen }: { items: SessionItem[]; onopen: (id: string) => void } = $props();

  const waiting = $derived(items.filter((i) => i.state === "ask"));
  const head = "text-meta mb-1.5 flex items-baseline gap-1.5 font-semibold tracking-wide uppercase";
</script>

{#if waiting.length}
  <section aria-label={t("Wartet auf dich")} class="px-3 pt-3">
    <h2 class="{head} text-warning">{t("Wartet auf dich")} <span class="text-muted-foreground font-normal">{waiting.length}</span></h2>
    <div class="flex flex-col gap-1.5">
      {#each waiting as it (it.id)}
        {@const w = it.panel?.waitingFor}
        <div class="border-warning/40 bg-warning/10 flex h-10 items-center gap-2.5 rounded-lg border pr-1.5 pl-3">
          <CircleHelpIcon class="text-warning size-4 shrink-0" />
          <span class="text-body shrink-0 font-semibold">{it.name}</span>
          <span class="text-body text-foreground/85 shrink-0">{w ? t("Claude fragt: {tool}", { tool: w.tool }) : t("Claude wartet auf dich")}</span>
          {#if w?.summary}<span class="text-meta text-muted-foreground min-w-0 truncate font-mono" title={w.summary}>{w.summary}</span>{/if}
          <span class="flex-1"></span>
          <Button variant="secondary" size="sm" onclick={() => onopen(it.id)}>{t("Öffnen")}</Button>
        </div>
      {/each}
    </div>
  </section>
{/if}

