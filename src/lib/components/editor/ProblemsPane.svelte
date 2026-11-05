<script lang="ts">
  // Probleme: Befunde der Language-Server ueber alle Dateien des Projekts. Klick springt hin, "An Claude" erwaehnt die Zeilen.
  // Haelt keinen Zustand: die Befunde liegen in $lib/lsp.svelte.
  import { Button, Empty, TextButton } from "$lib/atelier-ui";
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
  import { t } from "$lib/i18n";

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
  <p class="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-meta" role="status">
    {#if scan.busy}<LoaderIcon class="size-3 animate-spin" /> {t("Prüfe das ganze Projekt …")}
    {:else}{t("Nur die ersten {max} Dateien geprüft, {more} weitere nicht.", { max: SCAN_MAX, more: scan.capped })}{/if}
  </p>
{/if}

{#if !editor(repo).lsp}
  <!-- Einziger Rueckweg nach "Nicht fuer dieses Projekt" im Datei-Banner. -->
  <Empty icon={CircleAlertIcon}>
    {t("Language-Server sind aus. Sie führen Projektcode aus.")}
    {#snippet action()}<Button size="xs" variant="outline" onclick={() => allowLsp(repo)}>{t("Aktivieren")}</Button>{/snippet}
  </Empty>
{:else if !list.length}
  <Empty icon={CircleAlertIcon}>{scan?.busy ? t("Noch keine Probleme gefunden.") : t("Keine Probleme im Projekt.")}</Empty>
{:else}
  <ul class="min-h-0 flex-1 overflow-y-auto py-0.5 text-ui" aria-label={t("Probleme")}>
    {#each list as { path, d }, i (i)}
      {@const line = d.range.start.line}
      <li class="group hover:bg-accent flex items-center gap-1.5 pr-1 pl-2">
        {#if (d.severity ?? 1) === 1}<CircleXIcon class="text-destructive size-3.5 shrink-0" />
        {:else if d.severity === 2}<TriangleAlertIcon class="text-warning size-3.5 shrink-0" />
        {:else}<InfoIcon class="text-muted-foreground size-3.5 shrink-0" />{/if}
        <TextButton tone="plain" class="min-w-0 flex-1 items-baseline gap-2 py-0.5" title={d.message} onclick={() => open(repo, path, line + 1)}>
          <span class="truncate">{d.message}</span>
          <span class="text-muted-foreground shrink-0 font-mono text-meta">{path}:{line + 1}</span>
        </TextButton>
        <Button
          variant="quiet"
          size="xs"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          title={t("Zeilen als @-Erwähnung an Claude")}
          onclick={() => mentionLines(repo, path, line, d.range.end.line)}><AtSignIcon /> {t("An Claude")}</Button
        >
      </li>
    {/each}
  </ul>
{/if}
</div>
