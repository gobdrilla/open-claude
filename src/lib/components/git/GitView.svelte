<script lang="ts">
  import { confirm as ask } from "$lib/confirm.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import { Button, Checkbox, ConfirmDialog, DiffDialog, IconButton, PromptDialog, RefreshButton, Tabs, TextButton, menuContent, menuItem, menuSeparator } from "$lib/atelier-ui";
  import { tick, untrack } from "svelte";
  import { DropdownMenu } from "bits-ui";
  import { invoke } from "@tauri-apps/api/core";
  import { FILES_APP } from "$lib/editor.logic";
  import { git, forge, accountId, type Account, type ForgeKind, type RepoAccount, type Status } from "$lib/git";
  import Sidebar from "./Sidebar.svelte";
  import AskDialog from "./AskDialog.svelte";
  import ChangesPanel from "./ChangesPanel.svelte";
  import HistoryPanel from "./HistoryPanel.svelte";
  import ReleasesPanel from "./ReleasesPanel.svelte";
  import PipelinesPanel from "./PipelinesPanel.svelte";
  import UnityPanel from "$lib/components/unity/UnityPanel.svelte";
  import MergeEditor from "./MergeEditor.svelte";
  import Splitter, { stored } from "$lib/components/Splitter.svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import CloudDownloadIcon from "@lucide/svelte/icons/cloud-download";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import UserIcon from "@lucide/svelte/icons/user";
  import CheckIcon from "@lucide/svelte/icons/check";
  import LoaderCircleIcon from "@lucide/svelte/icons/loader-circle";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import RefreshIcon from "@lucide/svelte/icons/refresh-cw";

  let {
    repo,
    accounts,
    onaccounts,
    unity = false,
    onedit,
  }: {
    repo: string;
    accounts: Account[];
    onaccounts: () => void;
    unity?: boolean;
    onedit?: (path: string) => void;
  } = $props();

  const isUnity = $derived(unity);

  // Geoeffnete Submodule, je Ebene relativ zur vorigen; alle Git-Aufrufe laufen auf cur.
  let trail = $state<string[]>([]);
  const cur = $derived(trail.length ? `${repo}/${trail.join("/")}` : repo);
  $effect(() => {
    repo;
    trail = [];
  });
  /** Ebene wechseln (ins Submodul oder per Pfadleiste zurueck). */
  async function goto(next: string[]) {
    if (!(await canLeave())) return;
    conflictPath = null;
    status = null;
    trail = next;
  }

  let status = $state<Status | null>(null);
  let refreshKey = $state(0);
  // Forge-Panels kosten API-Calls: nur nachziehen, wenn sich HEAD/Branch bewegt oder das Remote angefasst wurde.
  let forgeKey = $state(0);
  let side = $state(stored("git.side", 240));
  let tab = $state<"changes" | "history" | "releases" | "ci" | "unity">("changes");
  // Forge-Tabs erst beim ersten Oeffnen mounten: sonst API-Calls, obwohl nie hingeschaut wird.
  let seen = $state({ releases: false, ci: false, unity: false });
  let ciKind = $state<ForgeKind | null>(null);
  $effect(() => {
    if (tab !== "changes" && tab !== "history") seen[tab] = true;
  });
  let conflictPath = $state<string | null>(null);
  let jumpTo = $state<string | null>(null);
  let busy = $state("");
  let error = $state("");
  // Notice blendet error aus; ohne eigenes Flag stuende danach ewig "Lese Status …".
  let loadError = $state(false);
  let note = $state("");
  let shown = $state<{ title: string; diff: string } | null>(null);
  let confirm = $state<{ title: string; message: string; label: string; run: () => Promise<unknown> } | null>(null);
  // Offen-Flag getrennt, weil PromptDialog einen String bindet
  let branchOpen = $state(false);
  let branchName = $state("");
  let stashOpen = $state(false);
  let stash = $state({ message: "", untracked: true });

  const conflicts = $derived(status?.files.filter((f) => f.conflict).length ?? 0);
  const STATE_LABEL = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-Pick", revert: "Revert" };

  /** Status neu lesen; refreshKey laesst Sidebar und Verlauf nachziehen. Beim Fokus nur, wenn HEAD sich bewegt hat. */
  async function refresh(force = true, remote = false) {
    const before = `${status?.head}|${status?.branch}`;
    try {
      status = await git.status(cur);
      loadError = false;
      // Nach Abbrechen/Fortsetzen (auch extern) steht die Datei nicht mehr im Konflikt: Editor zu, sonst zeigt er Altes.
      if (conflictPath && !status.files.some((f) => f.conflict && f.path === conflictPath)) conflictPath = null;
    } catch (e) {
      error = `Status: ${e}`;
      loadError = true;
    }
    const moved = before !== `${status?.head}|${status?.branch}`;
    if (force || moved) refreshKey++;
    if (remote || moved) forgeKey++;
  }

  /** Fuer den Aktualisieren-Knopf in der Kopfleiste und F5; alte Meldungen gelten dann nicht mehr. */
  export const reload = () => {
    error = note = "";
    return refresh(true, true);
  };

  let mergeDirty = $state(false);
  /** Offener Merge-Editor mit Entscheidungen: erst nachfragen. */
  export async function canLeave() {
    return !conflictPath || !mergeDirty || (await ask("Merge-Editor schließen? Entscheidungen gehen verloren.", "Schließen"));
  }

  $effect(() => {
    cur;
    untrack(refresh); // refresh liest status, sonst laedt jeder neue Status erneut: Endlosschleife
  });

  // Konto des Repos (git config ocui.account) fuer Push/Pull/API und die Commit-Identitaet.
  let acct = $state<RepoAccount | null>(null);
  const acctFor = $derived(accounts.find((a) => accountId(a) === acct?.effective) ?? null);
  const hostAccounts = $derived(accounts.filter((a) => a.host === acct?.host));

  async function loadAccount() {
    const r = cur;
    try {
      const res = await forge.repoAccount(r);
      if (r === cur) acct = res;
    } catch (e) {
      if (r === cur) error = `Konto: ${e}`;
    }
  }

  $effect(() => {
    cur;
    acct = null;
    loadAccount();
  });

  // Nach An-/Abmelden: Konto neu bestimmen, Forge-Panels laden mit dem neuen Token nach.
  let lastAccounts = untrack(() => accounts);
  $effect(() => {
    if (accounts === lastAccounts) return;
    lastAccounts = accounts;
    untrack(() => {
      loadAccount();
      forgeKey++;
    });
  });

  /** Neues Konto setzen; Forge-Panels laden danach mit dessen Token nach. */
  async function setAccount(id: string | null) {
    error = "";
    try {
      acct = await forge.setRepoAccount(cur, id);
    } catch (e) {
      error = String(e);
    }
    await refresh(true, true);
  }

  /** Aktion mit Ladeanzeige; Ausgabe von git als Hinweis, Fehler rot. */
  async function run(label: string, action: () => Promise<unknown>) {
    if (busy) return;
    busy = label;
    error = "";
    note = "";
    try {
      const out = await action();
      if (typeof out === "string" && out.trim()) note = out.trim().split("\n").slice(-2).join(" · ");
    } catch (e) {
      error = String(e);
    }
    busy = "";
    await refresh(true, ["Fetch", "Pull", "Push", "Force-Push"].includes(label));
  }

  /** Ladeanzeige fuer Aktionen aus Sidebar und Verlauf; Fehler und Refresh bleiben beim Aufrufer. */
  async function track<T>(label: string, action: () => Promise<T>): Promise<T> {
    busy = label;
    try {
      return await action();
    } finally {
      busy = "";
    }
  }

  const reveal = () =>
    invoke("reveal", { path: repo.includes("\\") ? cur.replaceAll("/", "\\") : cur }).catch((e) => (error = String(e)));
  // Only one filled action: pull first when behind (push would be rejected anyway), else push when ahead.
  // None during merge/rebase: git refuses both, the banner's Fortsetzen is the action then.
  const hot = $derived(status?.state !== "clean" ? null : status?.behind ? "pull" : status?.ahead ? "push" : null);

  const doFetch = () => run("Fetch", () => git.fetch(cur));
  const pull = (rebase = false) => run("Pull", () => git.pull(cur, rebase));
  const push = () => run("Push", () => git.push(cur, false));
  const forcePush = () =>
    (confirm = {
      title: "Force-Push",
      message: "Remote-Branch mit dem lokalen Stand überschreiben (--force-with-lease)? Fremde Commits, die du schon kennst, gehen dort verloren.",
      label: "Force-Push",
      run: () => git.push(cur, true),
    });

  async function doConfirm() {
    const c = confirm;
    confirm = null;
    if (c) await run(c.title, c.run);
  }

  async function createBranch() {
    if (!branchOpen) return; // doppeltes Enter
    const name = branchName.trim();
    branchOpen = false;
    if (name) await run("Branch", () => git.checkout(cur, name, true, null));
  }

  async function doStash() {
    if (!stashOpen) return; // doppeltes Enter
    const s = stash;
    stashOpen = false;
    await run("Stash", () => git.stashPush(cur, s.message.trim() || null, s.untracked));
  }

  /** Gleiche Ref zweimal anklicken soll erneut springen, daher kurz auf null. */
  async function selectRef(ref: string) {
    if (!(await canLeave())) return;
    conflictPath = null;
    tab = "history";
    jumpTo = null;
    await tick();
    jumpTo = ref;
  }

  function onkeydown(e: KeyboardEvent) {
    const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey; // AltGr = Strg+Alt
    const k = e.key.toLowerCase();
    // Strg+1/2/3 switch views globally, so tabs use Alt+digit (e.code: macOS Option changes e.key).
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (alt && e.code === "Digit1") tab = "changes";
    else if (alt && e.code === "Digit2") tab = "history";
    else if (alt && e.code === "Digit3") tab = "releases";
    else if (alt && e.code === "Digit4") tab = "ci";
    else if (alt && e.code === "Digit5" && isUnity) tab = "unity";
    else if (ctrl && e.shiftKey && k === "f") doFetch();
    else if (ctrl && e.shiftKey && k === "p") push();
    else if (ctrl && e.shiftKey && k === "l") pull();
    else if (e.key === "F5") reload();
    else return;
    e.preventDefault();
  }
