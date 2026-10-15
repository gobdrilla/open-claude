<script lang="ts">
  // Probleme: Befunde der Language-Server ueber alle Dateien des Projekts. Klick springt hin, "An Claude" erwaehnt die Zeilen.
  // Haelt keinen Zustand: die Befunde liegen in $lib/lsp.svelte.
  import { Empty } from "$lib/components/kit";
  import { Button } from "$lib/components/ui/button/index.js";
  import AtSignIcon from "@lucide/svelte/icons/at-sign";
  import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import InfoIcon from "@lucide/svelte/icons/info";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { allowLsp, editor, open } from "$lib/editor.svelte";
  import { mentionLines } from "$lib/ide.svelte";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import { lsp, scanProject } from "$lib/lsp.svelte";
  import { problems, SCAN_MAX } from "$lib/lsp.logic";

  let { repo }: { repo: string } = $props();

  const list = $derived(problems(lsp.diags, repo));
  const scan = $derived(lsp.scan[repo]);

  // Sichtbar: ganzes Projekt pruefen lassen (einmal je Projekt, danach haelt der Platten-Abgleich es aktuell).
  $effect(() => {
    if (editor(repo).lsp && !lsp.scan[repo]) void scanProject(repo);
  });
</script>

<div class="flex h-full min-h-0 flex-col">
{#if scan?.busy || scan?.capped}
  <p class="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[11px]" role="status">
    {#if scan.busy}<LoaderIcon class="size-3 animate-spin" /> Prüfe das ganze Projekt …
    {:else}Nur die ersten {SCAN_MAX} Dateien geprüft, {scan.capped} weitere nicht.{/if}
  </p>
{/if}

{#if !editor(repo).lsp}
  <!-- Einziger Rueckweg nach "Nicht fuer dieses Projekt" im Datei-Banner. -->
  <Empty icon={CircleAlertIcon}>
    Language-Server sind aus. Sie führen Projektcode aus.
    <div class="mt-2"><Button size="xs" variant="outline" onclick={() => allowLsp(repo)}>Aktivieren</Button></div>
  </Empty>
{:else if !list.length}
  <Empty icon={CircleAlertIcon}>{scan?.busy ? "Noch keine Probleme gefunden." : "Keine Probleme im Projekt."}</Empty>
{:else}
  <ul class="min-h-0 flex-1 overflow-y-auto py-0.5 text-xs" aria-label="Probleme">
    {#each list as { path, d }, i (i)}
      {@const line = d.range.start.line}
      <li class="group hover:bg-accent flex items-center gap-1.5 pr-1 pl-2">
        {#if (d.severity ?? 1) === 1}<CircleXIcon class="text-destructive size-3.5 shrink-0" />
        {:else if d.severity === 2}<TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        {:else}<InfoIcon class="text-muted-foreground size-3.5 shrink-0" />{/if}
        <button class="flex min-w-0 flex-1 items-baseline gap-2 py-0.5 text-left" title={d.message} onclick={() => open(repo, path, line + 1)}>
          <span class="truncate">{d.message}</span>
          <span class="text-muted-foreground shrink-0 font-mono text-[10px]">{path}:{line + 1}</span>
        </button>
        <Button
          variant="ghost"
          size="xs"
          class="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title="Zeilen als @-Erwähnung an Claude"
          onclick={() => mentionLines(repo, path, line, d.range.end.line)}><AtSignIcon /> An Claude</Button
        >
      </li>
    {/each}
  </ul>
{/if}
</div>
