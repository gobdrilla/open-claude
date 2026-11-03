<script lang="ts" module>
  import type { TabState } from "$lib/claudemode";

  // Subset of the mod's session panel (claude_panel), see src-tauri/mods/open-claude/types/index.d.ts.
  export type Panel = {
    context?: { tokens: number | null; window: number; percent: number | null };
    active?: { tool: string; target: string; state: string }[];
    todos?: { content: string; status: string }[];
    limits?: { kind: string; percentUsed: number; resetsAt?: string }[];
    busy?: boolean;
    waiting?: boolean;
    waitingFor?: { tool: string; summary: string } | null;
  };
  export type SessionItem = { id: string; name: string; state: TabState; panel?: Panel | null };
</script>

<script lang="ts">
  import { Button, Row } from "$lib/atelier-ui";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-question-mark";

  // Start page: sessions waiting for the user, then all running sessions. Each section hides when empty.
  let { items, onopen }: { items: SessionItem[]; onopen: (id: string) => void } = $props();

  const waiting = $derived(items.filter((i) => i.state === "ask"));
  const STATE: Record<string, [string, string, string]> = {
    run: ["arbeitet", "text-primary", "bg-primary"],
    ask: ["wartet auf dich", "text-warning", "bg-warning"],
    done: ["fertig", "text-success", "bg-success"],
  };
  const IDLE: [string, string, string] = ["bereit", "text-muted-foreground", "bg-muted-foreground"];

  function context(p?: Panel | null) {
    const c = p?.context;
    return c?.window ? Math.round(c.percent ?? ((c.tokens ?? 0) / c.window) * 100) : null;
  }
  const todo = (p?: Panel | null) => p?.todos?.find((t) => t.status === "in_progress")?.content;
  function tool(p?: Panel | null) {
    const a = p?.active?.findLast((a) => a.state === "run");
    return a && `${a.tool}  ${a.target}`;
  }
  const head = "text-meta mb-1.5 flex items-baseline gap-1.5 font-semibold tracking-wide uppercase";
</script>

{#if waiting.length}
  <section aria-label="Wartet auf dich" class="px-3 pt-3">
    <h2 class="{head} text-warning">Wartet auf dich <span class="text-muted-foreground font-normal">{waiting.length}</span></h2>
    <div class="flex flex-col gap-1.5">
      {#each waiting as it (it.id)}
        {@const w = it.panel?.waitingFor}
        <div class="border-warning/40 bg-warning/10 flex h-10 items-center gap-2.5 rounded-lg border pr-1.5 pl-3">
          <CircleHelpIcon class="text-warning size-4 shrink-0" />
          <span class="text-body shrink-0 font-semibold">{it.name}</span>
          <span class="text-body text-foreground/85 shrink-0">{w ? `Claude fragt: ${w.tool}` : "Claude wartet auf dich"}</span>
          {#if w?.summary}<span class="text-meta text-muted-foreground min-w-0 truncate font-mono" title={w.summary}>{w.summary}</span>{/if}
          <span class="flex-1"></span>
          <Button variant="outline" size="sm" onclick={() => onopen(it.id)}>Öffnen</Button>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if items.length}
  <section aria-label="Läuft" class="px-3 pt-3">
    <h2 class="{head} text-muted-foreground">
      Läuft <span class="font-normal">{items.length} {items.length === 1 ? "Sitzung" : "Sitzungen"}</span>
    </h2>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2">
      {#each items as it (it.id)}
        {@const [state, text, dot] = (it.state && STATE[it.state]) || IDLE}
        {@const ctx = context(it.panel)}
        {@const sub = todo(it.panel)}
        {@const now = it.state === "ask" && it.panel?.waitingFor ? `Rückfrage: ${it.panel.waitingFor.tool}  ${it.panel.waitingFor.summary}` : tool(it.panel)}
        <Row variant="card" density="roomy" class="min-h-20 gap-1 px-3" aria-label="Sitzung {it.name} öffnen" onclick={() => onopen(it.id)}>
          <span class="flex w-full items-center gap-2">
            <span class="size-2 shrink-0 rounded-full {dot}"></span>
            <span class="text-body truncate font-semibold">{it.name}</span>
            <span class="text-meta {text} shrink-0">{state}</span>
            <span class="flex-1"></span>
            {#if ctx !== null}<span class="text-meta text-muted-foreground shrink-0 tabular-nums" title="Kontext belegt">Kontext {ctx} %</span>{/if}
          </span>
          {#if sub}<span class="text-ui text-foreground/85 truncate" title={sub}>{sub}</span>{/if}
          {#if now}<span class="text-meta text-muted-foreground truncate font-mono" title={now}>{now}</span>{/if}
        </Row>
      {/each}
    </div>
  </section>
{/if}
