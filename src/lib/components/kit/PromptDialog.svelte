<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";

  let {
    open,
    title,
    description,
    value = $bindable(),
    placeholder,
    action = "OK",
    mono = false,
    onsubmit,
    oncancel,
    children,
  }: {
    open: boolean;
    title: string;
    description?: string;
    value: string;
    placeholder?: string;
    action?: string;
    mono?: boolean;
    onsubmit: () => void;
    oncancel: () => void;
    children?: Snippet;
  } = $props();

  function keydown(e: KeyboardEvent) {
    if (e.key === "Enter") onsubmit();
    // Tab im leeren Feld uebernimmt einen Platzhalter wie "feature/…" ohne die Auslassungspunkte.
    else if (e.key === "Tab" && !e.shiftKey && !value && placeholder?.endsWith("…")) {
      e.preventDefault();
      value = placeholder.slice(0, -1);
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(o) => !o && oncancel()}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}<Dialog.Description>{description}</Dialog.Description>{/if}
    </Dialog.Header>
    <Input bind:value {placeholder} class={mono ? "font-mono" : ""} onkeydown={keydown} autofocus />
    {@render children?.()}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={oncancel}>Abbrechen</Button>
      <Button size="sm" onclick={onsubmit}>{action}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
