<script lang="ts" module>
  import type { TabState } from "$lib/claudemode";
  import { t } from "$lib/i18n";

  /** One tab group as the strip shows it: a project (or repo group) with its sessions in tab order. */
  export type TabItem = { id: string; title?: string; state: TabState; banner?: string; rename: boolean };
  export type TabGroupView = { key: string; name: string; layers: boolean; items: TabItem[] };

  export const TAB: Record<string, [string, string, string]> = {
    run: ["◐", "text-primary animate-pulse", t("Claude arbeitet")],
    ask: ["?", "text-warning font-bold", t("Claude wartet auf dich")],
    done: ["✓", "text-success", t("Claude ist fertig")],
  };
</script>

<script lang="ts">
  import { ContextItem, IconButton, Input, Row, TextButton, menuContent } from "$lib/atelier-ui";
  import { moveGroup, moveTab, swapIndex, urgent, type TabGroup } from "$lib/sessiontabs.logic";
  import { cn } from "$lib/utils";
  import { ContextMenu, LinkPreview } from "bits-ui";
  import XIcon from "@lucide/svelte/icons/x";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

  let {
    groups,
    active,
    onopen,
    onend,
    onrename,
    onreorder,
  }: {
    groups: TabGroupView[];
    active: string | null;
    onopen: (id: string) => void;
    onend: (id: string) => void;
    /** /rename in that session (only tabs with rename: true). */
    onrename: (id: string, name: string) => void;
    /** New tab order (all ids); a tab never leaves its group. */
    onreorder: (ids: string[]) => void;
  } = $props();

  // Collapsed groups, by hand only (click on the chip), like Chrome tab groups.
  let folded = $state<Record<string, boolean>>({});
  // Group whose session list is open (hover on a collapsed chip).
  let peek = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let strip = $state<HTMLDivElement>();

  const isFolded = (g: TabGroupView) => g.items.length > 1 && !!folded[g.key];
  const NEW = t("Neue Sitzung");

  function startRename(it: TabItem) {
    if (!it.rename) return;
    draft = it.title ?? "";
    editing = it.id;
  }
  function endRename(save: boolean) {
    const id = editing;
    editing = null;
    if (save && id && draft.trim()) onrename(id, draft.trim());
  }

  // ---------- drag to reorder (Chrome style): the others make room while the pointer moves ----------
  // unit: a whole group (chip, a single tab, or the visible tab of a collapsed group); tab: one tab inside its group.
  let drag = $state<{ kind: "unit" | "tab"; key: string; x0: number; on: boolean } | null>(null);
  let swallow = false;
  const asGroups = (): TabGroup[] => groups.map((g) => ({ key: g.key, list: g.items.map((i) => ({ id: i.id, repo: { path: "" } })) }));
  const mids = (els: Element[]) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });

  function down(e: PointerEvent) {
    const el = e.target as HTMLElement;
    if (e.button !== 0 || editing || el.closest("[data-close], input")) return;
    const unit = el.closest<HTMLElement>("[data-unit]");
    const tab = el.closest<HTMLElement>("[data-tab]");
    if (!unit) return;
    const g = groups.find((x) => x.key === unit.dataset.unit);
    if (!g) return;
    const whole = !tab || el.closest("[data-chip]") || g.items.length < 2 || isFolded(g);
    drag = whole ? { kind: "unit", key: g.key, x0: e.clientX, on: false } : { kind: "tab", key: tab!.dataset.tab!, x0: e.clientX, on: false };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  }

  function move(e: PointerEvent) {
    if (!drag || !strip) return;
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x0) < 5) return;
      drag.on = true;
      peek = null;
      document.documentElement.classList.add("cursor-grabbing", "select-none");
    }
    if (drag.kind === "unit") {
      const els = [...strip.querySelectorAll(":scope > [data-unit]")];
      const keys = els.map((x) => (x as HTMLElement).dataset.unit!);
      const i = keys.indexOf(drag.key);
      const j = swapIndex(mids(els), i, e.clientX);
      if (i >= 0 && j !== i) onreorder(moveGroup(asGroups(), drag.key, j));
    } else {
      const box = strip.querySelector(`[data-tab="${CSS.escape(drag.key)}"]`)?.closest("[data-unit]");
      const els = box ? [...box.querySelectorAll("[data-tab]")] : [];
      const i = els.findIndex((x) => (x as HTMLElement).dataset.tab === drag!.key);
      const j = swapIndex(mids(els), i, e.clientX);
      if (i >= 0 && j !== i) onreorder(moveTab(asGroups(), drag.key, j));
    }
  }

  function up() {
    window.removeEventListener("pointermove", move);
    // The click that ends a drag must not open or collapse anything.
    if (drag?.on) {
      swallow = true;
      setTimeout(() => (swallow = false));
    }
    drag = null;
    document.documentElement.classList.remove("cursor-grabbing", "select-none");
  }

  const lifted = (key: string, kind: "unit" | "tab") => drag?.on && drag.kind === kind && drag.key === key;
  const lift = "relative z-10 rounded-t bg-background shadow-md";
