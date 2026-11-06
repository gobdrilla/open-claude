<script lang="ts">
  // Test-Explorer: Baum Datei/Suite/Test mit Status, Laeufe starten und abbrechen, darunter Details bzw. Output.
  // Haelt selbst keinen Zustand ausser Scroll und Splitter: alles liegt in $lib/testing.svelte (ueberlebt Remounts).
  import { untrack } from "svelte";
  import { ContextMenu } from "bits-ui";
  import Notice from "$lib/components/Notice.svelte";
  import Splitter, { stored } from "$lib/components/Splitter.svelte";
  import { Button, Checkbox, ContextItem, Empty, IconButton, Input, Tabs, TextButton, menuContent, paneBar } from "$lib/atelier-ui";
  import { cn } from "$lib/utils";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleDashedIcon from "@lucide/svelte/icons/circle-dashed";
  import CircleIcon from "@lucide/svelte/icons/circle";
  import CircleSlashIcon from "@lucide/svelte/icons/circle-slash";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FlaskConicalIcon from "@lucide/svelte/icons/flask-conical";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import PlayIcon from "@lucide/svelte/icons/play";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SquareIcon from "@lucide/svelte/icons/square";
  import { open } from "$lib/editor.svelte";
  import { failedItems, failure, rescan, setExpanded, testCancel, testRun, tests, title, where } from "$lib/testing.svelte";
  import { failureReport, failuresReport, rows, stackLinks, type Row, type St } from "$lib/testing.logic";
  import { sendToClaude } from "$lib/ide.svelte";
  // tr: t is the test state here.
  import { t as tr } from "$lib/i18n";

  let { repo }: { repo: string } = $props();

  const t = $derived(tests(repo));
  const ROW = 22;

  // Erstes Oeffnen: einmal suchen. Danach nur auf "Neu suchen", nach dem Speichern und nach Laeufen.
  $effect(() => {
    const r = repo;
    untrack(() => !tests(r).scanned && void rescan(r));
  });

  const visible = $derived(rows(t.nodes, t.states, t.expanded, t.filter, t.failedOnly));
  let scrollTop = $state(0);
  let height = $state(0);
  // Nur sichtbare Zeilen (+ Puffer) rendern, feste Zeilenhoehe.
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 10));
  const slice = $derived(visible.slice(first, first + Math.ceil(height / ROW) + 20));

  const counts = $derived.by(() => {
    const c = { passed: 0, failed: 0, skipped: 0 };
    // Datei-Fehler (Syntax, Laden) zaehlen mit, sonst steht im Kopf ✗0 bei rotem Baum.
    for (const [id, r] of Object.entries(t.results)) {
      const k = t.nodes[id]?.kind;
      if (k === "test" && (r.state === "passed" || r.state === "failed" || r.state === "skipped")) c[r.state]++;
      else if (k === "file" && r.state === "failed") c.failed++;
    }
    return c;
  });

  let detailH = $state(stored("tests-detail", 200));
  const sel = $derived(t.selected ? t.nodes[t.selected] : undefined);
  const res = $derived(t.selected ? t.results[t.selected] : undefined);

  const ms = (v?: number) => (v === undefined ? "" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);
  const run = (target: string) => void testRun(repo, target);

  function click(r: Row) {
    t.selected = r.id;
    if (r.kids && t.nodes[r.id].kind === "file") setExpanded(repo, r.id, !r.open);
  }

  const MAX_SEND = 20;
  // Erst beim Klick: failedItems() laeuft ueber den ganzen Baum.
  function sendFailures() {
    void sendToClaude(repo, failuresReport(failedItems(repo), MAX_SEND));
  }
  function sendFailure(id: string) {
    const f = failure(t, id);
    void sendToClaude(repo, failureReport(f.name, f.r, f.file));
  }

  function definition(id: string) {
    const n = t.nodes[id];
    if (n && !n.name.startsWith("(")) void open(repo, n.file, n.line ?? undefined);
  }

  function jump(id: string, file: string, line: number) {
    const p = where(repo, id, file);
    if (p) void open(repo, p, line);
  }

  // Output: nur mitscrollen, wenn er schon am Ende stand.
  let out = $state<HTMLPreElement>();
  let stick = true;
  $effect.pre(() => {
    void t.log;
    if (out) stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 4;
  });
  $effect(() => {
    void t.log;
    if (out && stick) out.scrollTop = out.scrollHeight;
  });
  const tail = $derived(t.log.length > 2000 ? t.log.slice(-2000) : t.log);
</script>

