<script lang="ts">
  // Ctrl+Tab / Ctrl+Shift+Tab (Ctrl on mac too, like VS Code): open files in most-recently-used order.
  // Capture phase on window, so CodeMirror (indentWithTab) and the file tree never see the key.
  import { tick } from "svelte";
  import { Row, fileIcon } from "$lib/atelier-ui";
  import { filePanel, groupOf } from "$lib/dock";
  import { editor, open } from "$lib/editor.svelte";
  import { step } from "$lib/mru.logic";

  let { repo }: { repo: string } = $props();

  /** MRU snapshot while Ctrl is held; null = not switching. */
  let list = $state<string[] | null>(null);
  let i = $state(0);
  /** Shown only once Ctrl is held a moment, so a quick toggle does not flash the popup. */
  let shown = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let box = $state<HTMLElement>();

  // Many open files: the list scrolls, keep the selection visible.
  $effect(() => void box?.children[i]?.scrollIntoView({ block: "nearest" }));

  function cancel() {
    list = null;
    shown = false;
    clearTimeout(timer);
  }

  async function pick(path: string) {
    cancel();
    // preview: switching to the preview tab must not make it permanent.
    await open(repo, path, undefined, undefined, true);
    await tick();
    // A tab already visible in another group is not remounted and would not take focus by itself.
    document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"] .cm-content`)?.focus();
  }

  function down(e: KeyboardEvent) {
    if (list && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return cancel();
    }
    if (e.key !== "Tab" || !e.ctrlKey || e.altKey || e.metaKey || document.activeElement?.closest("[role=dialog]")) return;
    e.preventDefault();
    e.stopPropagation();
    if (!list) {
      const s = editor(repo);
      const files = s.recent.filter((p) => groupOf(s.layout, filePanel(p)));
      if (files.length < 2) return;
      [list, i] = [files, 0];
      timer = setTimeout(() => (shown = true), 150);
    }
    i = step(i, list.length, e.shiftKey);
  }
</script>

<svelte:window
  onkeydowncapture={down}
  onkeyupcapture={(e) => list && e.key === "Control" && pick(list[i])}
  onblur={cancel}
/>

{#if list && shown}
  <div
    bind:this={box}
    role="listbox"
    aria-label="Zuletzt verwendete Dateien"
    class="bg-popover text-popover-foreground ring-foreground/10 fixed top-14 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-px overflow-y-auto max-h-[calc(100vh-5rem)] rounded-lg p-1 shadow-lg ring-1 shadow-black/10 dark:shadow-black/40"
  >
    {#each list as path, k (path)}
      {@const cut = path.lastIndexOf("/") + 1}
      {@const ic = fileIcon(path)}
      <!-- No hover highlight: a resting mouse pointer would look like a second selection. -->
      <Row
        role="option"
        aria-selected={k === i}
        tabindex={-1}
        text="md"
        selected={k === i}
        class={k === i ? "" : "hover:bg-transparent"}
        title={path}
        onmousedown={(e) => (e.preventDefault(), pick(path))}
      >
        <ic.icon class="size-3.5 shrink-0 {ic.tint}" />
        <span class="min-w-0 truncate">{path.slice(cut)}</span>
        <span class="text-muted-foreground min-w-0 flex-1 truncate text-meta">{path.slice(0, cut)}</span>
      </Row>
    {/each}
  </div>
{/if}
