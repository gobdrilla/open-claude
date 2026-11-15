<script lang="ts">
  import { Button, IconButton, Segmented } from "$lib/atelier-ui";
  import PipetteIcon from "@lucide/svelte/icons/pipette";
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import XIcon from "@lucide/svelte/icons/x";
  import { theme, setMode } from "$lib/theme.svelte";
  import { t } from "$lib/i18n";
  import { MOD } from "$lib/editor.logic";
  import { css, hex } from "$lib/color";
  import { DEFAULTS, TOKENS, derive, isPreset, type ColorId } from "$lib/themes";
  import { canUndo, current, themeEditor, undoTheme } from "$lib/themes.svelte";
  import { COLOR_LABEL } from "./labels";
  import ThemeColors from "./ThemeColors.svelte";

  // Theme editor docked to the right of the app: the app itself is the preview. "Bereich wählen" turns clicks into
  // the app into picks (the clicked text or surface opens its color here). The panel keeps the built-in colors, so
  // it stays usable whatever the theme does (there is no contrast guard).

  const th = $derived(current());
  const builtin = $derived(TOKENS.map((k) => `--${k}:${css((theme.dark ? DEFAULTS.dark : DEFAULTS.light)[k])}`).join(";"));

  // --- pick mode ---

  const CODE: ColorId[] = ["code-text", "syn-comment", "syn-keyword", "syn-string", "syn-number", "syn-type", "syn-fn", "syn-prop", "syn-const", "syn-regexp", "syn-meta", "syn-operator", "bracket-1", "bracket-2", "bracket-3"];
  const TEXT: ColorId[] = ["foreground", "muted-foreground", "primary", "primary-foreground", "success", "warning", "info", "destructive"];
  const SURFACES: ColorId[] = ["accent", "secondary", "card", "chrome", "background", "primary", "popover", "input", "border"];

  let ctx: CanvasRenderingContext2D | null = null;
  /** Any CSS color as RGBA bytes (the canvas parses oklch, color-mix and named colors alike). */
  function rgba(c: string): Uint8ClampedArray {
    if (!ctx) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      ctx = cv.getContext("2d", { willReadFrequently: true })!;
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  }
  /** The first candidate whose current color matches (within rounding). */
  function match(c: Uint8ClampedArray, ids: ColorId[]): ColorId | undefined {
    const pal = derive(current(), theme.dark);
    return ids.find((id) => {
      const p = rgba(hex(pal[id]));
      return Math.abs(p[0] - c[0]) + Math.abs(p[1] - c[1]) + Math.abs(p[2] - c[2]) <= 6;
    });
  }

  /** The theme color a Tailwind class like `bg-chrome` or `text-muted-foreground` names (no opacity suffix). */
  function classColor(el: Element, prefix: "bg-" | "text-", ids: ColorId[]): ColorId | undefined {
    for (const c of el.classList) if (c.startsWith(prefix) && ids.includes(c.slice(prefix.length) as ColorId)) return c.slice(prefix.length) as ColorId;
  }
  /** The point lies on text of `el`: own text or only inline children with text (names highlighted letter by
   *  letter). Empty space of a wide text element counts as its surface. */
  function onText(el: Element, x: number, y: number) {
    const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    const letters = el.children.length > 0 && !!el.textContent?.trim() && [...el.children].every((c) => c.tagName === "SPAN" && c.children.length === 0);
    if (!own && !letters) return false;
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1);
  }

  /** Which color a click on `el` means, and the element to outline: its text color, else the surface behind it.
   *  Tailwind classes name the token directly; otherwise the rendered color is matched against the theme. */
  function hit(el: Element, x: number, y: number): { id: ColorId; box: Element } {
    const area = el.closest<HTMLElement>("[data-theme-area]");
    const own = area?.dataset.themeArea as ColorId | undefined;
    const gutter = el.closest(".cm-gutters");
    if (gutter) return { id: "line-number", box: gutter };
    if (onText(el, x, y)) {
      const code = !!el.closest(".cm-editor");
      const list = code ? CODE : TEXT;
      // A name highlighted letter by letter: outline the whole name, not one letter.
      const p = el.parentElement;
      const box = !code && el.tagName === "SPAN" && p && [...p.children].every((c) => c.tagName === "SPAN" && c.children.length === 0) ? p : el;
      // The color comes from the nearest ancestor that sets one: its class, else the matching theme color.
      for (let n: Element | null = el; n && !code && n !== area; n = n.parentElement) {
        const id = classColor(n, "text-", list);
        if (id) return { id, box };
      }
      const id = match(rgba(getComputedStyle(el).color), list);
      if (id) return { id, box };
    }
    const surfaces: ColorId[] = [...(own ? [own] : []), ...(el.closest(".cm-editor") ? (["current-line", "code-selection"] as const) : []), ...SURFACES];
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n === document.documentElement) return { id: "background", box: n };
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 250) return { id: classColor(n, "bg-", [...surfaces, "terminal", "activity", "files", "editor"]) ?? match(c, surfaces) ?? own ?? "background", box: n };
      if (n === area) break;
    }
    return { id: own ?? "background", box: area ?? document.documentElement };
  }

  let hover = $state<{ id: ColorId; r: DOMRect } | null>(null);

  $effect(() => {
    if (!themeEditor.open || !themeEditor.picking) return;
    const inPanel = (e: Event) => !!(e.target as Element | null)?.closest?.("[data-theme-editor]");
    const swallow = (e: Event) => {
      if (inPanel(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const down = (e: PointerEvent) => {
      if (inPanel(e) || !(e.target instanceof Element)) return;
      swallow(e);
      themeEditor.sel = hit(e.target, e.clientX, e.clientY).id;
    };
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el.closest("[data-theme-editor]")) return (hover = null);
        const h = hit(el, e.clientX, e.clientY);
        hover = { id: h.id, r: h.box.getBoundingClientRect() };
      });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      themeEditor.picking = false;
    };
    const blocked = ["mousedown", "mouseup", "pointerup", "click", "dblclick", "auxclick", "contextmenu"];
    window.addEventListener("pointerdown", down, true);
    for (const t of blocked) window.addEventListener(t, swallow, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("keydown", key, true);
    document.documentElement.classList.add("theme-picking");
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", down, true);
      for (const t of blocked) window.removeEventListener(t, swallow, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("keydown", key, true);
      document.documentElement.classList.remove("theme-picking");
      hover = null;
    };
  });

  function close() {
    themeEditor.open = false;
    themeEditor.picking = false;
  }
  function onkeydown(e: KeyboardEvent) {
    const field = (e.target as Element).closest("input, textarea");
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !field) {
      e.preventDefault();
      undoTheme();
    }
  }
