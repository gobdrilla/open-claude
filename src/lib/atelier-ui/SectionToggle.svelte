<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import { cn } from "$lib/utils.js";

  // Header of a collapsible section; renders the chevron and aria-expanded.
  // variant="item": expandable list entry (regular weight, text-ui) instead of a section header.
  let {
    open = $bindable(false),
    variant = "section",
    class: className,
    onclick,
    children,
    ...rest
  }: HTMLButtonAttributes & { open?: boolean; variant?: "section" | "item" } = $props();
</script>

<button
  type="button"
  class={cn(
    "hover:bg-accent/40 focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:ring-2",
    variant === "section" ? "py-1 text-meta font-semibold" : "py-1.5 text-ui",
    className,
  )}
  aria-expanded={open}
  onclick={(e) => (onclick ? onclick(e) : (open = !open))}
  {...rest}
>
  <ChevronRightIcon class="size-3 shrink-0 transition-transform {open ? 'rotate-90' : ''}" />
  {@render children?.()}
</button>
