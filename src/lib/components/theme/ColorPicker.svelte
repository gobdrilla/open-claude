<script lang="ts">
  import { Popover } from "bits-ui";
  import { IconButton, Input, Slider, menuContent } from "$lib/atelier-ui";
  import { css, fromHex, hex, type Oklch } from "$lib/color";
  import { t } from "$lib/i18n";

  // OKLCH picker: swatch button, popover with ready-made colors, native range sliders (keyboard and screen reader
  // for free) and a hex field. `lightness` false: hue/chroma seeds whose lightness the theme picks per mode.
  let {
    value,
    label,
    onchange,
    lightness = true,
    maxC = 0.37,
  }: { value: Oklch; label: string; onchange: (v: Oklch) => void; lightness?: boolean; maxC?: number } = $props();

  let text = $state("");
  $effect(() => {
    text = hex(value);
  });

  // OKLCH hue 0 is pink; the hue track starts at red instead.
  const RED = 29;
  // Tints (small maxC, e.g. base tone) get a third of the range, so a click does not flood the surfaces.
  const vivid = $derived(maxC < 0.16 ? maxC / 3 : 0.16);
  const SWATCHES: [string, number][] = [
    ["Rot", RED],
    ["Orange", 55],
    ["Gelb", 95],
    ["Grün", 145],
    ["Türkis", 190],
    ["Blau", 255],
    ["Lila", 295],
    ["Pink", 350],
  ];

  const set = (k: keyof Oklch, v: number) => onchange({ ...value, [k]: v });
  function typed() {
    const c = fromHex(text);
    if (c) onchange(lightness ? c : { ...value, h: c.h, c: Math.min(maxC, c.c) });
    else text = hex(value);
  }
  const at = (v: Partial<Oklch>) => css({ ...value, ...v });
  const tracks = $derived({
    l: `linear-gradient(to right in oklch, ${at({ l: 0 })}, ${at({ l: 1 })})`,
    c: `linear-gradient(to right in oklch, ${at({ c: 0 })}, ${at({ c: maxC })})`,
    h: `linear-gradient(to right in oklch longer hue, ${at({ h: RED })}, ${at({ h: RED - 0.1 })})`,
  });
</script>

<Popover.Root>
  <Popover.Trigger class="border-border hover:bg-accent/50 flex h-6 shrink-0 items-center gap-1.5 rounded border px-1.5 text-ui" aria-label={label}>
    <span class="ring-foreground/15 size-3.5 rounded-sm ring-1" style:background={css(value)}></span>
    <span class="font-mono text-meta">{hex(value)}</span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="{menuContent} flex w-64 flex-col gap-2.5 p-3" sideOffset={4} align="end" collisionPadding={8}>
      <div class="grid grid-cols-9 gap-1">
        {#each SWATCHES as [name, h] (name)}
          <IconButton size="bare" class="ring-foreground/15 aspect-square w-full rounded-full ring-1" label={t(name)} style="background: {at({ h, c: vivid })}" onclick={() => onchange({ ...value, h, c: vivid })} />
        {/each}
        <IconButton size="bare" class="ring-foreground/15 aspect-square w-full rounded-full ring-1" label={t("Grau")} style="background: {at({ c: 0 })}" onclick={() => set("c", 0)} />
      </div>
      <label class="flex flex-col gap-1 text-meta">
        <span class="text-muted-foreground">{t("Farbton")}</span>
        <Slider class="picker-track w-full" min={0} max="360" step="1" value={(value.h - RED + 360) % 360} style="--track: {tracks.h}" oninput={(e) => set("h", (+e.currentTarget.value + RED) % 360)} />
      </label>
      <label class="flex flex-col gap-1 text-meta">
        <span class="text-muted-foreground">{t("Sättigung")}</span>
        <Slider class="picker-track w-full" min={0} max={maxC} step="0.002" value={value.c} style="--track: {tracks.c}" oninput={(e) => set("c", +e.currentTarget.value)} />
      </label>
      {#if lightness}
        <label class="flex flex-col gap-1 text-meta">
          <span class="text-muted-foreground">{t("Helligkeit")}</span>
          <Slider class="picker-track w-full" min={0} max="1" step="0.005" value={value.l} style="--track: {tracks.l}" oninput={(e) => set("l", +e.currentTarget.value)} />
        </label>
      {/if}
      <label class="flex items-center gap-2 text-meta">
        <span class="text-muted-foreground">Hex</span>
        <Input
          density="xs"
          class="flex-1 font-mono"
          bind:value={text}
          onchange={typed}
          onkeydown={(e) => e.key === "Enter" && typed()}
        />
      </label>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

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