</script>

{#snippet status(s: TabState, extra = "")}
  {#if s}{@const [i, c, tip] = TAB[s]}<span class="{c} {extra}" title={tip}>{i}</span>{/if}
{/snippet}

<!-- One tab; label = project name (single) or session title (inside a group). -->
{#snippet tab(it: TabItem, label: string, grouped: boolean, unit?: string)}
  {@const on = it.id === active}
  <ContextMenu.Root>
    <ContextMenu.Trigger
      data-tab={it.id}
      data-unit={unit}
      class={cn(
        "group flex shrink-0 items-center gap-1 rounded-t px-2 py-1",
        on ? "bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]" : "text-muted-foreground hover:text-foreground",
        (lifted(it.id, "tab") || (unit && lifted(unit, "unit"))) && lift,
      )}
      onmousedown={(e: MouseEvent) => e.button === 1 && e.preventDefault()}
      onauxclick={(e: MouseEvent) => e.button === 1 && onend(it.id)}
    >
      <!-- Middle click closes like the x (mousedown preventDefault: no autoscroll on Windows). -->
      {#if editing === it.id}
        <!-- svelte-ignore a11y_autofocus -->
        <Input
          density="xs"
          class="w-48"
          bind:value={draft}
          autofocus
          aria-label={t("Sitzung umbenennen")}
          onkeydown={(e: KeyboardEvent) => (e.key === "Enter" ? endRename(true) : e.key === "Escape" && endRename(false))}
          onblur={() => endRename(true)}
        />
      {:else}
        <!-- Negative margins: the button covers the whole tab (incl. the underline), the label stays in place. -->
        <TextButton
          tone="plain"
          class="-my-1 -mr-1 -ml-2 block py-1 pr-1 pl-2"
          role="tab"
          aria-selected={on}
          title={grouped ? `${it.title ?? NEW}${it.rename ? ` · ${t("Doppelklick: umbenennen")}` : ""}` : undefined}
          onclick={() => onopen(it.id)}
          ondblclick={() => grouped && startRename(it)}
        >
          {@render status(it.state, "mr-1")}{#if !grouped && groups.find((g) => g.key === unit)?.layers}<LayersIcon
              class="text-primary mr-1 inline size-3"
            />{/if}<span class="inline-block truncate align-bottom {grouped ? (on ? 'max-w-[24ch]' : 'max-w-[14ch]') : ''}">{label}</span>{#if it.banner}<span
              class="text-warning ml-1.5 inline-block max-w-80 truncate align-bottom"
              title={it.banner}>{it.banner}</span
            >{/if}
        </TextButton>
      {/if}
      <IconButton data-close size="xs" tone="danger" reveal={!on} onclick={() => onend(it.id)} label={t("Sitzung beenden")}><XIcon class="size-3" /></IconButton>
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content class={cn(menuContent, "min-w-44 rounded-lg shadow-lg")}>
        {#if grouped && it.rename}<ContextItem label={t("Umbenennen …")} onSelect={() => startRename(it)} />{/if}
        <ContextItem label={t("Sitzung beenden …")} destructive onSelect={() => onend(it.id)} />
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
{/snippet}

{#snippet chip(g: TabGroupView, f: boolean, props: Record<string, unknown> = {})}
  {@const st = urgent(g.items.map((i) => i.state))}
  <TextButton
    {...props}
    data-chip
    tone="primary"
    class="bg-primary/15 hover:bg-primary/25 text-meta mx-1 my-auto gap-1.5 rounded-md py-0.5 pr-2 pl-1.5 font-semibold whitespace-nowrap"
    aria-expanded={!f}
    title={f ? undefined : t("{n} Sitzungen · Klick: zuklappen", { n: g.items.length })}
    onclick={() => ((folded[g.key] = !f), (peek = null))}
  >
    <ChevronDownIcon class="size-3 opacity-70 transition-transform motion-reduce:transition-none {f ? '-rotate-90' : ''}" />
    {#if f}{@render status(st)}{/if}{#if g.layers}<LayersIcon class="size-3" />{/if}<span>{g.name}</span><span class="font-normal opacity-80 tabular-nums">{g.items.length}</span>
  </TextButton>
{/snippet}

<!-- Session tabs at the top in every view (also the start page). From two sessions in one project they form a group:
     the project name once as a chip, the tabs show only the session title. -->
<div
  bind:this={strip}
  class="bg-chrome border-border text-ui flex shrink-0 gap-px overflow-x-auto border-b px-1"
  role="tablist"
  aria-label={t("Sitzungen")}
  tabindex="-1"
  onpointerdown={down}
  onclickcapture={(e) => swallow && (e.stopPropagation(), e.preventDefault())}
>
  {#each groups as g (g.key)}
    {#if g.items.length === 1}
      {@render tab(g.items[0], g.name, false, g.key)}
    {:else}
      {@const f = isFolded(g)}
      <!-- Collapsed: only the active tab stays next to the chip. The line under the tabs marks the group. -->
      <div
        data-unit={g.key}
        class={cn(
          "relative flex shrink-0 gap-px after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary/30",
          lifted(g.key, "unit") && lift,
        )}
      >
        {#if f}
          <LinkPreview.Root open={peek === g.key} onOpenChange={(o) => (peek = o && !drag ? g.key : null)} openDelay={250} closeDelay={150}>
            <LinkPreview.Trigger>
              {#snippet child({ props })}{@render chip(g, f, props)}{/snippet}
            </LinkPreview.Trigger>
            <LinkPreview.Portal>
              <LinkPreview.Content side="bottom" align="start" sideOffset={4} class={cn(menuContent, "min-w-56 max-w-80 rounded-lg shadow-lg")}>
                <div class="text-muted-foreground text-meta px-2 pt-1 pb-0.5 font-semibold tracking-wide uppercase">{g.name}</div>
                {#each g.items as it (it.id)}
                  <Row selected={it.id === active} onclick={() => ((peek = null), onopen(it.id))}>
                    <span class="w-3 shrink-0 text-center">{@render status(it.state)}</span>
                    <span class="min-w-0 flex-1 truncate" title={it.title ?? NEW}>{it.title ?? NEW}</span>
                  </Row>
                {/each}
              </LinkPreview.Content>
            </LinkPreview.Portal>
          </LinkPreview.Root>
        {:else}
          {@render chip(g, f)}
        {/if}
        {#each f ? g.items.filter((i) => i.id === active) : g.items as it (it.id)}
          {@render tab(it, it.title ?? NEW, true)}
        {/each}
      </div>
    {/if}
  {/each}
</div>
