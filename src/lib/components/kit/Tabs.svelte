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
    tabs: { id: T; label: string; count?: number; title?: string }[];
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
  <div class="border-border flex items-center gap-1 border-b px-2" role="tablist">
    {#each tabs as t (t.id)}
      <button
        role="tab"
        aria-selected={value === t.id}
        title={t.title}
        class="-mb-px border-b-2 px-2 {dense ? 'py-1 text-[11px]' : 'py-1.5'} {value === t.id
          ? 'border-primary text-foreground'
          : 'text-muted-foreground hover:text-foreground border-transparent'}"
        onclick={() => (value = t.id)}
        >{t.label}{#if t.count}<span class="text-muted-foreground ml-1.5 tabular-nums">{t.count}</span>{/if}</button
      >
    {/each}
    {@render children?.()}
  </div>
{/if}