</script>

{#if themeEditor.open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions (Ctrl+Z inside the panel undoes the last change) -->
  <aside
    data-theme-editor
    aria-label={t("Theme anpassen")}
    class="bg-card text-foreground border-border fixed top-9 right-0 bottom-0 z-40 flex w-[340px] flex-col border-l text-ui shadow-xl shadow-black/20"
    style={builtin}
    {onkeydown}
  >
    <div class="border-border flex h-10 shrink-0 items-center gap-1 border-b pr-1.5 pl-3">
      <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span class="font-semibold">{t("Theme anpassen")}</span>
        <span class="text-muted-foreground text-meta truncate">{th.name}</span>
      </span>
      <Button variant="toggle" size="sm" aria-pressed={themeEditor.picking} title={t("In die App klicken, um die Farbe dort zu öffnen (Esc beendet)")} onclick={() => (themeEditor.picking = !themeEditor.picking)}
        ><PipetteIcon class="size-3.5" />{t("Bereich wählen")}</Button
      >
      <IconButton size="md" label={t("Schließen")} onclick={close}><XIcon class="size-3.5" /></IconButton>
    </div>
    <div class="flex shrink-0 items-center gap-2 px-3 pt-2">
      <span class="text-muted-foreground text-meta flex-1">{t("Bearbeiteter Modus")}</span>
      <Segmented label={t("Bearbeiteter Modus")} value={theme.dark ? "dark" : "light"} options={[[t("Hell"), "light"], [t("Dunkel"), "dark"]] as const} onchange={(m) => setMode(m as "light" | "dark")} />
    </div>
    {#if themeEditor.picking}
      <p class="bg-secondary text-muted-foreground text-meta mx-3 mt-2 rounded-md px-2 py-1.5">{t("Klick in der App auf eine Stelle, um ihre Farbe hier zu öffnen. Esc beendet die Auswahl.")}</p>
    {/if}
    {#if isPreset(th.id)}
      <p class="text-muted-foreground text-meta mx-3 mt-2">{t("„{name}“ ist eingebaut. Die erste Änderung legt eine Kopie an.", { name: th.name })}</p>
    {/if}
    <div class="mt-1 min-h-0 flex-1 overflow-y-auto">
      <ThemeColors />
    </div>
    <div class="border-border flex shrink-0 items-center gap-1.5 border-t px-3 py-2">
      <span class="text-muted-foreground text-meta flex-1">{t("Wird sofort gespeichert")}</span>
      <Button variant="ghost" size="sm" disabled={!canUndo()} title={t("Rückgängig ({key})", { key: `${MOD}+Z` })} onclick={undoTheme}><Undo2Icon class="size-3.5" />{t("Rückgängig")}</Button>
      <Button size="sm" onclick={close}>{t("Fertig")}</Button>
    </div>
  </aside>
{/if}

{#if hover}
  <div
    class="pointer-events-none fixed z-[60] rounded-sm outline-2 outline-offset-1 outline-dashed"
    style="left:{hover.r.left}px;top:{hover.r.top}px;width:{hover.r.width}px;height:{hover.r.height}px;outline-color:{css(theme.dark ? DEFAULTS.dark.primary : DEFAULTS.light.primary)}"
  >
    <span
      class="text-meta absolute top-0 left-0 rounded px-1.5 py-0.5 font-medium whitespace-nowrap {hover.r.top < 22 ? '' : '-translate-y-full'}"
      style="background:{css(theme.dark ? DEFAULTS.dark.primary : DEFAULTS.light.primary)};color:{css(theme.dark ? DEFAULTS.dark['primary-foreground'] : DEFAULTS.light['primary-foreground'])}"
      >{COLOR_LABEL[hover.id] ?? hover.id}</span
    >
  </div>
{/if}

<style>
  :global(html.theme-picking body *:not([data-theme-editor] *)) {
    cursor: crosshair !important;
  }
</style>
