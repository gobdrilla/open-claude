<script lang="ts" module>
	export const OPEN_KEY = Symbol("dialog-open");
</script>

<script lang="ts">
	import { setContext } from "svelte";
	import { Dialog as DialogPrimitive } from "bits-ui";

	let { open = $bindable(false), ...restProps }: DialogPrimitive.RootProps = $props();
	// Fuer Content: das Portal erst beim Oeffnen anhaengen (siehe dialog-content.svelte).
	setContext(OPEN_KEY, () => open);
</script>

<DialogPrimitive.Root bind:open {...restProps} />
