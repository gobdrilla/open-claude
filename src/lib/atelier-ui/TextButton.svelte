<script lang="ts" module>
  import { tv } from "tailwind-variants";
  import { twMergeConfig } from "$lib/utils.js";

  // Unobtrusive text action inline or in headers ("+ Neu", "Alle anzeigen", links).
  export const textButton = tv({
    base: "focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm text-left outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
    variants: {
      tone: {
        muted: "text-muted-foreground hover:text-foreground",
        primary: "text-primary",
        // Muted, primary on hover (SHAs, references).
        link: "text-muted-foreground hover:text-primary",
        danger: "text-muted-foreground hover:text-destructive",
        plain: "hover:text-foreground",
        // Keep the surrounding color (e.g. an error notice).
        inherit: "text-inherit hover:opacity-80",
      },
      size: { inherit: "", sm: "text-meta" },
      underline: { true: "underline-offset-2 hover:underline" },
      // Full width, centered: "load more" below lists.
      block: { true: "w-full justify-center px-2 py-2" },
    },
    defaultVariants: { tone: "muted", size: "inherit" },
  }, { twMergeConfig });
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  let {
    tone = "muted",
    size = "inherit",
    underline = false,
    block = false,
    class: className,
    ref = $bindable(null),
    children,
    ...rest
  }: HTMLButtonAttributes & {
    tone?: "muted" | "primary" | "link" | "danger" | "plain" | "inherit";
    size?: "inherit" | "sm";
    underline?: boolean;
    block?: boolean;
    ref?: HTMLButtonElement | null;
  } = $props();
</script>

<button bind:this={ref} type="button" class={cn(textButton({ tone, size, underline, block }), className)} {...rest}>
  {@render children?.()}
</button>
