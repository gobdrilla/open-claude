<script lang="ts" module>
  type Q = { q: string; a?: string; err?: string };
  // Je Terminal-id; im Modul, damit Verlauf und laufende Fragen Tab-Wechsel und Remount ueberleben.
  const history = $state<Record<string, Q[]>>({});
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { Button, IconButton, Textarea } from "$lib/atelier-ui";
  import Markdown from "$lib/components/Markdown.svelte";

  // Composer at the bottom of the activity panel: always reachable, answers stack above it.
  let { cwd, id, sid }: { cwd: string; id: string; sid: string | null } = $props();

  let text = $state("");
  const list = $derived(history[id] ?? []);

  async function ask() {
    const q = text.trim();
    if (!q || !sid) return;
    text = "";
    const item: Q = { q };
    // Not `(history[id] ??= []).push`: that pushes into the raw array, the proxy never sees the first question.
    history[id] ??= [];
    history[id].push(item);
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

<div class="border-border shrink-0 border-t p-2">
  {#if list.length}
    <!-- flex-col-reverse keeps the scroll pinned to the newest answer, right above the field. -->
    <div class="mb-2 flex max-h-64 flex-col-reverse gap-2 overflow-x-hidden overflow-y-auto">
      {#each [...list].reverse() as x, i (list.length - i)}
        <section class="border-border/60 shrink-0 rounded-lg border px-2 py-1.5">
          <div class="text-muted-foreground mb-1 break-words whitespace-pre-wrap">{x.q}</div>
          {#if x.err}
            <p class="text-destructive break-words">{x.err}</p>
          {:else if x.a === undefined}
            <p class="text-muted-foreground animate-pulse">Claude denkt nach …</p>
          {:else}
            <div class="min-w-0 overflow-x-auto"><Markdown text={x.a} /></div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
  <div class="mb-1 flex items-center gap-2">
    <label for="btw-{id}" class="text-meta text-muted-foreground min-w-0 flex-1 truncate" title="Claude kann dabei nur lesen."
      >Nebenfrage an Claude (läuft parallel, stört die Sitzung nicht)</label
    >
    {#if list.length}<IconButton size="xs" label="Antworten ausblenden" onclick={() => (history[id] = [])}>✕</IconButton>{/if}
  </div>
  <div class="flex items-end gap-1.5">
    <Textarea
      id="btw-{id}"
      bind:value={text}
      rows={1}
      disabled={!sid}
      placeholder={sid ? "Frage … (Enter sendet)" : "Keine laufende Claude-Sitzung"}
      title="Enter sendet, Umschalt+Enter neue Zeile"
      density="sm"
      class="max-h-32 min-h-7 py-1"
      onkeydown={keydown}
    />
    <Button size="sm" disabled={!sid || !text.trim()} onclick={ask}>Fragen</Button>
  </div>
</div>
