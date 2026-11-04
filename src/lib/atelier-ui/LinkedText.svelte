<script lang="ts">
  import { segments, type Link } from "$lib/extensions.logic";

  // Plain text with some ranges as links. No own onclick: the global handler in +page.svelte opens http(s) in the system browser.
  let { text, links }: { text: string; links: Link[] } = $props();
  const parts = $derived(links.length ? segments(text, links) : [{ text }]);
</script>

{#each parts as p, i (i)}{#if p.url}<a href={p.url} title={p.url} class="text-primary underline-offset-2 hover:underline">{p.text}</a>{:else}{p.text}{/if}{/each}
