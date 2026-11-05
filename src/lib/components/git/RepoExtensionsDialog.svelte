<script lang="ts">
  import { t } from "$lib/i18n";
  import { Button, Dialog, SettingsSection } from "$lib/atelier-ui";
  import { active, loadRepo } from "$lib/extensions.svelte";
  import ExtensionSettingRows from "$lib/components/ExtensionSettingRows.svelte";

  // Per-project overrides (local git config of repo; in a submodule that is the submodule). Empty field = global value.
  let { open = $bindable(false), repo, name }: { open: boolean; repo: string; name: string } = $props();

  const list = $derived(active().filter((m) => m.contributes.settings.some((d) => d.scope === "repo")));
  $effect(() => {
    if (open) loadRepo(repo);
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{t("Erweiterungen · {name}", { name })}</Dialog.Title>
      <Dialog.Description>{t("Leere Felder nutzen den globalen Wert aus Einstellungen › Erweiterungen.")}</Dialog.Description>
    </Dialog.Header>
    {#each list as m (m.id)}
      <SettingsSection title={m.name}>
        <ExtensionSettingRows ext={m} {repo} />
      </SettingsSection>
    {/each}
    <div class="flex justify-end">
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>{t("Schließen")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
