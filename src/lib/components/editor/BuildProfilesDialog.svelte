<script lang="ts">
  import { Button, Dialog, IconButton, Input, Switch } from "$lib/atelier-ui";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { editor, setProfile, setProfiles } from "$lib/editor.svelte";
  import { BUILTIN, parseArgs, type Profile } from "$lib/run.logic";
  import { t } from "$lib/i18n";

  let { open = $bindable(false), repo }: { open: boolean; repo: string } = $props();

  const s = $derived(editor(repo));
  let name = $state("");
  let release = $state(false);
  let args = $state("");

  const parsed = $derived(parseArgs(args));
  const taken = $derived([...BUILTIN, ...s.profiles].some((p) => p.name === name.trim()));
  const error = $derived(parsed === null ? t("Argumente ohne Leerzeichen, Quotes oder Shell-Zeichen (; & | $ % …)") : taken ? t("Name gibt es schon") : "");

  const describe = (p: Profile) =>
    [p.release ? "Release (--release / -c Release)" : "Debug", ...(p.args.length ? [p.args.join(" ")] : [])].join(" · ");

  // Kein <form>: der Switch (kit) ist ein Button ohne type und schickte das Formular beim Umschalten ab.
  const enter = (e: KeyboardEvent) => e.key === "Enter" && add();

  function add() {
    if (!name.trim() || error || !parsed) return;
    setProfiles(repo, [...s.profiles, { name: name.trim(), release, args: parsed }]);
    setProfile(repo, name.trim());
    name = args = "";
    release = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{t("Build-Profile")}</Dialog.Title>
      <!-- {0}…{3}: the code samples, so the sentence stays whole for translation -->
      <Dialog.Description
        >{#each t("Release hängt bei Cargo {0} und bei .NET {1} an. Zusatzargumente kommen hinten dran, z. B. {2} oder {3}. Gilt für dieses Projekt.").split(/\{(\d)\}/) as part, i (i)}{#if i % 2}<code
              >{["--release", "-c Release", "--features x", "-- --port=3000"][+part]}</code
            >{:else}{part}{/if}{/each}</Dialog.Description
      >
    </Dialog.Header>

    <ul class="border-border divide-border divide-y rounded border text-ui">
      {#each [...BUILTIN, ...s.profiles] as p, i (p.name)}
        <li class="flex items-center gap-2 px-2.5 py-1.5">
          <span class="font-medium">{p.name}</span>
          <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-meta" title={describe(p)}>{describe(p)}</span>
          {#if i >= BUILTIN.length}
            <IconButton
              size="md"
              tone="danger"
              label={t("Profil {name} löschen", { name: p.name })}
              onclick={() => setProfiles(repo, s.profiles.filter((x) => x.name !== p.name))}><TrashIcon class="size-3.5" /></IconButton
            >
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex flex-col gap-2">
      <Input bind:value={name} placeholder={t("Name, z. B. Profiling")} density="sm" onkeydown={enter} />
      <label class="flex items-center gap-2 text-ui">
        <Switch on={release} label="Release" onclick={() => (release = !release)} />
        Release
      </label>
      <Input bind:value={args} placeholder={t("Zusatzargumente (optional)")} density="sm" class="font-mono" onkeydown={enter} />
      {#if error}<p class="text-destructive text-ui">{error}</p>{/if}
      <Button size="sm" disabled={!name.trim() || !!error} onclick={add}>{t("Profil anlegen")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
