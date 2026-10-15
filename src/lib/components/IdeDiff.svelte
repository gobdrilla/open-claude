<script lang="ts">
  // Vorgeschlagene Aenderung von Claude (IDE-Protokoll, openDiff): annehmen schreibt claude selbst, nicht wir.
  // Schliessen = ablehnen; claude wartet so lange, die Rueckfrage im Terminal gilt parallel.
  import { Button } from "$lib/components/ui/button/index.js";
  import { DiffDialog } from "$lib/components/kit";
  import { fs } from "$lib/files";
  import { Input } from "$lib/components/ui/input/index.js";
  import { blocked, claudeTarget, decide, ide, rel, sendToClaude, type IdeDiff } from "$lib/ide.svelte";

  const d = $derived(ide.diffs[0]);
  let diff = $state<string | null>(null);
  let error = $state("");
  let reason = $state("");

  $effect(() => {
    const cur = d;
    diff = null;
    error = "";
    reason = "";
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

  // Ablehnen bleibt DIFF_REJECTED; ein Grund geht danach als Prompt-Text an Claude.
  async function reject(cur: IdeDiff) {
    const why = reason.trim();
    decide(cur, false);
    if (!why) return;
    // Bis claude die Ablehnung verarbeitet hat, steht die Freigabe noch offen und sendToClaude wuerde abweisen.
    const id = claudeTarget.find(cur.repo);
    for (let i = 0; id && i < 20 && (await blocked(id)); i++) await new Promise((r) => setTimeout(r, 250));
    const text = `Abgelehnt (${rel(cur.repo, cur.path)}): ${why}`;
    // Nicht angekommen (weitere Freigabe offen, keine Sitzung): Grund nicht verlieren
    if (!(await sendToClaude(cur.repo, text))) ide.notice = `Grund nicht gesendet – ${text}`;
  }
</script>

{#if d}
  <DiffDialog
    diff={diff ?? ""}
    title="Änderung von Claude"
    description={rel(d.repo, d.path) + (ide.diffs.length > 1 ? ` · noch ${ide.diffs.length - 1} weitere` : "")}
    empty={error || (diff === null ? "Lädt …" : "Keine Änderung")}
    onclose={() => reject(d)}
  >
    <span class="ml-auto flex shrink-0 gap-1.5">
      <Input
        bind:value={reason}
        placeholder="Grund (optional)"
        class="h-8 w-48 text-xs"
        onkeydown={(e) => e.key === "Enter" && reason.trim() && reject(d)}
      />
      <Button variant="outline" size="sm" onclick={() => reject(d)}>Ablehnen</Button>
      <Button size="sm" onclick={() => decide(d, true)}>Annehmen</Button>
    </span>
  </DiffDialog>
{/if}
