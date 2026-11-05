<script lang="ts" module>
  import type { TestReport, UnityTestMode } from "$lib/unity";

  // Lauf und Bericht je Projekt auf Modulebene: die Ansicht wird beim Wechsel abgebaut, der Lauf geht weiter.
  type Tests = { running: UnityTestMode | null; report: TestReport | null; error: string };
  const runs = new Map<string, Tests>();
  function tests(repo: string): Tests {
    if (!runs.has(repo)) {
      const t = $state<Tests>({ running: null, report: null, error: "" });
      runs.set(repo, t);
    }
    return runs.get(repo)!;
  }
</script>

<script lang="ts">
  import Notice from "$lib/components/Notice.svelte";
  import { Button, Empty, RefreshButton } from "$lib/atelier-ui";
  import { untrack } from "svelte";
  import UnityCloseDialog from "./UnityCloseDialog.svelte";
  import { unity, verdict, formatDuration, type UnityInfo } from "$lib/unity";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { t } from "$lib/i18n";

  let { repo }: { repo: string } = $props();

  let info = $state<UnityInfo | null>(null);
  let loading = $state(true);
  let error = $state("");
  /** Fehler von unity.info: bleibt im leeren Panel stehen, auch wenn die Notice error leert. */
  let failed = $state("");

  async function reload() {
    loading = true;
    error = "";
    try {
      info = await unity.info(repo);
      failed = "";
    } catch (e) {
      error = failed = String(e);
    }
    loading = false;
  }

  // Neu laden, wenn ein anderes Repo in denselben Tab wechselt (die Git-Ansicht wird pro Repo neu erzeugt,
  // aber sicher ist sicher, falls das mal nicht so bleibt).
  $effect(() => {
    repo;
    untrack(reload);
  });

  let settingUp = $state(false);
  let setupLog = $state("");
  async function setup() {
    settingUp = true;
    error = "";
    try {
      setupLog = await unity.setup(repo);
    } catch (e) {
      error = String(e);
    }
    settingUp = false;
    await reload();
  }

  let opening = $state(false);
  async function openEditor() {
    opening = true;
    error = "";
    try {
      // Kehrt erst zurueck, wenn der Editor laeuft (bis 180 s).
      await unity.open(repo);
    } catch (e) {
      error = String(e);
    }
    opening = false;
    await reload();
  }

  let closePath = $state<string | null>(null);

  const cur = $derived(tests(repo));

  async function runTest(mode: UnityTestMode) {
    const run = cur;
    if (run.running) return;
    run.running = mode;
    run.error = "";
    try {
      run.report = await unity.test(repo, mode);
    } catch (e) {
      run.error = String(e);
    }
    run.running = null;
    reload(); // Test kann den Editor geoeffnet/verbunden haben lassen bzw. hat ihn ggf. gestartet.
  }

  // Das Backend sperrt Test/Oeffnen/Einrichten je Projekt ohnehin; hier nur, damit man es gar nicht erst anklickt.
  // Schliessen bleibt frei: Notausgang fuer einen haengenden Testlauf im Editor.
  const busy = $derived(!!cur.running || opening || settingUp);

  const VERDICT_CLASS = { green: "text-success", yellow: "text-warning", red: "text-destructive" } as const;
</script>

