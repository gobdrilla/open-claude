<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from "$lib/utils.js";
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		density = "default",
		bare = false,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> & {
		/** Atelier: sm = text-xs, xs = 11px like pane fields. */
		density?: "default" | "sm" | "xs";
		/** Atelier: borderless, fixed size, fills its space (editor surfaces). */
		bare?: boolean;
	} = $props();

	const DENSITY = {
		default: "",
		sm: "text-xs md:text-xs",
		xs: "px-2 py-1 text-[11px] md:text-[11px]",
	};
	const BARE = "bg-background dark:bg-background field-sizing-fixed min-h-0 resize-none rounded-none border-0 focus-visible:ring-0";
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		"border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 disabled:bg-input/50 dark:disabled:bg-input/80 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors focus-visible:ring-3 aria-invalid:ring-3 md:text-sm flex field-sizing-content min-h-16 w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
		DENSITY[density],
		bare && BARE,
		className
	)}
	bind:value
	{...restProps}></textarea>
