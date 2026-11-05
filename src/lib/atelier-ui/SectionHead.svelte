<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, mono = false, children }: { title: string; mono?: boolean; children?: Snippet } = $props();
</script>

<!-- bg-muted, not bg-chrome: the title bar colour stood out almost black inside dialogs. -->
<div class="bg-muted/60 border-border flex items-center gap-3 border-y px-3 py-1.5">
  <span class="flex-1 truncate text-meta font-semibold {mono ? 'font-mono' : ''}">{title}</span>
  {@render children?.()}
</div>
