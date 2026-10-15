<script lang="ts" generics="T extends string">
  import type { Snippet } from "svelte";

  // Unterstrich-Tabs (pill: Segment-Pillen); children = Bereich rechts
  let {
    tabs,
    value = $bindable(),
    dense = false,
    pill = false,
    children,
  }: {
    /** live: davon laufen gerade so viele (pulsierender Punkt, "live/count"). */
    tabs: { id: T; label: string; count?: number; live?: number; title?: string }[];
    value: T;
    dense?: boolean;
    pill?: boolean;
    children?: Snippet;
  } = $props();
</script>

{#if pill}
  <div class="flex items-center gap-1 px-2 pt-2 pb-1" role="tablist">
    {#each tabs as t (t.id)}
      <button
        role="tab"
        aria-selected={value === t.id}
        title={t.title}
        class="flex h-7 items-center rounded-full px-3 transition-colors {value === t.id
          ? 'bg-primary/15 text-foreground ring-primary/30 ring-1'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
        onclick={() => (value = t.id)}
        >{t.label}{#if t.count}<span
            class="ml-1.5 rounded-full px-1.5 text-[10px] tabular-nums {value === t.id
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-muted-foreground'}">{t.count}</span
          >{/if}</button
      >
    {/each}
    {@render children?.()}
  </div>
{:else}
  <!-- Zu schmal: Tabs scrollen in ihrer Leiste (ohne Balken). Sonst schob der Fokus eines verdeckten Tabs das ganze Panel zur Seite. -->
  <div class="flex items-center gap-1 px-2 shadow-[inset_0_-1px_0_var(--border)]">
    <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
    {#each tabs as t (t.id)}
      <button
        role="tab"
        aria-selected={value === t.id}
        title={t.title}
        class="shrink-0 border-b-2 px-2 whitespace-nowrap {dense ? 'py-1 text-[11px]' : 'py-1.5'} {value === t.id
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent'}"
        onclick={() => (value = t.id)}
        >{#if t.live}<span class="bg-primary mr-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle"></span>{/if}{t.label}{#if t.live}<span
            class="text-primary ml-1.5 tabular-nums"
            title="{t.live} laufen">{t.live}<span class="text-muted-foreground">/{t.count}</span></span
          >{:else if t.count}<span class="text-muted-foreground ml-1.5 tabular-nums">{t.count}</span>{/if}</button
      >
    {/each}
    </div>
    {@render children?.()}
  </div>
{/if}
