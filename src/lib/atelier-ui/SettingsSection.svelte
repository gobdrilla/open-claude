<script lang="ts">
  import type { Snippet } from "svelte";

  // Heading + a framed group of SettingRows (other blocks may sit between them).
  let { title, children }: { title: string; children: Snippet } = $props();
</script>

<section>
  <h3 class="text-muted-foreground text-meta mb-1 font-medium tracking-wide uppercase">{title}</h3>
  <div class="border-border/60 divide-foreground/5 divide-y rounded-lg border">
    {@render children()}
  </div>
</section>
