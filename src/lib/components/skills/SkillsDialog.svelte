<script lang="ts">
  import { Dialog } from "$lib/atelier-ui";
  import SkillsPanel from "./SkillsPanel.svelte";
  import type { SkillStore, ProjectSkills } from "$lib/skills";

  // Skills and plugins of one project, opened from the Claude bar.
  let {
    open = $bindable(false),
    repo,
    name,
    kind,
    store,
    onproject,
  }: {
    open?: boolean;
    repo: string;
    name: string;
    kind?: string | null;
    store: SkillStore;
    onproject: (ps: ProjectSkills) => void;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[85vh] flex-col gap-3 sm:max-w-4xl">
    <Dialog.Header>
      <Dialog.Title>Skills</Dialog.Title>
      <Dialog.Description>Skills und Plugins für „{name}“.</Dialog.Description>
    </Dialog.Header>
    <div class="border-border min-h-0 flex-1 overflow-hidden rounded-lg border">
      {#if open}<SkillsPanel {repo} {kind} {store} {onproject} />{/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
