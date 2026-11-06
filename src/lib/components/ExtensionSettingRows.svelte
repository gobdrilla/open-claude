<script lang="ts">
  import { Input, Segmented, Select, SettingRow, Switch, TextButton } from "$lib/atelier-ui";
  import { checkValue, resolve, type Manifest, type SettingDecl } from "$lib/extensions.logic";
  import { exts, setGlobal, setRepo } from "$lib/extensions.svelte";
  import { t } from "$lib/i18n";

  // Settings of one extension, rendered from its manifest. With repo: only scope "repo", written to that repo's git config.
  let { ext, repo }: { ext: Manifest; repo?: string } = $props();

  const decls = $derived(ext.contributes.settings.filter((d) => !repo || d.scope === "repo"));
  const global = $derived(resolve(ext.contributes.settings, exts.settings[ext.id] ?? {}, {}));
  const own = $derived(repo ? (exts.repo[repo]?.[ext.id] ?? {}) : {});
  // Typed text until it is saved; an invalid value keeps its text and shows the error below.
  let draft = $state<Record<string, string>>({});
  let errors = $state<Record<string, string>>({});

  const stored = (d: SettingDecl) => {
    const v = repo ? own[d.key] : exts.settings[ext.id]?.[d.key];
    return typeof v === "string" ? v : "";
  };
  const placeholder = (d: SettingDecl) =>
    repo ? (global[d.key] !== "" ? `Global: ${global[d.key]}` : (d.placeholder ?? "")) : typeof d.default === "string" && d.default ? d.default : (d.placeholder ?? "");

  async function save(d: SettingDecl, v: string | boolean) {
    const text = typeof v === "string" ? v.trim() : v;
    const e = typeof text === "string" ? checkValue(d, text) : null;
    if (e) return void (errors[d.key] = e);
    delete errors[d.key];
    try {
      if (repo) await setRepo(repo, ext.id, d.key, text === "" ? null : String(text));
      else setGlobal(ext.id, d.key, text);
      delete draft[d.key];
    } catch (err) {
      errors[d.key] = String(err);
    }
  }
  const choices = (d: SettingDecl) => (repo ? [["Global", ""] as [string, string], ...d.enum!] : d.enum!);
</script>

{#each decls as d (d.key)}
  <SettingRow label={d.title} description={d.description}>
    <div class="flex w-72 shrink-0 flex-col items-end gap-1">
      {#if d.type === "string"}
        <Input
          density="sm"
          class={d.format ? "font-mono" : ""}
          value={draft[d.key] ?? stored(d)}
          placeholder={placeholder(d)}
          aria-label={d.title}
          aria-invalid={!!errors[d.key]}
          oninput={(e: Event) => (draft[d.key] = (e.currentTarget as HTMLInputElement).value)}
          onchange={() => draft[d.key] !== undefined && save(d, draft[d.key])}
        />
      {:else if d.type === "boolean" && repo}
        <Segmented value={own[d.key] ?? ""} options={[["Global", ""], [t("An"), "true"], [t("Aus"), "false"]]} onchange={(v) => save(d, v)} label={d.title} />
      {:else if d.type === "boolean"}
        <Switch label={d.title} on={global[d.key] === true} onclick={() => save(d, global[d.key] !== true)} />
      {:else if choices(d).length <= 3}
        <Segmented value={repo ? (own[d.key] ?? "") : String(global[d.key])} options={choices(d)} onchange={(v) => save(d, v)} label={d.title} />
      {:else}
        <Select value={repo ? (own[d.key] ?? "") : String(global[d.key])} options={choices(d)} onchange={(v) => save(d, v)} aria-label={d.title} />
      {/if}
      {#if errors[d.key]}<p class="text-destructive text-meta self-stretch">{errors[d.key]}</p>{/if}
      {#if repo && own[d.key] !== undefined && d.type === "string"}
        <TextButton size="sm" onclick={() => ((draft[d.key] = ""), save(d, ""))}>{t("Global verwenden")}</TextButton>
      {/if}
    </div>
  </SettingRow>
{/each}
