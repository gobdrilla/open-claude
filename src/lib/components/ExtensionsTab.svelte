<script lang="ts">
  import { Button, RefreshButton, SettingRow, SettingsSection, Switch } from "$lib/atelier-ui";
  import { invoke } from "@tauri-apps/api/core";
  import { linkerProblems, resolve, type Manifest } from "$lib/extensions.logic";
  import { exts, isOn, rescan, setEnabled, type Entry } from "$lib/extensions.svelte";
  import ExtensionSettingRows from "./ExtensionSettingRows.svelte";

  // Settings › Erweiterungen. Rescans on open (a manifest only changes while someone develops it), no file watcher.
  rescan();

  let error = $state("");
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const label = (e: Entry) => (e.manifest ? `${e.manifest.name} ${e.manifest.version}` : base(e.dir ?? e.key));
  const info = (e: Entry) => (e.source === "user" ? `Eigene Erweiterung · ${base(e.dir!)}` : e.manifest?.description);
  // Link patterns broken by their manifest defaults (own settings are checked while editing).
  const problems = (m: Manifest) => linkerProblems(m, resolve(m.contributes.settings, exts.settings[m.id] ?? {}, {}));
  async function openDir() {
    error = "";
    try {
      await invoke("reveal", { path: await invoke<string>("ext_dir") });
    } catch (e) {
      error = String(e);
    }
  }
</script>

<SettingsSection title="Installiert">
  {#each exts.list as e (e.key)}
    <div>
      <SettingRow label={label(e)} description={info(e)}>
        <Switch label="{label(e)} einschalten" on={isOn(e)} disabled={!!e.error} onclick={() => setEnabled(e.manifest!.id, !isOn(e))} />
      </SettingRow>
      {#if e.error || e.warnings.length}
        <p class="{e.error ? 'text-destructive' : 'text-muted-foreground'} text-meta -mt-1.5 px-2 pb-1.5">{e.error ?? e.warnings.join(" · ")}</p>
      {/if}
    </div>
  {/each}
</SettingsSection>

{#each exts.list.filter((e) => isOn(e) && e.manifest!.contributes.settings.length) as e (e.key)}
  {@const m = e.manifest!}
  <SettingsSection title={m.name}>
    <ExtensionSettingRows ext={m} />
    {#each problems(m) as p (p)}<p class="text-destructive text-meta px-2 py-1.5">{p}</p>{/each}
  </SettingsSection>
{/each}

<SettingsSection title="Eigene Erweiterungen">
  <SettingRow label="Erweiterungsordner" description="Je Erweiterung ein Ordner mit manifest.json. Neue sind erst aus und lassen sich oben einschalten.">
    <div class="flex items-center gap-2">
      <RefreshButton loading={exts.scanning} onclick={rescan} />
      <Button variant="outline" size="sm" onclick={openDir}>Ordner öffnen</Button>
    </div>
  </SettingRow>
  {#if error}<p class="text-destructive text-meta px-2 py-1.5">{error}</p>{/if}
</SettingsSection>
