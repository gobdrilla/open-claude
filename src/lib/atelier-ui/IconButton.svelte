<script lang="ts" module>
  import { tv } from "tailwind-variants";

  // Compact icon-only button (or a short glyph like "Aa") for dense panels and the title bar.
  export const iconButton = tv({
    base: "focus-visible:ring-ring/50 grid shrink-0 place-items-center rounded outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-40",
    variants: {
      size: {
        bare: "",
        xs: "size-4",
        sm: "size-5",
        md: "size-6",
        // Title bar: window controls and back.
        window: "h-9 w-11 rounded-none",
        // Short text instead of an icon ("Aa", ".*", "−").
        text: "h-5 min-w-5 px-1 font-mono text-[11px]",
      },
      tone: {
        muted: "text-muted-foreground hover:text-foreground",
        danger: "text-muted-foreground hover:text-destructive",
        primary: "text-muted-foreground hover:text-primary",
        // Keep the surrounding color (notice bar, tab).
        inherit: "text-inherit opacity-70 hover:opacity-100",
        // Close window: red on hover.
        close: "text-muted-foreground hover:bg-[#b4404a] hover:text-white",
      },
      // Only visible while hovering the row (parent with class="group").
      reveal: { true: "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" },
      active: { true: "text-primary" },
      // Toggle (aria-pressed): background when on.
      pressed: { true: "bg-primary/15 text-primary hover:text-primary" },
    },
    compoundVariants: [
      { size: ["xs", "sm", "md", "text", "window"], tone: ["muted", "primary"], pressed: false, class: "hover:bg-secondary" },
      { size: ["xs", "sm", "md", "text"], tone: "danger", class: "hover:bg-destructive/20" },
    ],
    defaultVariants: { size: "sm", tone: "muted" },
  });
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  // label is required: accessible name (aria-label) and tooltip (title; title={undefined} disables it).
  let {
    label,
    title = label,
    size = "sm",
    tone = "muted",
    reveal = false,
    active = false,
    pressed,
    class: className,
    ref = $bindable(null),
    children,
    ...rest
  }: HTMLButtonAttributes & {
    label: string;
    size?: "bare" | "xs" | "sm" | "md" | "window" | "text";
    tone?: "muted" | "danger" | "primary" | "inherit" | "close";
    reveal?: boolean;
    active?: boolean;
    /** Set = toggle button, sets aria-pressed. */
    pressed?: boolean;
    ref?: HTMLButtonElement | null;
  } = $props();
</script>

<button
  bind:this={ref}
  type="button"
  class={cn(iconButton({ size, tone, reveal, active, pressed: !!pressed }), className)}
  aria-label={label}
  aria-pressed={pressed}
  {title}
  {...rest}
>
  {@render children?.()}
</button>
