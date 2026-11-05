<script lang="ts">
  // Debugger panel: controls, call stack, variables and the program's console of the project's debug session.
  // Holds no state: the session lives in $lib/debug.svelte.
  import { Button, Empty, TextButton, paneBar } from "$lib/atelier-ui";
  import ArrowDownToDotIcon from "@lucide/svelte/icons/arrow-down-to-dot";
  import ArrowUpFromDotIcon from "@lucide/svelte/icons/arrow-up-from-dot";
  import BugIcon from "@lucide/svelte/icons/bug";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PlayIcon from "@lucide/svelte/icons/play";
  import RedoDotIcon from "@lucide/svelte/icons/redo-dot";
  import SquareIcon from "@lucide/svelte/icons/square";
  import { debug, debugStep, debugStop, expand, selectFrame, type Var } from "$lib/debug.svelte";
  import { tick } from "svelte";

  let { repo }: { repo: string } = $props();

  const d = $derived(debug(repo));
  const s = $derived(d.session);
  const paused = $derived(s?.phase === "pause");
  const REASON: Record<string, string> = { breakpoint: "Haltepunkt", step: "Schritt", exception: "Ausnahme", pause: "Pausiert", entry: "Start" };
  let con = $state<HTMLPreElement>();

  // Console follows new output while scrolled to the end.
  $effect(() => {
    void s?.out;
    const el = con;
    if (!el || el.scrollHeight - el.scrollTop - el.clientHeight > 40) return;
    void tick().then(() => (el.scrollTop = el.scrollHeight));
  });
</script>

{#snippet vars(list: Var[], depth: number)}
  {#each list as v, i (i)}
    <li>
      <TextButton
        tone="plain"
        class="w-full items-baseline gap-1.5 py-px pr-2 font-mono text-meta"
        style="padding-left: {depth * 12 + 4}px"
        title={v.type ? `${v.name}: ${v.type}` : v.name}
        onclick={() => expand(repo, v)}
      >
        <ChevronRightIcon class="size-3 shrink-0 self-center transition-transform {v.ref > 0 ? '' : 'invisible'} {v.open ? 'rotate-90' : ''}" />
        <span class="text-primary shrink-0">{v.name}</span>
        {#if v.value}<span class="text-muted-foreground min-w-0 truncate">= {v.value}</span>{/if}
      </TextButton>
      {#if v.open && v.kids}<ul>{@render vars(v.kids, depth + 1)}</ul>{/if}
    </li>
  {/each}
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui">
  <div class={paneBar}>
    {#if s}
      <span class="truncate font-mono text-meta" title={s.label}>{s.label}</span>
      <span class="text-muted-foreground flex shrink-0 items-center gap-1 text-meta" role="status">
        {#if s.phase === "build"}<LoaderIcon class="size-3 animate-spin" /> baut …
        {:else if s.phase === "start"}<LoaderIcon class="size-3 animate-spin" /> startet …
        {:else if s.phase === "run"}<span class="bg-success size-1.5 animate-pulse rounded-full"></span> läuft
        {:else if s.phase === "pause"}<span class="text-warning">angehalten{s.reason ? `: ${REASON[s.reason] ?? s.reason}` : ""}</span>
        {:else}beendet{/if}
      </span>
      <span class="flex-1"></span>
      <Button variant="ghost" size="icon-xs" title="Weiter (F5)" disabled={!paused} onclick={() => debugStep(repo, "continue")}><PlayIcon /></Button>
      <Button variant="ghost" size="icon-xs" title="Anhalten" disabled={s.phase !== "run"} onclick={() => debugStep(repo, "pause")}><PauseIcon /></Button>
      <Button variant="ghost" size="icon-xs" title="Überspringen (F10)" disabled={!paused} onclick={() => debugStep(repo, "next")}><RedoDotIcon /></Button>
      <Button variant="ghost" size="icon-xs" title="Hineinspringen (F11)" disabled={!paused} onclick={() => debugStep(repo, "stepIn")}><ArrowDownToDotIcon /></Button>
      <Button variant="ghost" size="icon-xs" title="Herausspringen (Umschalt+F11)" disabled={!paused} onclick={() => debugStep(repo, "stepOut")}
        ><ArrowUpFromDotIcon /></Button
      >
      <Button variant="ghost" size="icon-xs" title="Debuggen beenden (Umschalt+F5)" disabled={s.phase === "end"} onclick={() => debugStop(repo)}
        ><SquareIcon class="{s.phase === 'end' ? '' : 'text-destructive'} fill-current" /></Button
      >
    {:else}
      <span class="text-muted-foreground">Noch nichts debuggt.</span>
    {/if}
  </div>
  {#if !s}
    <Empty icon={BugIcon}>.NET-Startziel wählen und „Debuggen“ drücken. Haltepunkte: Klick links neben die Zeilennummer oder F9.</Empty>
  {:else}
    <div class="@container min-h-0 flex-1">
      <div class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] @max-[48rem]:grid-cols-1 @max-[48rem]:grid-rows-3">
        <section class="border-border/60 flex min-h-0 flex-col border-r" aria-label="Aufrufliste">
          <h3 class="text-muted-foreground px-2 pt-1 text-meta">Aufrufliste</h3>
          <ul class="min-h-0 flex-1 overflow-y-auto py-0.5">
            {#each s.frames as f (f.id)}
              <li>
                <TextButton
                  tone="plain"
                  class="w-full items-baseline gap-2 px-2 py-px {f.id === s.frame ? 'bg-accent' : ''} {f.path ? '' : 'text-muted-foreground'}"
                  title={f.path ? `${f.path}:${f.line}` : "ohne Quelltext"}
                  onclick={() => selectFrame(repo, f)}
                >
                  <span class="min-w-0 truncate font-mono text-meta">{f.name}</span>
                  {#if f.path}<span class="text-muted-foreground ml-auto shrink-0 font-mono text-meta">{f.path.split("/").pop()}:{f.line}</span>{/if}
                </TextButton>
              </li>
            {:else}
              <li class="text-muted-foreground px-2 text-meta">{s.phase === "run" ? "Läuft – hält am nächsten Haltepunkt." : "–"}</li>
            {/each}
          </ul>
        </section>
        <section class="border-border/60 flex min-h-0 flex-col border-r" aria-label="Variablen">
          <h3 class="text-muted-foreground px-2 pt-1 text-meta">Variablen</h3>
          <ul class="min-h-0 flex-1 overflow-y-auto py-0.5">{@render vars(s.vars, 0)}</ul>
        </section>
        <section class="flex min-h-0 flex-col" aria-label="Konsole">
          <h3 class="text-muted-foreground px-2 pt-1 text-meta">Konsole</h3>
          <pre bind:this={con} class="min-h-0 flex-1 overflow-auto px-2 py-0.5 font-mono text-meta whitespace-pre-wrap">{s.out}</pre>
        </section>
      </div>
    </div>
  {/if}
</div>
