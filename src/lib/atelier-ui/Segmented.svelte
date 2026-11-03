<script lang="ts" generics="T">
  import type XIcon from "@lucide/svelte/icons/x";

  // variant "nav": view switcher (title bar), raised active segment like Button variant="toggle".
  let {
    value,
    options,
    onchange,
    disabled = false,
    variant = "default",
    label,
  }: {
    value: T;
    options: readonly (readonly [label: string, value: T, title?: string, icon?: typeof XIcon])[];
    onchange: (v: T) => void;
    disabled?: boolean;
    variant?: "default" | "nav";
    /** aria-label of the group */
    label?: string;
  } = $props();

  const nav = $derived(variant === "nav");
</script>

<div role="group" aria-label={label} class="bg-secondary flex w-fit shrink-0 {nav ? 'h-7 gap-0.5 rounded-lg p-0.5' : 'rounded p-0.5'}">
  {#each options as [text, v, title, Icon] (text)}
    <button
      class={nav
        ? `text-ui flex items-center gap-1.5 rounded-md px-3 ${value === v
            ? "bg-background text-foreground ring-foreground/10 font-semibold ring-1 [&_svg]:text-primary"
            : "text-muted-foreground hover:text-foreground"}`
        : `text-meta flex items-center gap-1 rounded px-1.5 py-0.5 ${value === v
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"}`}
      aria-pressed={value === v}
      {title}
      {disabled}
      onclick={() => onchange(v)}>{#if Icon}<Icon class="size-3.5" />{/if}{text}</button
    >
  {/each}
</div>
