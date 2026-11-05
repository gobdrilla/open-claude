<script lang="ts">
  import { IconButton, Segmented, Select, Slider } from "$lib/atelier-ui";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { t } from "$lib/i18n";
  import { css } from "$lib/color";
  import { MAX_STOPS, REFS, gradientCss, type Gradient, type Ref, type Stop } from "$lib/themes";
  import { REF_LABELS } from "./labels";
  import ColorPicker from "./ColorPicker.svelte";

  // Stop bar like Figma: click the bar adds a stop, drag or arrow keys move one (Shift: 10 %), Delete removes it.
  let { g, change }: { g: Gradient; change: (fn: (g: Gradient) => void) => void } = $props();

  let sel = $state(0);
  const i = $derived(Math.min(sel, g.stops.length - 1));
  const stop = $derived(g.stops[i]);
  let bar = $state<HTMLDivElement>();

  // The bar shows the stops left to right regardless of kind/angle.
  const preview = $derived(gradientCss({ ...g, kind: "linear", angle: 90 }));
  const CHECKER = "repeating-conic-gradient(var(--muted) 0 25%, var(--card) 0 50%) 0 0 / 10px 10px";

  const posAt = (x: number) => {
    const r = bar!.getBoundingClientRect();
    return Math.round(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)));
  };
  const setStop = (k: number, fn: (s: Stop) => void) => change((gr) => fn(gr.stops[k]));

  function add(e: MouseEvent) {
    if (e.target !== bar || g.stops.length >= MAX_STOPS) return;
    const pos = posAt(e.clientX);
    change((gr) => gr.stops.push({ color: structuredClone($state.snapshot(stop.color)), alpha: stop.alpha, pos }));
    sel = g.stops.length - 1;
  }
  function remove(k: number) {
    if (g.stops.length <= 2) return;
    change((gr) => gr.stops.splice(k, 1));
    sel = Math.max(0, k - 1);
  }
  function drag(e: PointerEvent, k: number) {
    sel = k;
    const el = e.currentTarget as HTMLElement;
    // WebKit does not focus buttons on click and its mousedown default would move focus away: arrow keys need it.
    e.preventDefault();
    el.focus();
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setStop(k, (s) => (s.pos = posAt(ev.clientX)));
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", () => el.removeEventListener("pointermove", move), { once: true });
  }
  function key(e: KeyboardEvent, k: number) {
    const step = e.shiftKey ? 10 : 1;
    const d = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : e.key === "ArrowRight" || e.key === "ArrowUp" ? step : 0;
    if (d) setStop(k, (s) => (s.pos = Math.min(100, Math.max(0, s.pos + d))));
    else if (e.key === "Home" || e.key === "End") setStop(k, (s) => (s.pos = e.key === "Home" ? 0 : 100));
    else if (e.key === "Delete" || e.key === "Backspace") remove(k);
    else return;
    e.preventDefault();
  }

  const SOURCES = $derived([...REFS.map((r) => [REF_LABELS[r], r] as const), [t("Eigene Farbe"), "own"] as const]);
  const source = $derived("ref" in stop.color ? stop.color.ref : "own");
  function setSource(v: string) {
    setStop(i, (s) => (s.color = v === "own" ? { l: 0.7, c: 0.12, h: 292 } : { ref: v as Ref }));
  }
  const label = (s: Stop, k: number) => t("Stopp {n}: {color}, {pos} %", { n: k + 1, color: "ref" in s.color ? REF_LABELS[s.color.ref] : t("Eigene Farbe"), pos: Math.round(s.pos) });
</script>

<div class="flex flex-col gap-2 px-2 py-2">
  <div class="flex flex-wrap items-center gap-2">
    <Segmented
      label={t("Art")}
      value={g.kind}
      options={[[t("Linear"), "linear"], [t("Radial"), "radial"], [t("Konisch"), "conic"]] as const}
      onchange={(v) => change((gr) => (gr.kind = v))}
    />
    <Segmented
      label={t("Farbraum")}
      value={g.space}
      options={[["Oklab", "oklab", t("Gleichmäßig, ohne Farbstich in der Mitte")], ["OkLCH", "oklch", t("Kräftig, kurzer Weg über den Farbkreis")], [t("OkLCH lang"), "longer", t("Regenbogen: langer Weg über den Farbkreis")]] as const}
      onchange={(v) => change((gr) => (gr.space = v))}
    />
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="relative mx-2 my-1 h-6 cursor-copy rounded ring-1 ring-foreground/10" style:background="{preview}, {CHECKER}" bind:this={bar} onclick={add}>
    {#each g.stops as s, k (k)}
      <button
        class="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 shadow {k === i ? 'border-ring ring-2 ring-ring/40' : 'border-white'}"
        style:left="{s.pos}%"
        style:background={"ref" in s.color ? `var(--${s.color.ref})` : css(s.color)}
        role="slider"
        aria-label={t("Stopp {n}", { n: k + 1 })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.pos)}
        aria-valuetext={label(s, k)}
        onpointerdown={(e) => drag(e, k)}
        onkeydown={(e) => key(e, k)}
        onfocus={() => (sel = k)}
      ></button>
    {/each}
  </div>
  <p class="text-muted-foreground text-meta px-2">{t("Klick auf die Leiste fügt einen Stopp hinzu; Pfeiltasten verschieben, Entf entfernt.")}</p>

  <div class="flex flex-wrap items-center gap-2 px-2">
    <span class="text-ui">{t("Stopp {n}", { n: i + 1 })}</span>
    <Select value={source} options={SOURCES} onchange={setSource} aria-label={t("Farbe von Stopp {n}", { n: i + 1 })} class="w-36" />
    {#if !("ref" in stop.color)}
      <ColorPicker value={stop.color} label={t("Farbe von Stopp {n}", { n: i + 1 })} onchange={(v) => setStop(i, (s) => (s.color = v))} />
    {/if}
    <label class="text-muted-foreground flex items-center gap-1.5 text-meta"
      >{t("Deckkraft")}
      <Slider min={0} max={100} value={stop.alpha} oninput={(e) => setStop(i, (s) => (s.alpha = +e.currentTarget.value))} />
      <span class="w-8 font-mono">{Math.round(stop.alpha)} %</span></label
    >
    <IconButton size="md" tone="danger" label={t("Stopp {n} entfernen", { n: i + 1 })} disabled={g.stops.length <= 2} onclick={() => remove(i)}
      ><TrashIcon class="size-3.5" /></IconButton
    >
  </div>

  <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2">
    {#if g.kind !== "radial"}
      <label class="text-muted-foreground flex items-center gap-1.5 text-meta"
        >{t("Winkel")}
        <Slider min={0} max={360} value={g.angle} oninput={(e) => change((gr) => (gr.angle = +e.currentTarget.value))} />
        <span class="w-8 font-mono">{Math.round(g.angle)}°</span></label
      >
    {/if}
    {#if g.kind !== "linear"}
      <label class="text-muted-foreground flex items-center gap-1.5 text-meta"
        >{t("Mitte X")}
        <Slider min={0} max={100} value={g.x} oninput={(e) => change((gr) => (gr.x = +e.currentTarget.value))} />
        <span class="w-8 font-mono">{Math.round(g.x)} %</span></label
      >
      <label class="text-muted-foreground flex items-center gap-1.5 text-meta"
        >{t("Mitte Y")}
        <Slider min={0} max={100} value={g.y} oninput={(e) => change((gr) => (gr.y = +e.currentTarget.value))} />
        <span class="w-8 font-mono">{Math.round(g.y)} %</span></label
      >
    {/if}
  </div>
</div>
