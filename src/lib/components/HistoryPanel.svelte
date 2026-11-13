<script lang="ts" module>
  /** One session of the project as history.rs::claude_sessions lists it (newest first, like /resume). */
  export type Past = { sid: string; title: string; prompt: string; branch: string; at: number; live: boolean };
  /** A session open as a tab in the app; sid from the mod's panel (unknown for a moment after the start). */
  export type OpenSession = { id: string; sid?: string; state: TabState };
</script>

<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { Button, Input, Row } from "$lib/atelier-ui";
  import { TAB } from "$lib/components/SessionTabs.svelte";
  import type { TabState } from "$lib/claudemode";
  import { age } from "$lib/utils";
  import { t } from "$lib/i18n";

  let {
    cwd,
    active,
    open,
    onopen,
    onresume,
  }: {
    cwd: string;
    active: string;
    /** Tabs of this project, in tab order. */
    open: OpenSession[];
    onopen: (id: string) => void;
    /** here: /resume in the active tab instead of a new tab. */
    onresume: (sid: string, here: boolean) => void;
  } = $props();

  let list = $state<Past[] | null>(null);
  let error = $state("");
  let q = $state("");

  async function load() {
    const c = cwd;
    try {
      const l = await invoke<Past[]>("claude_sessions", { cwd: c });
      if (c === cwd) (list = l), (error = "");
    } catch (e) {
      error = String(e);
    }
  }
  // Titles arrive a few seconds after the first prompt, /rename changes them: poll while the tab is shown.
  onMount(() => {
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    void cwd;
    list = null;
    load();
  });

  const NEW = t("Neue Sitzung");
  const ago = (ms: number) => (ms ? age(new Date(ms).toISOString()) : "");
  const bySid = $derived(new Map((list ?? []).map((p) => [p.sid, p])));
  const mine = $derived(new Set(open.map((o) => o.sid).filter(Boolean)));
  const hit = (...s: (string | undefined)[]) => !q.trim() || s.join(" ").toLowerCase().includes(q.trim().toLowerCase());
  const tabs = $derived(open.map((o) => ({ ...o, p: o.sid ? bySid.get(o.sid) : undefined })).filter((o) => hit(o.p?.title, o.p?.prompt, o.p?.branch)));
  const earlier = $derived((list ?? []).filter((p) => !mine.has(p.sid) && hit(p.title, p.prompt, p.branch)));
  const head = "text-muted-foreground text-meta mb-1 flex gap-1.5 px-1 font-semibold tracking-wide uppercase";
</script>

{#snippet status(s: TabState)}
  <span class="w-3 shrink-0 text-center">{#if s}{@const [i, c, tip] = TAB[s]}<span class={c} title={tip}>{i}</span>{/if}</span>
{/snippet}

{#snippet meta(branch: string, badge?: string, warn = false)}
  {#if branch || badge}
    <span class="text-muted-foreground flex items-center gap-1.5 pl-[18px] text-[10.5px]">
      {#if branch}<span class="bg-secondary rounded px-1 font-mono">{branch}</span>{/if}
      {#if badge}<span class="rounded-full border px-1.5 {warn ? 'text-warning border-warning/40' : 'text-primary border-primary/40'}">{badge}</span>{/if}
    </span>
  {/if}
{/snippet}

<div class="flex flex-col gap-3">
  <Input density="xs" type="search" bind:value={q} placeholder={t("Sitzungen durchsuchen")} aria-label={t("Sitzungen durchsuchen")} />
  {#if error}<p class="text-destructive px-1">{error}</p>{/if}

  <section>
    <h3 class={head}>{t("Offen in Atelier")} <span class="font-normal">{tabs.length}</span></h3>
    {#each tabs as o (o.id)}
      {@const title = o.p?.title || NEW}
      <Row density="roomy" text="md" class="block" selected={o.id === active} onclick={() => onopen(o.id)}>
        <span class="flex items-center gap-1.5">{@render status(o.state)}<span class="min-w-0 flex-1 truncate font-medium" {title}>{title}</span></span>
        {#if o.p?.prompt}<span class="text-muted-foreground block truncate pl-[18px] text-meta" title={o.p.prompt}>{o.p.prompt}</span>{/if}
        {@render meta(o.p?.branch ?? "", o.id === active ? t("dieser Tab") : undefined)}
      </Row>
    {:else}
      <p class="text-muted-foreground px-1">{t("Keine Treffer.")}</p>
    {/each}
  </section>

  <section>
    <h3 class={head}>{t("Früher")} <span class="font-normal">{earlier.length}</span></h3>
    {#if !list && !error}
      <p class="text-muted-foreground px-1">{t("Lade …")}</p>
    {/if}
    {#each earlier as p (p.sid)}
      {@const title = p.title || p.prompt || NEW}
      <!-- Running in a terminal outside the app: resuming would let two processes write the same transcript. -->
      <div class="group hover:bg-accent/60 relative rounded-md px-2 py-1.5 {p.live ? 'opacity-70' : ''}">
        <span class="flex items-center gap-1.5">
          <span class="w-3 shrink-0"></span>
          <span class="min-w-0 flex-1 truncate font-medium" {title}>{title}</span>
          <span class="text-muted-foreground text-meta shrink-0 tabular-nums {p.live ? '' : 'group-focus-within:invisible group-hover:invisible'}">{ago(p.at)}</span>
        </span>
        {#if p.title && p.prompt}<span class="text-muted-foreground block truncate pl-[18px] text-meta" title={p.prompt}>{p.prompt}</span>{/if}
        {@render meta(p.branch, p.live ? t("läuft außerhalb") : undefined, true)}
        {#if !p.live}
          <span class="absolute top-1 right-1.5 hidden gap-1 group-focus-within:flex group-hover:flex">
            <Button size="2xs" variant="outline" title={t("/resume im aktuellen Tab")} onclick={() => onresume(p.sid, true)}>{t("Hier")}</Button>
            <Button size="2xs" title={t("Neuer Tab mit claude --resume")} onclick={() => onresume(p.sid, false)}>{t("Fortsetzen")}</Button>
          </span>
        {/if}
      </div>
    {:else}
      {#if list}<p class="text-muted-foreground px-1">{q.trim() ? t("Keine Treffer.") : t("Keine früheren Sitzungen.")}</p>{/if}
    {/each}
  </section>
</div>
