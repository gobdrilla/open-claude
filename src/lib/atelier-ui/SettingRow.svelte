<script lang="ts">
  import type { Snippet } from "svelte";

  // One setting: label + optional description left, the control (children) right.
  let { label, description, children }: { label: string; description?: string; children: Snippet } = $props();
</script>

<div class="flex min-h-9 items-center gap-3 px-2 py-1.5">
  <div class="min-w-0 flex-1">
    <div class="text-ui">{label}</div>
    {#if description}<div class="text-muted-foreground text-meta">{description}</div>{/if}
  </div>
  {@render children()}
</div>
