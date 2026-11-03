<script lang="ts" module>
  import { tv } from "tailwind-variants";
  import { twMergeConfig } from "$lib/utils.js";

  // Clickable list row (branches, files, matches, history) or card (variant="card").
  export const row = tv({
    base: "focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-1.5 text-left outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
    variants: {
      variant: {
        list: "hover:bg-accent/60 rounded-md px-2",
        // Choice card: bordered, stronger border on hover, selected uses the primary color.
        card: "bg-card border-border/60 hover:border-border flex-col items-stretch gap-0.5 rounded-lg border px-2 transition-colors",
      },
      density: { compact: "py-0.5", default: "py-1", roomy: "py-1.5" },
      text: { sm: "text-meta", md: "text-ui" },
      // Rows inside framed lists: square corners.
      flush: { true: "rounded-none" },
      indent: { true: "pl-6" },
      // Current entry (e.g. the checked-out branch).
      active: { true: "bg-primary/10 text-primary font-semibold" },
      // Selected entry (list with selection/detail view).
      selected: { true: "" },
      dim: { true: "opacity-50" },
      tone: { default: "", danger: "text-destructive" },
    },
    compoundVariants: [
      { variant: "list", selected: true, class: "bg-accent text-foreground hover:bg-accent" },
      { variant: "card", selected: true, class: "border-primary/60 bg-primary/5 hover:border-primary/60" },
    ],
    defaultVariants: { variant: "list", density: "default", text: "sm" },
  }, { twMergeConfig });
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  let {
    variant = "list",
    density = "default",
    text = "sm",
    flush = false,
    indent = false,
    active = false,
    selected = false,
    dim = false,
    tone = "default",
    class: className,
    ref = $bindable(null),
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: "list" | "card";
    density?: "compact" | "default" | "roomy";
    text?: "sm" | "md";
    flush?: boolean;
    indent?: boolean;
    active?: boolean;
    selected?: boolean;
    dim?: boolean;
    tone?: "default" | "danger";
    ref?: HTMLButtonElement | null;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class={cn(row({ variant, density, text, flush, indent, active, selected, dim, tone }), className)}
  {...rest}
>
  {@render children?.()}
</button>
