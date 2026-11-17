<script lang="ts">
  import { Button, Checkbox, Dialog, Input } from "$lib/atelier-ui";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { forge } from "$lib/git";
  import { ptyClose, ptyWrite } from "$lib/files";
  import CheckIcon from "@lucide/svelte/icons/check";
  import UserIcon from "@lucide/svelte/icons/user";
  import Settings2Icon from "@lucide/svelte/icons/settings-2";
  import { t } from "$lib/i18n";

  // Each account has its own config folder; claude signs in and renews there itself (accounts.rs).
  type Account = {
    id: string; // "" = standard (~/.claude)
    email: string;
    org: string;
    plan: string;
    loggedIn: boolean;
    expires: string | null;
    active: boolean;
    shared: [string, boolean][];
  };

  // running: open Claude sessions; they keep their account until restarted
  let { open = $bindable(false), running = 0 }: { open: boolean; running?: number } = $props();

  let accounts = $state<Account[]>([]);
  let legacy = $state<string[]>([]);
  let error = $state("");
  let busy = $state(false);
  let loading = $state(false);
  // Running sign-in (claude auth login in a PTY); fresh = folder made for it, dropped again if it fails.
  let login = $state<{ id: string; out: string; account: string; fresh: boolean } | null>(null);
  let code = $state("");
  let off: Promise<UnlistenFn>[] = [];
  let sharing = $state<string | null>(null);

  async function load() {
    error = "";
    loading = true;
    try {
      ({ accounts, legacy } = await invoke<{ accounts: Account[]; legacy: string[] }>("claude_accounts"));
    } catch (e) {
      error = String(e);
    }
    loading = false;
  }
  $effect(() => {
    if (open) load();
    else stopLogin();
  });

  async function act(fn: () => Promise<unknown>) {
    busy = true;
    error = "";
    try {
      await fn();
      await load();
    } catch (e) {
      error = String(e);
    }
    busy = false;
  }

  const restartHint = () => (running ? " " + t("{n} laufende Sitzung(en) nutzen bis zum Neustart weiter das bisherige Konto.", { n: running }) : "");

  // Confirmation inside the row instead of a dialog in the dialog.
  type Ask = { what: "use" | "remove"; id: string };
  let asking = $state<Ask | null>(null);
  $effect(() => {
    if (!open) asking = sharing = null;
  });

  function confirmAsk() {
    const a = asking;
    asking = null;
    if (!a) return;
    if (a.what === "use") act(() => invoke("claude_account_use", { id: a.id }));
    else act(() => invoke("claude_account_remove", { id: a.id }));
  }

  const DAY = 86_400_000;
  /** Login end as text and tone; claude itself warns 3 days ahead. */
  function expiry(a: Account): [string, "" | "warn" | "bad"] {
    if (!a.loggedIn) return [a.email ? t("Abgemeldet") : "", "bad"];
    if (!a.expires) return ["", ""];
    const left = Date.parse(a.expires) - Date.now();
    if (left <= 0) return [t("Abgelaufen"), "bad"];
    if (left <= 3 * DAY) return [t("Läuft in {n} Tag(en) ab", { n: Math.max(1, Math.ceil(left / DAY)) }), "warn"];
    return [t("Angemeldet bis {date}", { date: new Date(a.expires).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }), ""];
  }
  const TONE = { "": "text-muted-foreground", warn: "text-warning", bad: "text-destructive" };

  const GROUP: Record<string, string> = {
    settings: t("Einstellungen"),
    memory: "CLAUDE.md",
    skills: t("Skills, Befehle, Agents"),
    plugins: t("Plugins"),
  };

  // Strip terminal control codes; the output is only read and searched for the link
  const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g, "");
  const url = $derived(login?.out.match(/https:\/\/\S+/g)?.at(-1) ?? "");

  /** account: id to renew ("" = standard), or null for a new account; email pre-fills the login page. */
  async function startLogin(account: string | null, email = "") {
    if (login || busy) return;
    error = "";
    let fresh = false;
    if (account === null) {
      // busy against a double click: each click would make its own folder
      busy = true;
      try {
        account = await invoke<string>("claude_account_add");
        fresh = true;
      } catch (e) {
        error = String(e);
        return;
      } finally {
        busy = false;
      }
    }
    const id = `login-${crypto.randomUUID()}`;
    const dec = new TextDecoder();
    login = { id, out: "", account, fresh };
    code = "";
    const out = new Channel<ArrayBuffer>((buf) => {
      if (login?.id !== id) return;
      const raw = dec.decode(new Uint8Array(buf), { stream: true });
      // Windows ConPTY asks for the cursor position and starts claude only after an answer; no xterm here gives one
      if (raw.includes("\x1b[6n")) invoke("pty_write", { id, data: "\x1b[1;1R" }).catch(() => {});
      login.out = (login.out + plain(raw)).slice(-4000);
    });
    off = [
      listen<number | null>(`pty-exit:${id}`, async (e) => {
        if (login?.id !== id) return;
        const out = login.out;
        // Wait for claude_account_added: its reload would otherwise clear the error or race the list.
        await stopLogin();
        if (e.payload !== 0) error = `${t("Anmeldung nicht abgeschlossen.")}\n${out.trim().split("\n").slice(-4).join("\n")}`;
        else if (!fresh) await load();
      }),
    ];
    try {
      await Promise.all(off);
      await invoke("claude_login", { id, account, email, out });
    } catch (e) {
      await stopLogin();
      error = String(e);
    }
  }

  async function stopLogin() {
    for (const p of off) p.then((f) => f(), () => {});
    off = [];
    const l = login;
    login = null;
    if (!l) return;
    ptyClose(l.id).catch(() => {});
    // A new folder stays only if an account really signed in there.
    if (l.fresh) await act(() => invoke("claude_account_added", { id: l.account }));
  }

  function sendCode() {
    if (!login || !code.trim()) return;
    ptyWrite(login.id, code.trim() + "\r").catch(() => {});
    code = "";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{t("Claude-Konten")}</Dialog.Title>
      <Dialog.Description
        >{t("Jedes Konto hat einen eigenen Ordner, claude meldet sich dort selbst an. Verlauf ist immer geteilt, Einstellungen, Skills und Plugins nach Wahl.")}</Dialog.Description
      >
    </Dialog.Header>

    {#if login}
      <div class="flex flex-col gap-2">
        <p class="text-body">{t("Anmeldung läuft – bitte im Browser bestätigen.")}</p>
        {#if url}
          <Button variant="outline" size="sm" onclick={() => forge.openUrl(url)}>{t("Anmeldeseite öffnen")}</Button>
        {/if}
        <pre class="bg-background/60 text-muted-foreground max-h-40 overflow-auto rounded-lg p-2 font-mono text-meta whitespace-pre-wrap">{login.out.trim().split("\n").slice(-12).join("\n") || t("Starte …")}</pre>
        <div class="flex gap-2">
          <Input bind:value={code} placeholder={t("Code aus dem Browser (falls verlangt)")} density="sm" class="font-mono" onkeydown={(e) => e.key === "Enter" && sendCode()} />
          <Button size="sm" variant="outline" disabled={!code.trim()} onclick={sendCode}>{t("Senden")}</Button>
        </div>
        <div class="flex justify-end"><Button variant="ghost" size="sm" onclick={stopLogin}>{t("Anmeldung abbrechen")}</Button></div>
      </div>
    {:else}
      <ul class="border-border/60 divide-border/60 divide-y rounded-lg border">
        {#each accounts as a (a.id)}
          {@const ask = asking?.id === a.id ? asking : null}
          {@const [until, tone] = expiry(a)}
          {@const meta = [a.active ? t("Aktiv") : "", a.id ? "" : t("Standard"), a.plan].filter(Boolean).join(" · ")}
          <li class="flex flex-col gap-2 px-3 py-2">
            <div class="flex min-h-9 items-center gap-2.5">
              {#if ask}
                <div class="min-w-0 flex-1 text-ui">
                  <div class="truncate font-medium" title={a.email}>{a.email || (a.id ? t("Nicht angemeldet") : t("Standard"))}</div>
                  <div class="text-muted-foreground">
                    {ask.what === "use" ? t("Gilt für neu gestartete Sitzungen.") + restartHint() : a.id ? t("Abmelden und Konto entfernen?") : t("Bei Claude abmelden?")}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onclick={() => (asking = null)}>{t("Abbrechen")}</Button>
                <Button variant={ask.what === "use" ? "default" : "destructive"} size="sm" disabled={busy} onclick={confirmAsk}
                  >{ask.what === "use" ? t("Verwenden") : a.id ? t("Entfernen") : t("Abmelden")}</Button
                >
              {:else}
                <span class="grid size-7 shrink-0 place-items-center rounded-full {a.active ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}">
                  {#if a.active}<CheckIcon class="size-3.5" />{:else}<UserIcon class="size-3.5" />{/if}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-body font-medium" title={a.email}>{a.email || t("Nicht angemeldet")}</div>
                  <div class="truncate text-ui" title={a.org}>
                    <span class="text-muted-foreground">{meta}</span>
                    {#if until}<span class={TONE[tone]}>{meta ? " · " : ""}{until}</span>{/if}
                  </div>
                </div>
                {#if !a.active && a.loggedIn}
                  <Button variant="outline" size="sm" disabled={busy} onclick={() => (asking = { what: "use", id: a.id })}>{t("Verwenden")}</Button>
                {/if}
                <Button
                  variant={tone ? "outline" : "ghost"}
                  size="sm"
                  disabled={busy}
                  title={t("Neu anmelden, verlängert die Anmeldung")}
                  onclick={() => startLogin(a.id, a.email)}>{a.loggedIn ? t("Erneuern") : t("Anmelden")}</Button
                >
                {#if a.id}
                  <Button variant="ghost" size="icon-sm" aria-label={t("Geteilte Bereiche")} title={t("Geteilte Bereiche")} onclick={() => (sharing = sharing === a.id ? null : a.id)}
                    ><Settings2Icon class="size-3.5" /></Button
                  >
                {/if}
                {#if a.id || a.loggedIn}
                  <Button variant="ghost" size="sm" class="text-destructive" disabled={busy} onclick={() => (asking = { what: "remove", id: a.id })}
                    >{a.id ? t("Entfernen") : t("Abmelden")}</Button
                  >
                {/if}
              {/if}
            </div>
            {#if sharing === a.id && a.id}
              <div class="bg-background/60 flex flex-col gap-1.5 rounded-lg p-2.5">
                <p class="text-muted-foreground text-meta">{t("Mit ~/.claude geteilt (verlinkt). Aus: Dateien werden eine eigene Kopie, Ordner starten leer.")}</p>
                {#each a.shared as [g, on] (g)}
                  <Checkbox
                    size="md"
                    checked={on}
                    disabled={busy}
                    onchange={async (e) => {
                      const box = e.currentTarget;
                      await act(() => invoke("claude_account_share", { id: a.id, group: g, on: box.checked }));
                      // Failed: show the old state again (checked is one-way, the reload leaves it as clicked)
                      if (error) box.checked = on;
                    }}>{GROUP[g] ?? g}</Checkbox
                  >
                {/each}
              </div>
            {/if}
          </li>
        {:else}
          <li class="text-muted-foreground px-3 py-3 text-body">{loading ? t("Lese Konten …") : t("Nicht angemeldet.")}</li>
        {/each}
      </ul>
      {#if legacy.length}
        <div class="flex flex-col gap-1.5">
          <p class="text-muted-foreground text-ui">{t("Früher gemerkt: einmal neu anmelden, dann hat das Konto seinen eigenen Ordner.")}</p>
          {#each legacy as e (e)}
            <div class="flex items-center gap-2 text-ui">
              <span class="min-w-0 flex-1 truncate" title={e}>{e}</span>
              <Button variant="outline" size="sm" disabled={busy} onclick={() => startLogin(null, e)}>{t("Anmelden")}</Button>
              <Button variant="ghost" size="sm" disabled={busy} onclick={() => act(() => invoke("claude_account_legacy_forget", { email: e }))}>{t("Entfernen")}</Button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
    {#if error}<p class="text-destructive text-ui whitespace-pre-line">{error}</p>{/if}
    <div class="flex justify-end gap-2">
      {#if !login}
        <Button variant="outline" size="sm" class="mr-auto" disabled={busy} onclick={() => startLogin(null)}>{t("Weiteres Konto anmelden")}</Button>
      {/if}
      <Button variant="ghost" size="sm" onclick={() => (open = false)}>{t("Schließen")}</Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
