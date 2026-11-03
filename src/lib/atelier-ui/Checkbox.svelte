<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  // With children: checkbox plus clickable label text. Without children it needs an aria-label.
  // size: sm = text-meta (pane bars), md = text-ui (dialogs), inherit = surrounding font size.
  let {
    checked = $bindable(false),
    size = "inherit",
    muted = false,
    class: className,
    children,
    ...rest
  }: Omit<HTMLInputAttributes, "type" | "size"> & {
    checked?: boolean;
    size?: "inherit" | "sm" | "md";
    muted?: boolean;
  } = $props();

  const SIZE = { inherit: "gap-2", sm: "gap-1 text-meta", md: "gap-2 text-ui" };
</script>

{#if children}
  <label class={cn("flex cursor-pointer items-center", SIZE[size], muted && "text-muted-foreground", className)}>
    <input type="checkbox" class="accent-primary" bind:checked {...rest} />
    {@render children()}
  </label>
{:else}
  <input type="checkbox" class={cn("accent-primary", className)} bind:checked {...rest} />
{/if}
