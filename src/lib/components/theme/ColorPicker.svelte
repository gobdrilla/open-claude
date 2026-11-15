<script lang="ts">
  import { Popover } from "bits-ui";
  import { IconButton, menuContent } from "$lib/atelier-ui";
  import { css, hex, type Oklch } from "$lib/color";
  import { t } from "$lib/i18n";
  import ColorFields from "./ColorFields.svelte";

  // Swatch button with a popover: ready-made colors, then the sliders and hex field of ColorFields.
  let { value, label, onchange }: { value: Oklch; label: string; onchange: (v: Oklch) => void } = $props();

  const VIVID = 0.16;
  const SWATCHES: [string, number][] = [
    ["Rot", 29],
    ["Orange", 55],
    ["Gelb", 95],
    ["Grün", 145],
    ["Türkis", 190],
    ["Blau", 255],
    ["Lila", 295],
    ["Pink", 350],
  ];
  const at = (v: Partial<Oklch>) => css({ ...value, ...v });
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
          <IconButton size="bare" class="ring-foreground/15 aspect-square w-full rounded-full ring-1" label={t(name)} style="background: {at({ h, c: VIVID })}" onclick={() => onchange({ ...value, h, c: VIVID })} />
        {/each}
        <IconButton size="bare" class="ring-foreground/15 aspect-square w-full rounded-full ring-1" label={t("Grau")} style="background: {at({ c: 0 })}" onclick={() => onchange({ ...value, c: 0 })} />
      </div>
      <ColorFields {value} {onchange} />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