</script>

<svelte:window {onkeydown} onfocus={() => refresh(false)} />

{#snippet tool(label: string, title: string, onclick: () => void, Icon: typeof CloudDownloadIcon, hot = false)}
  <Button
    variant={hot ? "glow" : "ghost"}
    size="sm"
    class="gap-1.5 rounded-full"
    {onclick}
    {title}
    disabled={!!busy}
  >
    <Icon class="size-3.5" />
    {label}
  </Button>
{/snippet}

<!-- Third tuple field: checkmark state; when any item has one, all items reserve the check column. -->
{#snippet menu(items: [string, () => void, boolean?][])}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      class="text-muted-foreground hover:bg-secondary hover:text-foreground -ml-1 grid h-7 w-4 place-items-center rounded-full disabled:opacity-50"
      disabled={!!busy}
      aria-label="Weitere Optionen"><ChevronDownIcon class="size-3" /></DropdownMenu.Trigger
    >
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="start"
        class={menuContent}
      >
        {#each items as [label, onSelect, checked] (label)}
          <DropdownMenu.Item class={menuItem} {onSelect}>
            {#if items.some((i) => i[2] !== undefined)}<CheckIcon class="size-3 {checked ? '' : 'invisible'}" />{/if}
            {label}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-2 p-2 text-ui">
  <div class="bg-card glow ring-foreground/5 rounded-xl shadow-lg ring-1 shadow-black/10 dark:shadow-black/30 flex items-center gap-0.5 px-2 py-1.5">
    {#if status}
      <div class="mr-3 flex min-w-0 items-center gap-2.5" title={status.upstream ?? "Kein Upstream"}>
        <div
          class="from-primary to-primary/50 text-primary-foreground shadow-primary/30 grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br shadow-md"
        >
          {#if busy}
            <LoaderCircleIcon class="size-4 animate-spin" />
          {:else}
            <GitBranchIcon class="size-4" />
          {/if}
        </div>
        <div class="flex min-w-0 flex-col leading-tight">
          <span class="text-muted-foreground flex min-w-0 items-center gap-1 truncate text-meta">
            {#each [repo.split(/[\\/]/).filter(Boolean).pop(), ...trail] as name, i (i)}
              {#if i}<span class="opacity-60">›</span>{/if}
              {#if i < trail.length}
                <TextButton tone="plain" underline class="block truncate" title="Zurück zu {name}" onclick={() => goto(trail.slice(0, i))}>{name}</TextButton>
              {:else}
                <span class="truncate">{name}</span>
              {/if}
            {/each}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="max-w-40 shrink-0 truncate font-mono text-ui font-semibold">{status.branch ?? `detached ${status.head.slice(0, 7)}`}</span>
            {#if status.ahead}<span class="bg-primary/15 text-primary rounded-full px-1.5 font-mono text-[10px]">↑{status.ahead}</span>{/if}
            {#if status.behind}<span class="bg-warning/15 text-warning rounded-full px-1.5 font-mono text-[10px]">↓{status.behind}</span>{/if}
            {#if status.upstream && !status.ahead && !status.behind}
              <span class="text-success flex items-center gap-1 text-meta"><span class="bg-success size-1.5 rounded-full"></span>synchron</span>
            {/if}
          </span>
        </div>
      </div>
    {/if}
    {@render tool("Fetch", "Fetch (Strg+Umschalt+F)", doFetch, CloudDownloadIcon)}
    {@render tool(status?.behind ? `Pull ${status.behind}` : "Pull", "Pull (Strg+Umschalt+L)", () => pull(), DownloadIcon, hot === "pull")}
    {@render menu([
      ["Pull (Merge)", () => pull(false), true],
      ["Pull (Rebase)", () => pull(true), false],
    ])}
    {@render tool(status?.ahead ? `Push ${status.ahead}` : "Push", "Push (Strg+Umschalt+P)", push, UploadIcon, hot === "push")}
    {@render menu([["Force-Push …", forcePush]])}
    <span class="bg-border mx-1.5 h-4 w-px"></span>
    {@render tool("Stash", "Änderungen stashen", () => ((stash = { message: "", untracked: true }), (stashOpen = true)), ArchiveIcon)}
    {@render tool("Branch", "Neuer Branch ab HEAD", () => ((branchName = ""), (branchOpen = true)), GitBranchPlusIcon)}
    <span class="flex-1"></span>
    <Button variant="ghost" size="sm" class="gap-1.5 rounded-full" onclick={reveal} title="Ordner im {FILES_APP} öffnen (Strg+Umschalt+E)">
      <FolderOpenIcon class="size-3.5" />
      {FILES_APP}
    </Button>
    <IconButton size="md" class="mx-0.5" label="Aktualisieren" title="Aktualisieren (F5)" onclick={reload}><RefreshIcon class="size-3.5" /></IconButton>
    {#if acct}
      <DropdownMenu.Root onOpenChange={(o) => o && loadAccount()}>
        <DropdownMenu.Trigger
          class="text-muted-foreground hover:bg-secondary hover:text-foreground flex h-7 items-center gap-1.5 rounded-full px-2.5 text-meta"
          title={acct.name || acct.email ? `Commit als: ${acct.name ?? "?"} <${acct.email ?? "?"}>` : "Keine Commit-Identität gesetzt"}
        >
          {#if acctFor?.avatar}
            <img src={acctFor.avatar} alt="" class="size-4 rounded-full" />
          {:else}
            <UserIcon class="size-3.5" />
          {/if}
          {#if acct.effective}
            {acct.effective.slice(acct.effective.lastIndexOf(":") + 1)}
            {#if !acct.account}<span class="hidden opacity-60 lg:inline">(automatisch)</span>{/if}
          {:else}
            System-Git
          {/if}
          <ChevronDownIcon class="size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            class={menuContent}
          >
            {#each hostAccounts as a (accountId(a))}
              <DropdownMenu.Item
                class={menuItem}
                onSelect={() => setAccount(accountId(a))}
              >
                <CheckIcon class="size-3 {acct.account === accountId(a) ? '' : 'invisible'}" />
                {a.user}<span class="text-muted-foreground font-mono text-meta">@{a.host}</span>
              </DropdownMenu.Item>
            {/each}
            <DropdownMenu.Item
              class={menuItem}
              onSelect={() => setAccount(null)}
            >
              <CheckIcon class="size-3 {acct.account ? 'invisible' : ''}" />
              Automatisch (System-Git)
            </DropdownMenu.Item>
            <DropdownMenu.Separator class={menuSeparator} />
            <DropdownMenu.Item class={menuItem} onSelect={onaccounts}
              >Konten verwalten …</DropdownMenu.Item
            >
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {/if}
    {#if busy}
      <span class="text-muted-foreground mr-2 flex items-center gap-1.5 text-meta" role="status">
        <LoaderCircleIcon class="size-3.5 animate-spin" />{busy} läuft …
      </span>
    {/if}
  </div>

  {#if status && status.state !== "clean"}
    <div class="ring-warning/25 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-1.5 text-warning ring-1">
      <TriangleAlertIcon class="size-3.5" />
      <span class="flex-1">
        {STATE_LABEL[status.state]} läuft{conflicts
          ? ` – ${conflicts} ${conflicts === 1 ? "Konflikt" : "Konflikte"} offen`
          : " – keine Konflikte mehr"}
      </span>
      <Button size="xs" variant={conflicts ? "secondary" : "default"} disabled={!!busy} onclick={() => run("Fortsetzen", () => git.continue(repo))}
        >Fortsetzen</Button
      >
      <Button
        variant="ghost"
        size="xs"
        disabled={!!busy}
        onclick={() =>
          (confirm = {
            title: `${STATE_LABEL[status!.state as keyof typeof STATE_LABEL]} abbrechen`,
            message: "Zum Stand vor dem Vorgang zurückkehren? Bereits gelöste Konflikte gehen verloren.",
            label: `${STATE_LABEL[status!.state as keyof typeof STATE_LABEL]} abbrechen`,
            run: () => git.abort(repo),
          })}>Abbrechen</Button
      >
    </div>
  {/if}

  <Notice bind:text={error} />
  {#if !error}<Notice bind:text={note} kind="note" />{/if}

  {#if status}
    <!-- Sidebar und Inhalt in einer gemeinsamen Karte -->
    <div class="bg-card glow ring-foreground/5 rounded-xl shadow-lg ring-1 shadow-black/10 dark:shadow-black/30 flex min-h-0 flex-1 overflow-hidden">
      <div class="border-border/60 shrink-0 border-r" style="width:{side}px; max-width:40%">
        <Sidebar
          repo={cur}
          {status}
          {refreshKey}
          {forgeKey}
          busy={!!busy}
          {track}
          onchange={refresh}
          onselectref={selectRef}
          onshowdiff={(title, diff) => (shown = { title, diff })}
          onsubmodule={(p) => goto([...trail, p])}
        />
      </div>
      <Splitter bind:size={side} min={160} max={480} key="git.side" />
      <div class="flex min-w-0 flex-1 flex-col">
        {#if conflictPath}
          <MergeEditor
            repo={cur}
            path={conflictPath}
            bind:dirty={mergeDirty}
            onclose={() => {
              conflictPath = null;
              refresh();
            }}
          />
        {:else}
          <Tabs
            pill
            bind:value={tab}
            tabs={[
              { id: "changes", label: "Änderungen", title: "Alt+1", count: status.files.length },
              { id: "history", label: "Verlauf", title: "Alt+2" },
              { id: "releases", label: "Releases", title: "Alt+3" },
              { id: "ci", label: "CI", title: `${ciKind === "gitlab" ? "GitLab Pipelines" : ciKind === "github" ? "GitHub Actions" : "CI"} (Alt+4)` },
              ...(isUnity ? [{ id: "unity" as const, label: "Unity", title: "Alt+5" }] : []),
            ]}
          />
          <div class="min-h-0 flex-1">
            <!-- Einmal geoeffnet bleiben alle gemountet: Auswahl und Scrollstand ueberleben den Tabwechsel. -->
            <div class="h-full {tab === 'changes' ? '' : 'hidden'}">
              <ChangesPanel
                repo={cur}
                {status}
                onedit={onedit && ((p) => onedit([...trail, p].join("/")))}
                onsubmodule={(p) => goto([...trail, p])}
                onchange={(remote = false) => refresh(remote, remote)} onconflict={(p) => (conflictPath = p)} />
            </div>
            <div class="h-full {tab === 'history' ? '' : 'hidden'}">
              <HistoryPanel repo={cur} {jumpTo} {refreshKey} busy={!!busy} {track} onchange={refresh} />
            </div>
            {#if seen.releases}
              <div class="h-full {tab === 'releases' ? '' : 'hidden'}">
                <ReleasesPanel repo={cur} refreshKey={forgeKey} />
              </div>
            {/if}
            {#if seen.ci}
              <div class="h-full {tab === 'ci' ? '' : 'hidden'}">
                <PipelinesPanel repo={cur} refreshKey={forgeKey} visible={tab === "ci"} bind:kind={ciKind} />
              </div>
            {/if}
            {#if seen.unity}
              <div class="h-full {tab === 'unity' ? '' : 'hidden'}">
                <UnityPanel {repo} />
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else if loadError}
    <div class="text-muted-foreground flex items-center gap-2 px-4 py-6">
      Status konnte nicht gelesen werden.
      <RefreshButton loading={false} onclick={reload} />
    </div>
  {:else if !error}
    <p class="text-muted-foreground px-4 py-6">Lese Status …</p>
  {/if}
</div>

<AskDialog />

<DiffDialog diff={shown?.diff ?? null} title={shown?.title ?? ""} onclose={() => (shown = null)} />

<ConfirmDialog
  open={confirm !== null}
  title={confirm?.title ?? ""}
  message={confirm?.message}
  action={confirm?.label ?? ""}
  onconfirm={doConfirm}
  oncancel={() => (confirm = null)}
/>

<PromptDialog
  open={branchOpen}
  title="Neuer Branch"
  description="Wird ab HEAD angelegt und ausgecheckt."
  bind:value={branchName}
  placeholder="feature/…"
  action="Anlegen"
  mono
  onsubmit={createBranch}
  oncancel={() => (branchOpen = false)}
/>

<PromptDialog
  open={stashOpen}
  title="Änderungen stashen"
  bind:value={stash.message}
  placeholder="Nachricht (optional)"
  action="Stashen"
  onsubmit={doStash}
  oncancel={() => (stashOpen = false)}
>
  <Checkbox size="md" bind:checked={stash.untracked}>Neue (untracked) Dateien einschließen</Checkbox>
</PromptDialog>