{#snippet stat(label: string, ok: boolean)}
  <span class="flex items-center gap-1.5">
    {#if ok}
      <CircleCheckIcon class="size-3.5 text-success" />
    {:else}
      <CircleXIcon class="text-muted-foreground size-3.5 opacity-60" />
    {/if}
    {label}
  </span>
{/snippet}

<div class="flex h-full min-h-0 flex-col overflow-y-auto text-ui">
  <Notice bind:text={error} />

  {#if loading && !info}
    <p class="text-muted-foreground px-3 py-4">{t("Lese Unity-Status …")}</p>
  {:else if info}
    <div class="border-border flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2">
      {@render stat(t("Unity-CLI"), info.cli)}
      {@render stat(t("Editor installiert"), info.editorInstalled)}
      {@render stat(t("Editor offen"), info.editorOpen)}
      {@render stat(t("Pipeline-Paket"), info.pipeline)}
      {@render stat(t("Verbunden"), info.connected)}
      {@render stat(t("Skill installiert"), info.skill)}
      <span class="flex-1"></span>
      <Button size="xs" variant="outline" disabled={busy} onclick={setup}>
        {settingUp ? t("Richte ein …") : t("Unity-Support einrichten")}
      </Button>
      {#if info.editorOpen}
        <Button size="xs" variant="outline" onclick={() => (closePath = repo)}>
          {t("Editor schließen")}
        </Button>
      {:else}
        <Button size="xs" variant="outline" disabled={busy} onclick={openEditor}>
          {opening ? t("Öffnet …") : t("Editor öffnen")}
        </Button>
      {/if}
      <RefreshButton {loading} onclick={reload} />
    </div>

    {#if setupLog}
      <pre
        class="border-border text-muted-foreground max-h-32 overflow-y-auto border-b px-3 py-2 font-mono text-meta whitespace-pre-wrap"
      >{setupLog}</pre>
    {/if}

    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
      <div class="flex items-center gap-2">
        <Button size="xs" variant="outline" disabled={busy} onclick={() => runTest("EditMode")}>
          {cur.running === "EditMode" ? t("Läuft …") : t("EditMode-Tests")}
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onclick={() => runTest("PlayMode")}>
          {cur.running === "PlayMode" ? t("Läuft …") : t("PlayMode-Tests")}
        </Button>
        {#if cur.running}<LoaderCircleIcon class="text-muted-foreground size-3.5 animate-spin" />{/if}
      </div>

      {#if cur.error}<p class="text-destructive text-meta">{cur.error}</p>{/if}
      {#if !cur.report && !cur.error && !cur.running}<div class="flex-1"><Empty>{t("Noch keine Testergebnisse. EditMode- oder PlayMode-Tests starten.")}</Empty></div>{/if}

      {#if cur.report}
        {@const report = cur.report}
        {@const v = verdict(report)}
        <div class="border-border rounded border p-2">
          <div class="flex flex-wrap items-center gap-3">
            <span class="flex items-center gap-1.5 font-semibold {VERDICT_CLASS[v]}">
              {#if v === "red"}
                <CircleXIcon class="size-4" />
              {:else if v === "yellow"}
                <TriangleAlertIcon class="size-4" />
              {:else}
                <CircleCheckIcon class="size-4" />
              {/if}
              {t("{passed}/{total} bestanden", { passed: report.passed, total: report.total })}
            </span>
            {#if report.failed}<span class="text-destructive">{t("{n} fehlgeschlagen", { n: report.failed })}</span>{/if}
            {#if report.skipped}<span class="text-warning">{t("{n} übersprungen", { n: report.skipped })}</span>{/if}
            {#if report.inconclusive}<span class="text-warning">{t("{n} unklar", { n: report.inconclusive })}</span>{/if}
            <span class="text-muted-foreground font-mono">{formatDuration(report.durationSecs)}</span>
            <span class="text-muted-foreground">
              {report.via === "editor" ? t("über laufenden Editor") : t("über Batchmode")}
            </span>
          </div>
          {#if report.failures.length}
            <ul class="border-border mt-2 space-y-1.5 border-t pt-2">
              {#each report.failures as f, i (i)}
                <li>
                  <div class="font-mono text-meta font-semibold">{f.name}</div>
                  <div class="text-muted-foreground text-meta whitespace-pre-wrap select-text">{f.message}</div>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <Empty>
      <p class="whitespace-pre-wrap select-text">{failed || t("Unity-Status nicht lesbar.")}</p>
      {#snippet action()}<RefreshButton {loading} onclick={reload} />{/snippet}
    </Empty>
  {/if}
</div>

<UnityCloseDialog bind:path={closePath} onclosed={reload} />
