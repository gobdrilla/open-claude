<script lang="ts">
  import { Popover } from "bits-ui";
  import { menuContent } from "$lib/atelier-ui";
  import { css, fromHex, hex, type Oklch } from "$lib/color";
  import { t } from "$lib/i18n";

  // OKLCH picker: swatch button, popover with native range sliders (keyboard and screen reader for free) and a
  // hex field. `lightness` false: hue/chroma seeds whose lightness the theme picks per mode.
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
    h: `linear-gradient(to right in oklch longer hue, ${at({ h: 0 })}, ${at({ h: 359.9 })})`,
  });
</script>

<Popover.Root>
  <Popover.Trigger class="border-border hover:bg-accent/50 flex h-6 shrink-0 items-center gap-1.5 rounded border px-1.5 text-ui" aria-label={label}>
    <span class="ring-foreground/15 size-3.5 rounded-sm ring-1" style:background={css(value)}></span>
    <span class="font-mono text-meta">{hex(value)}</span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="{menuContent} flex w-64 flex-col gap-2 p-3" sideOffset={4} align="end" collisionPadding={8}>
      <div class="h-8 rounded ring-1 ring-foreground/10" style:background={css(value)}></div>
      {#if lightness}
        <label class="flex flex-col gap-0.5 text-meta">
          <span class="text-muted-foreground flex justify-between">{t("Helligkeit")}<span class="font-mono">{Math.round(value.l * 100)}</span></span>
          <input class="track" type="range" min="0" max="1" step="0.005" value={value.l} style:--track={tracks.l} oninput={(e) => set("l", +e.currentTarget.value)} />
        </label>
      {/if}
      <label class="flex flex-col gap-0.5 text-meta">
        <span class="text-muted-foreground flex justify-between">{t("Sättigung")}<span class="font-mono">{value.c.toFixed(3)}</span></span>
        <input class="track" type="range" min="0" max={maxC} step="0.002" value={value.c} style:--track={tracks.c} oninput={(e) => set("c", +e.currentTarget.value)} />
      </label>
      <label class="flex flex-col gap-0.5 text-meta">
        <span class="text-muted-foreground flex justify-between">{t("Farbton")}<span class="font-mono">{Math.round(value.h)}°</span></span>
        <input class="track" type="range" min="0" max="360" step="1" value={value.h} style:--track={tracks.h} oninput={(e) => set("h", +e.currentTarget.value)} />
      </label>
      <label class="flex items-center gap-2 text-meta">
        <span class="text-muted-foreground">Hex</span>
        <input
          class="bg-secondary border-border h-6 min-w-0 flex-1 rounded border px-1.5 font-mono text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          bind:value={text}
          spellcheck="false"
          onchange={typed}
          onkeydown={(e) => e.key === "Enter" && typed()}
        />
      </label>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  .track {
    appearance: none;
    height: 0.75rem;
    border-radius: 9999px;
    background: var(--track);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 12%, transparent);
    cursor: pointer;
  }
  .track::-webkit-slider-thumb {
    appearance: none;
    width: 0.875rem;
    height: 0.875rem;
    border-radius: 9999px;
    background: white;
    border: 2px solid oklch(0.2 0 0);
    box-shadow: 0 0 0 1px white;
  }
  .track:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px var(--ring);
  }
</style>
