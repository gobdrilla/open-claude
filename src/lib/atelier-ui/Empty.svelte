<script lang="ts">
  import type { Snippet } from "svelte";
  import type XIcon from "@lucide/svelte/icons/x";

  // children: the one sentence; action: usually one Button; hint: e.g. a shortcut ("Strg+P").
  let {
    children,
    icon: Icon,
    action,
    hint,
  }: { children: Snippet; icon?: typeof XIcon; action?: Snippet; hint?: string } = $props();
</script>

<div class="text-muted-foreground text-body grid h-full place-items-center p-4 text-center">
  <div class="flex max-w-sm flex-col items-center gap-2">
    {#if Icon}<Icon class="text-muted-foreground/50 size-6" />{/if}
    <div>{@render children()}</div>
    {#if action}<div class="mt-1">{@render action()}</div>{/if}
    {#if hint}<div class="text-meta text-muted-foreground/80 font-mono">{hint}</div>{/if}
  </div>
</div>
