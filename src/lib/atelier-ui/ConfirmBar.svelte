<script lang="ts">
  import { t } from "$lib/i18n";
  import { slide } from "svelte/transition";
  import type { Asker } from "$lib/confirm.svelte";
  import { Button } from "./primitives/button/index.js";

  // Rueckfrage als Leiste im offenen Dialog (siehe Asker). Schliesst sich der Dialog, gilt sie als abgelehnt.
  let { asker, class: className = "" }: { asker: Asker; class?: string } = $props();

  $effect(() => () => asker.q?.done(false));
</script>

{#if asker.q}
  {@const q = asker.q}
  <div
    transition:slide={{ duration: 120 }}
    role="alertdialog"
    class="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-ui {q.tone !== 'default'
      ? 'bg-destructive/10'
      : 'bg-primary/10'} {className}"
  >
    <div class="min-w-48 flex-1">
      {#if q.title}<p class="font-semibold">{q.title}</p>{/if}
      {#if q.message}<p class="whitespace-pre-line">{q.message}</p>{/if}
      {#each q.items ?? [] as it (it.name)}
        <p><span class="font-medium">{it.name}</span> <span class="text-muted-foreground">{it.detail}</span></p>
      {/each}
    </div>
    <span class="ml-auto flex shrink-0 gap-1.5">
      <Button variant="ghost" size="sm" onclick={() => q.done(false)}>{t("Abbrechen")}</Button>
      <Button variant={q.tone === "default" ? "default" : "destructive"} size="sm" onclick={() => q.done(true)}>{q.action}</Button>
    </span>
  </div>
{/if}
