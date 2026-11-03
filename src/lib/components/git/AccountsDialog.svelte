<script lang="ts">
  import { confirm } from "$lib/confirm.svelte";
  import type { Store } from "@tauri-apps/plugin-store";
  import { forge, type Account, type ForgeKind } from "$lib/git";
  import { Badge, Button, Dialog, IconButton, Input, Segmented, TextButton } from "$lib/atelier-ui";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import GlobeIcon from "@lucide/svelte/icons/globe";

  let {
    open = $bindable(false),
    store,
    accounts = $bindable<Account[]>([]),
  }: { open: boolean; store: Store; accounts: Account[] } = $props();

  let kind = $state<ForgeKind>("github");
  let host = $state("github.com");
  let token = $state("");
  let busy = $state(false);
  let error = $state("");

  // Host-Feld beim Wechsel des Anbieters auf den ueblichen Default setzen.
  $effect(() => {
    if (kind === "github" && host === "gitlab.com") host = "github.com";
    if (kind === "gitlab" && host === "github.com") host = "gitlab.com";
  });

  const bare = $derived(host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, ""));
  const tokenUrl = $derived(
    kind === "github"
      ? `https://${bare}/settings/tokens/new?scopes=repo,read:org&description=ocui`
      : `https://${bare}/-/user_settings/personal_access_tokens?name=ocui&scopes=api,read_repository,write_repository`,
  );

  async function persist(next: Account[]) {
    accounts = next;
    await store.set("accounts", accounts);
  }

  const same = (x: Account, a: Account) => x.kind === a.kind && x.host === a.host && x.user === a.user;

  function upsert(list: Account[], a: Account): Account[] {
    return [...list.filter((x) => !same(x, a)), a];
  }

  async function login() {
    if (!host.trim() || !token.trim()) return;
    busy = true;
    error = "";
    try {
      const a = await forge.login(kind, host.trim(), token.trim());
      await persist(upsert(accounts, a));
      host = a.host;
      token = "";
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }

  async function importCli() {
    busy = true;
    error = "";
    try {
      const a = await forge.importCli(kind, host.trim());
      await persist(upsert(accounts, a));
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }

  async function logout(a: Account) {
    busy = true;
    error = "";
    try {
      await forge.logout(a.kind, a.host, a.user);
      await persist(accounts.filter((x) => !same(x, a)));
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Konten</Dialog.Title>
      <Dialog.Description>GitHub- und GitLab-Zugänge für Klonen, Push/Pull und Pull Requests. Mehrere Konten pro Host möglich, pro Repo wählbar.</Dialog.Description>
    </Dialog.Header>

    {#if accounts.length}
      <ul class="border-border divide-border divide-y rounded border text-sm">
        {#each accounts as a (a.kind + a.host + a.user)}
          <li class="flex items-center gap-2 px-2.5 py-1.5">
            <GlobeIcon class="size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate" title="{a.user}@{a.host}">
              <span class="font-medium">{a.user}</span>
              <span class="text-muted-foreground font-mono text-[11px]">@{a.host}</span>
            </span>
            <Badge variant="outline" class="text-muted-foreground shrink-0 text-[10px]"
              >{a.kind === "github" ? "GitHub" : "GitLab"}</Badge
            >
            <IconButton
              size="md"
              tone="danger"
              disabled={busy}
              onclick={async () => (await confirm(`Konto ${a.user}@${a.host} entfernen? Der Token wird gelöscht.`, "Entfernen")) && logout(a)}
              label="Konto entfernen"
            >
              <TrashIcon class="size-3.5" />
            </IconButton>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="flex flex-col gap-2">
      <Segmented
        label="Anbieter"
        value={kind}
        options={[["GitHub", "github"], ["GitLab", "gitlab"]] as const}
        onchange={(v) => (kind = v)}
      />
      <Input bind:value={host} placeholder="Host, z. B. github.com" density="sm" class="font-mono" />
      <Input bind:value={token} type="password" placeholder="Access Token" density="sm" class="font-mono" />
      <!-- Die Webview oeffnet target=_blank nicht, daher ueber den Standardbrowser. -->
      <TextButton
        size="sm"
        onclick={() => forge.openUrl(tokenUrl).catch((e) => (error = String(e)))}
        class="hover:text-primary self-start"
      >
        <ExternalLinkIcon class="size-3" /> Token mit den nötigen Rechten erstellen ({kind === "github"
          ? "repo, read:org"
          : "api, read_repository, write_repository"})
      </TextButton>
      {#if error}<p class="text-destructive text-xs">{error}</p>{/if}
    </div>

    <div class="flex justify-end gap-1.5">
      <Button variant="outline" size="sm" class="mr-auto" disabled={busy} onclick={importCli}
        >Von {kind === "github" ? "gh" : "glab"} übernehmen</Button
      >
      <Button variant="outline" size="sm" onclick={() => (open = false)}>Schließen</Button>
      <Button size="sm" disabled={busy || !host.trim() || !token.trim()} onclick={login}>Anmelden</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
