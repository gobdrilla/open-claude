<script lang="ts">
  import { Input, Slider } from "$lib/atelier-ui";
  import { css, fromHex, hex, toGamut, type Oklch } from "$lib/color";
  import { t } from "$lib/i18n";

  // OKLCH sliders for hue, saturation (chroma) and lightness, plus a hex field. Native ranges: keyboard and screen
  // reader for free. No limits beyond the sRGB gamut: the color the user picks is the color the app shows.
  let { value, onchange }: { value: Oklch; onchange: (v: Oklch) => void } = $props();

  let text = $state("");
  $effect(() => {
    text = hex(value);
  });

  // OKLCH hue 0 is pink; the hue track starts at red instead.
  const RED = 29;
  const MAX_C = 0.37;

  const set = (k: keyof Oklch, v: number) => onchange(toGamut({ ...value, [k]: v }));
  function typed() {
    const c = fromHex(text);
    if (c) onchange(c);
    else text = hex(value);
  }
  const at = (v: Partial<Oklch>) => css({ ...value, ...v });
  // Hue and saturation tracks at a visible lightness and chroma: for black, white or gray they would be one flat color.
  const shown = $derived({ l: Math.min(0.8, Math.max(0.55, value.l)), c: Math.max(0.12, value.c) });
  const tracks = $derived({
    l: `linear-gradient(to right in oklch, ${at({ l: 0 })}, ${at({ l: 0.5 })}, ${at({ l: 1 })})`,
    // oklab: gray has no hue, oklch would sweep around the hue circle on the way to the color.
    c: `linear-gradient(to right in oklab, ${at({ l: shown.l, c: 0 })}, ${at({ l: shown.l, c: MAX_C })})`,
    h: `linear-gradient(to right in oklch longer hue, ${at({ ...shown, h: RED })}, ${at({ ...shown, h: RED - 0.1 })})`,
  });
</script>

<div class="flex flex-col gap-2">
  <label class="flex flex-col gap-1 text-meta">
    <span class="text-muted-foreground">{t("Farbton")}</span>
    <Slider class="picker-track w-full" min={0} max="360" step="1" value={(value.h - RED + 360) % 360} style="--track: {tracks.h}" oninput={(e) => set("h", (+e.currentTarget.value + RED) % 360)} />
  </label>
  <label class="flex flex-col gap-1 text-meta">
    <span class="text-muted-foreground">{t("Sättigung")}</span>
    <Slider class="picker-track w-full" min={0} max={MAX_C} step="0.002" value={value.c} style="--track: {tracks.c}" oninput={(e) => set("c", +e.currentTarget.value)} />
  </label>
  <label class="flex flex-col gap-1 text-meta">
    <span class="text-muted-foreground">{t("Helligkeit")}</span>
    <Slider class="picker-track w-full" min={0} max="1" step="0.005" value={value.l} style="--track: {tracks.l}" oninput={(e) => set("l", +e.currentTarget.value)} />
  </label>
  <label class="flex items-center gap-2 text-meta">
    <span class="text-muted-foreground">Hex</span>
    <Input density="xs" class="w-24 font-mono" bind:value={text} onchange={typed} onkeydown={(e) => e.key === "Enter" && typed()} />
  </label>
</div>

<style>
  /* Global: the input sits inside <Slider>, outside this component's scope. */
  :global(.picker-track) {
    appearance: none;
    height: 0.75rem;
    border-radius: 9999px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 12%, transparent);
    cursor: pointer;
  }
  :global(.picker-track::-webkit-slider-thumb) {
    appearance: none;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 9999px;
    background: white;
    border: 2px solid oklch(0.2 0 0);
    box-shadow: 0 0 0 1px white;
  }
  :global(.picker-track:focus-visible::-webkit-slider-thumb) {
    box-shadow: 0 0 0 3px var(--ring);
  }
</style>
