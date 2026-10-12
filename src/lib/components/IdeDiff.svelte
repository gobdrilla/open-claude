<script lang="ts">
  // Vorgeschlagene Aenderung von Claude (IDE-Protokoll, openDiff): annehmen schreibt claude selbst, nicht wir.
  // Schliessen = ablehnen; claude wartet so lange, die Rueckfrage im Terminal gilt parallel.
  import { Button } from "$lib/components/ui/button/index.js";
  import { DiffDialog } from "$lib/components/kit";
  import { fs } from "$lib/files";
  import { decide, ide, rel } from "$lib/ide.svelte";

  const d = $derived(ide.diffs[0]);
  let diff = $state<string | null>(null);
  let error = $state("");

  $effect(() => {
    const cur = d;
    diff = null;
    error = "";
    if (!cur) return;
    fs.diff(cur.repo, rel(cur.repo, cur.path), cur.content).then(
      (t) => cur === d && (diff = t),
      (e) => {
        if (cur !== d) return;
        error = String(e);
        diff = "";
      },
    );
  });
</script>

{#if d}
  <DiffDialog
    diff={diff ?? ""}
    title="Änderung von Claude"
    description={rel(d.repo, d.path) + (ide.diffs.length > 1 ? ` · noch ${ide.diffs.length - 1} weitere` : "")}
    empty={error || (diff === null ? "Lädt …" : "Keine Änderung")}
    onclose={() => decide(d, false)}
  >
    <span class="ml-auto flex shrink-0 gap-1.5">
      <Button variant="outline" size="sm" onclick={() => decide(d, false)}>Ablehnen</Button>
      <Button size="sm" onclick={() => decide(d, true)}>Annehmen</Button>
    </span>
  </DiffDialog>
{/if}