{#snippet status(st: St)}
  {#if st === "failed"}<CircleXIcon class="text-destructive size-3.5 shrink-0" />
  {:else if st === "passed"}<CircleCheckIcon class="text-success size-3.5 shrink-0" />
  {:else if st === "running"}<LoaderCircleIcon class="text-muted-foreground size-3.5 shrink-0 animate-spin" />
  {:else if st === "queued"}<CircleDashedIcon class="text-muted-foreground size-3.5 shrink-0" />
  {:else if st === "skipped"}<CircleSlashIcon class="text-warning size-3.5 shrink-0" />
  {:else}<CircleIcon class="text-muted-foreground size-3.5 shrink-0" />{/if}
{/snippet}

{#snippet rescanAction()}
  <Button size="xs" variant="outline" disabled={!!t.run} onclick={() => rescan(repo)}>{tr("Neu suchen")}</Button>
{/snippet}

{#snippet pre(label: string, text: string)}
  <div class="min-w-0 flex-1">
    <div class="text-muted-foreground mb-0.5 text-meta">{label}</div>
    <pre class="bg-muted max-h-48 overflow-auto rounded p-1.5 font-mono text-meta whitespace-pre-wrap">{text}</pre>
  </div>
{/snippet}

<!-- @container: in a narrow dock the bar shows icons only (titles name them) instead of wrapping to three rows. -->
<div class="@container flex h-full min-h-0 flex-col text-ui">
  <div class="{paneBar} flex-wrap py-0.5">
    <Button variant="ghost" size="xs" disabled={!!t.run || t.scanning} title={tr("Alle Tests ausführen")} onclick={() => run("all")}
      ><PlayIcon /> <span class="@max-[20rem]:hidden">{tr("Alle")}</span></Button
    >
    <Button
      variant="ghost"
      size="xs"
      disabled={!!t.run || !counts.failed}
      title={tr("Fehlgeschlagene erneut ausführen")}
      onclick={() => run("failed")}><CircleXIcon /> <span class="@max-[20rem]:hidden">{tr("Fehlgeschlagene")}</span></Button
    >
    <Button variant="ghost" size="xs" disabled={!t.run} title={tr("Lauf abbrechen")} onclick={() => testCancel(repo)}
      ><SquareIcon class="fill-current" /> <span class="@max-[20rem]:hidden">{tr("Abbrechen")}</span></Button
    >
    <IconButton size="md" label={tr("Tests neu suchen")} disabled={!!t.run || t.scanning} onclick={() => rescan(repo)}
      ><RefreshCwIcon class="size-3 {t.scanning ? 'animate-spin' : ''}" /></IconButton
    >
    {#if counts.failed}
      <Button
        variant="ghost"
        size="xs"
        title={tr("Fehlgeschlagene Tests mit Meldung und Stack in den Prompt von Claude")}
        onclick={sendFailures}
        >{counts.failed > MAX_SEND
          ? tr("Alle Fehler an Claude ({n} von {total})", { n: MAX_SEND, total: counts.failed })
          : tr("Alle Fehler an Claude ({n})", { n: counts.failed })}</Button
      >
    {/if}
    <span class="flex-1"></span>
    <span class="text-muted-foreground text-meta flex items-center gap-1.5 px-1 font-mono" role="status">
      <span class="text-success">✓{counts.passed}</span>
      <span class="text-destructive">✗{counts.failed}</span>
      <span>○{counts.skipped}</span>
      {#if t.run}<LoaderCircleIcon class="size-3 animate-spin" />{:else if t.last}{ms(t.last.ms)}{/if}
    </span>
  </div>
  <div class="border-border flex items-center gap-2 border-b px-2 py-1">
    <Input density="xs" class="min-w-0 flex-1" placeholder="Filter …" aria-label={tr("Tests filtern")} bind:value={t.filter} />
    <Checkbox size="sm" muted class="shrink-0" title={tr("nur Fehler")} bind:checked={t.failedOnly}
      ><span class="@max-[14rem]:sr-only">{tr("nur Fehler")}</span></Checkbox
    >
  </div>
  <Notice bind:text={() => t.error, (v) => (t.error = v)} timeout={0} />
  <Notice bind:text={() => t.note, (v) => (t.note = v)} kind="note" timeout={0} />

  <div
    class="relative min-h-0 flex-1 overflow-y-auto"
    role="tree"
    aria-label="Tests"
    bind:clientHeight={height}
    onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
  >
    {#if !visible.length}
      <div class="absolute inset-0">
        <Empty icon={FlaskConicalIcon} action={t.scanning || t.filter || t.failedOnly ? undefined : rescanAction}>
          {t.scanning ? tr("Suche Tests …") : t.filter || t.failedOnly ? tr("Keine Treffer.") : tr("Keine Tests gefunden.")}
        </Empty>
      </div>
    {/if}
    <div class="relative" style="height:{visible.length * ROW}px">
      {#each slice as r, i (r.id)}
        {@const n = t.nodes[r.id]}
        {@const st = t.states[r.id] ?? "idle"}
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <div
              role="treeitem"
              tabindex="0"
              aria-selected={t.selected === r.id}
              aria-expanded={r.kids ? r.open : undefined}
              class="group hover:bg-accent absolute left-0 flex w-full cursor-default items-center gap-1 pr-1 {t.selected === r.id
                ? 'bg-accent'
                : ''}"
              style="top:{(first + i) * ROW}px;height:{ROW}px;padding-left:{4 + r.depth * 12}px"
              title={n.kind === "file" ? n.file : n.key}
              onclick={() => click(r)}
              ondblclick={() => definition(r.id)}
              onkeydown={(e) => {
                if (e.key === "Enter") definition(r.id);
                else if (e.key === " " && r.kids) setExpanded(repo, r.id, !r.open);
                else return;
                e.preventDefault();
              }}
            >
              <IconButton
                tabindex={-1}
                size="xs"
                label={r.open ? tr("Zuklappen") : tr("Aufklappen")}
                class={r.kids ? "" : "invisible"}
                onclick={(e) => {
                  e.stopPropagation();
                  setExpanded(repo, r.id, !r.open);
                }}><ChevronRightIcon class="size-3 transition-transform {r.open ? 'rotate-90' : ''}" /></IconButton
              >
              {@render status(st)}
              {#if n.kind === "file"}
                <!-- Dateiname zuerst: im schmalen Panel blieb sonst nur das gemeinsame "src-tauri/src…" stehen -->
                {@const cut = n.name.lastIndexOf("/") + 1}
                <span class="min-w-0 flex-1 truncate font-mono text-meta"
                  >{n.name.slice(cut)}<span class="text-muted-foreground ml-1.5">{n.name.slice(0, cut)}</span></span
                >
              {:else}
                <span class="min-w-0 flex-1 truncate">{n.name}</span>
              {/if}
              {#if n.kind === "file"}
                <span
                  class="bg-muted text-muted-foreground shrink-0 rounded px-1 text-[10px] @max-[16rem]:hidden"
                  title={n.fw === "jest" || n.fw === "pytest" ? tr("Experimentell: nicht gegen ein echtes Projekt geprüft") : undefined}
                  >{n.fw}{n.fw === "jest" || n.fw === "pytest" ? "*" : ""}</span
                >
              {/if}
              <span class="text-muted-foreground shrink-0 text-meta tabular-nums">{ms(t.results[r.id]?.ms)}</span>
              <IconButton
                tabindex={-1}
                size="xs"
                reveal
                class="disabled:hidden"
                label={tr("Ausführen")}
                disabled={!!t.run}
                onclick={(e) => {
                  e.stopPropagation();
                  run(r.id);
                }}><PlayIcon class="size-3" /></IconButton
              >
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class={cn(menuContent, "min-w-40")}>
              <ContextItem label={tr("Ausführen")} onSelect={() => run(r.id)} />
              <ContextItem label={tr("Zur Definition")} onSelect={() => definition(r.id)} />
              {#if t.results[r.id]?.state === "failed"}
                <ContextItem label={tr("An Claude")} onSelect={() => sendFailure(r.id)} />
              {/if}
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      {/each}
    </div>
  </div>

  <Splitter bind:size={detailH} axis="y" min={60} invert key="tests-detail" />
  <div class="border-border flex min-h-0 flex-col border-t" style="height:{detailH}px; max-height:max(60px, 50%)">
    <Tabs
      dense
      tabs={[
        { id: "details", label: "Details" },
        { id: "output", label: tr("Ausgabe") },
      ]}
      bind:value={() => t.tab, (v) => (t.tab = v)}
    />
    {#if t.tab === "output"}
      <pre bind:this={out} class="min-h-0 flex-1 overflow-auto p-2 font-mono text-meta whitespace-pre-wrap">{tail.join("\n")}</pre>
    {:else if !sel}
      <div class="min-h-0 flex-1"><Empty>{tr("Test in der Liste wählen.")}</Empty></div>
    {:else}
      <div class="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div class="flex items-center gap-1.5">
          {@render status(t.states[sel.id] ?? "idle")}
          <span class="min-w-0 flex-1 truncate font-medium">{title(t, sel.id) || sel.name}</span>
          {#if sel.line !== null || res?.at}
            {@const at = res?.at ?? { file: sel.file, line: sel.line ?? 1 }}
            <TextButton
              size="sm"
              class="shrink-0 gap-0.5 font-mono"
              title={tr("Im Editor öffnen")}
              onclick={() => void open(repo, at.file, at.line)}
              >{at.file.slice(at.file.lastIndexOf("/") + 1)}:{at.line}<ExternalLinkIcon class="size-3" /></TextButton
            >
          {/if}
        </div>
        {#if !res}
          <p class="text-muted-foreground text-meta">{tr("Noch nicht gelaufen.")}</p>
        {:else}
          {#if res.msg}<pre class="font-mono text-meta whitespace-pre-wrap">{res.msg}</pre>{/if}
          {#if res.exp !== undefined || res.act !== undefined}
            <div class="flex gap-2">
              {@render pre(res.labels?.[0] ?? tr("Erwartet"), res.exp ?? "")}
              {@render pre(res.labels?.[1] ?? tr("Tatsächlich"), res.act ?? "")}
            </div>
          {/if}
          {#if res.diff}{@render pre("Diff", res.diff)}{/if}
          {#if res.stack}
            <div class="text-muted-foreground text-meta">Stack</div>
            <pre class="max-h-48 overflow-auto font-mono text-meta whitespace-pre-wrap">{#each stackLinks(res.stack) as p, k (k)}{#if p.loc}{@const loc = p.loc}<TextButton
                    tone="primary"
                    underline
                    class="inline"
                    onclick={() => jump(sel.id, loc.file, loc.line)}>{p.text}</TextButton
                  >{:else}{p.text}{/if}{/each}</pre>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>
