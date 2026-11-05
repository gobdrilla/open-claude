<script lang="ts">
  import { t } from "$lib/i18n";
  import { open as pickFolder } from "@tauri-apps/plugin-dialog";
  import { forge, accountId, type Account, type RepoLang } from "$lib/git";
  import { Button, Checkbox, Dialog, FolderField, Input, Segmented } from "$lib/atelier-ui";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";

  let {
    open = $bindable(false),
    accounts,
    root,
    oncreate,
    onaccounts,
  }: {
    open: boolean;
    accounts: Account[];
    root: string;
    oncreate: (path: string) => void;
    onaccounts: () => void;
  } = $props();

  // Gleiche Regel wie valid_name in create.rs
  const NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9_-])?$/;

  let name = $state("");
  let dest = $state("");
  let destTouched = $state(false); // sobald der Nutzer den Zielordner selbst aendert, nicht mehr automatisch mitfuehren
  let lang = $state("none");
  let langs = $state<RepoLang[]>([]);
  let mit = $state(false);
  let account = $state<Account | null>(null); // null = nur lokal
  let priv = $state(true);
  let busy = $state(false);
  let status = $state("");
  let error = $state("");
  let done = $state(false); // lokal angelegt, Remote gescheitert: nur noch schliessen

  const valid = $derived(NAME.test(name) && !!dest.trim());
  const missing = $derived(langs.find((l) => l.id === lang && l.tool && !l.found));

  $effect(() => {
    if (open && !langs.length) forge.langs().then((l) => (langs = l), (e) => (error = String(e)));
  });

  // Nach "Lokal angelegt, Remote fehlgeschlagen" beim Schliessen frisch machen, egal wie geschlossen.
  $effect(() => {
    if (!open && done) reset();
  });

  // Zielordner nachfuehren, solange der Nutzer ihn nicht selbst angefasst hat.
  $effect(() => {
    if (destTouched) return;
    dest = name ? `${root}${root.includes("\\") ? "\\" : "/"}${name}` : "";
  });

  async function browseDest() {
    const picked = await pickFolder({ directory: true, title: t("Zielordner wählen"), defaultPath: dest || root });
    if (typeof picked !== "string") return;
    dest = picked;
    destTouched = true;
  }

  async function doCreate() {
    if (busy || done || !valid) return;
    busy = true;
    error = "";
    status = t("Lege Repo an…");
    // Auswahl festhalten, Controls sind waehrend busy zwar gesperrt, aber sicher ist sicher.
    const acc = account, p = priv;
    try {
      const id = acc ? accountId(acc) : null;
      const path = await forge.create(dest.trim(), name, lang, mit, id);
      let failed = "";
      if (acc) {
        status = t("Lege auf {host} an…", { host: acc.host });
        failed = await forge.createRemote(path, name, p).then(() => "", String);
      }
      oncreate(path);
      // Lokal steht; erneutes Anlegen scheiterte an "nicht leer", daher nur noch schliessen.
      if (failed) {
        error = t("Lokal angelegt, Remote fehlgeschlagen: {error}", { error: failed });
        done = true;
        return;
      }
      open = false;
      reset();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
      status = "";
    }
  }

  function reset() {
    name = "";
    dest = "";
    destTouched = false;
    lang = "none";
    mit = false;
    account = null;
    priv = true;
    error = "";
    done = false;
  }
</script>

<!-- Waehrend busy nicht schliessbar, sonst ginge ein Remote-Fehler verloren. -->
<Dialog.Root bind:open={() => open, (v) => { if (!busy) open = v; }}>
  <Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>{t("Neues Repository")}</Dialog.Title>
      <Dialog.Description>{t("Lokal anlegen, optional auf GitHub/GitLab.")}</Dialog.Description>
    </Dialog.Header>

    <fieldset disabled={busy} class="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2.5 text-ui">
      <span class="text-muted-foreground pt-2">Name</span>
      <div>
        <Input
          bind:value={name}
          placeholder="my-app"
          density="sm" class="font-mono"
          onkeydown={(e) => e.key === "Enter" && doCreate()}
        />
        {#if name && !NAME.test(name)}
          <p class="text-destructive mt-1 text-meta">{t("Nur Buchstaben, Ziffern, . _ -")}</p>
        {/if}
      </div>

      <span class="text-muted-foreground pt-2">{t("Ordner")}</span>
      <FolderField bind:value={dest} oninput={() => (destTouched = true)} onbrowse={browseDest} />

      <span class="text-muted-foreground pt-2">{t("Sprache")}</span>
      <div>
        <Segmented
          label={t("Sprache")}
          value={lang}
          options={langs.map((l) => [l.label, l.id, l.tool && !l.found ? t("{tool} nicht gefunden: nur .gitignore + README", { tool: l.tool }) : undefined] as const)}
          onchange={(v) => (lang = v)}
        />
        {#if missing}
          <p class="text-muted-foreground mt-1 text-meta">{t("{tool} nicht gefunden: nur .gitignore + README", { tool: missing.tool ?? "" })}</p>
        {/if}
      </div>

      <span></span>
      <Checkbox bind:checked={mit}>{t("MIT-Lizenz")}</Checkbox>

      <span class="text-muted-foreground pt-2">Remote</span>
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-stretch gap-1.5">
          <Segmented
            label="Remote"
            value={account}
            options={[[t("Nur lokal"), null] as const, ...accounts.map((a) => [`${a.user}@${a.host}`, a] as const)]}
            onchange={(v) => (account = v)}
          />
          <Button variant="outline" size="sm" onclick={onaccounts}>{t("Konto hinzufügen…")}</Button>
        </div>
        {#if account}
          <Segmented
            label={t("Sichtbarkeit")}
            value={priv}
            options={[[t("Privat"), true], [t("Öffentlich"), false]]}
            onchange={(v) => (priv = v)}
          />
        {/if}
      </div>
    </fieldset>

    {#if status}
      <p class="text-muted-foreground flex items-center gap-1.5 text-ui">
        <LoaderCircleIcon class="size-3.5 animate-spin" />{status}
      </p>
    {/if}
    {#if error}<p class="text-destructive text-ui whitespace-pre-wrap">{error}</p>{/if}

    <div class="flex justify-end gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        onclick={() => (open = false)}
        disabled={busy}>{done ? t("Schließen") : t("Abbrechen")}</Button
      >
      <Button size="sm" class="gap-1.5" disabled={busy || done || !valid} onclick={doCreate}>
        {#if busy}<LoaderCircleIcon class="size-3.5 animate-spin" />{/if}
        {t("Anlegen")}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
