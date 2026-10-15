<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import XIcon from '@lucide/svelte/icons/x';
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import * as Dialog from "./index.js";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		align = "center",
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
		/** top: Oberkante auf einem Drittel der Hoehe (Command-Palette), waechst nach unten. */
		align?: "center" | "top";
	} = $props();
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<!-- Zentriert per Grid statt fixed + inset-0 + m-auto + h-fit: WebKitGTK ignoriert h-fit dort und streckt den
	     Dialog auf volle Hoehe. Kein translate, sonst wird der Text unter Linux unscharf. Klicks gehen durch zum Overlay. -->
	<div
		class={cn(
			"pointer-events-none fixed inset-0 z-50 grid grid-rows-[minmax(0,1fr)] justify-items-center p-4",
			align === "top" ? "items-start pt-[33.333vh]" : "items-center"
		)}
	>
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			"bg-popover glow text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 pointer-events-auto relative grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl p-4 text-sm ring-1 duration-100 sm:max-w-sm w-full min-h-0 max-h-full outline-none",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-2 right-2" size="icon-sm" {...props}>
						<XIcon  />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
	</div>
</DialogPortal>
