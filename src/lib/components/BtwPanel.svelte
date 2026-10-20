<script lang="ts" module>
  type Q = { q: string; a?: string; err?: string };
  // Je Terminal-id; im Modul, damit Verlauf und laufende Fragen Tab-Wechsel und Remount ueberleben.
  const history = $state<Record<string, Q[]>>({});
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Empty } from "$lib/components/kit";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import Markdown from "$lib/components/Markdown.svelte";

  let { cwd, id, sid }: { cwd: string; id: string; sid: string | null } = $props();

  let text = $state("");
  const list = $derived(history[id] ?? []);

  async function ask() {
    const q = text.trim();
    if (!q || !sid) return;
    text = "";
    const item: Q = { q };
    (history[id] ??= []).push(item);
    // Ueber den Proxy im Array schreiben, sonst merkt Svelte die Antwort nicht.
    const it = history[id].at(-1)!;
    try {
      it.a = await invoke<string>("claude_btw", { id, cwd, sid, question: q });
    } catch (e) {
      it.err = String(e);
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    ask();
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
    {#each [...list].reverse() as x, i (list.length - i)}
      <section class="border-border/60 mb-2 rounded-lg border px-2 py-1.5">
        <div class="text-muted-foreground mb-1 break-words whitespace-pre-wrap">{x.q}</div>
        {#if x.err}
          <p class="text-destructive break-words">{x.err}</p>
        {:else if x.a === undefined}
          <p class="text-muted-foreground animate-pulse">Claude denkt nach …</p>
        {:else}
          <div class="min-w-0 overflow-x-auto"><Markdown text={x.a} /></div>
        {/if}
      </section>
    {:else}
      <Empty>Nebenfrage zur laufenden Session, ohne sie zu unterbrechen. Claude kann dabei nur lesen.</Empty>
    {/each}
  </div>
  <div class="border-border shrink-0 border-t p-2">
    <Textarea
      bind:value={text}
      rows={2}
      disabled={!sid}
      placeholder={sid ? "Nebenfrage … (Enter senden, Shift+Enter neue Zeile)" : "Keine laufende Claude-Session"}
      class="text-xs md:text-xs"
      onkeydown={keydown}
    />
  </div>
</div>
