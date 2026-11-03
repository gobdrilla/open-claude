<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn } from "$lib/utils.js";

  let {
    value = $bindable(0),
    class: className,
    ...rest
  }: Omit<HTMLInputAttributes, "type" | "value"> & { value?: number } = $props();
</script>

<input type="range" class={cn("accent-primary w-24", className)} bind:value {...rest} />
