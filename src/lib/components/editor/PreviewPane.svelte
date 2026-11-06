<script lang="ts">
  // Vorschau der aktiven oder angehefteten Datei. Der Renderer kommt aus files.PREVIEW_KINDS (nach Endung).
  // Haelt nur Anzeigezustand; pin und url liegen im Store und ueberleben das Umdocken.
  import Markdown from "$lib/components/Markdown.svelte";
  import { Button, Empty, IconButton, Input, TextButton, paneBar } from "$lib/atelier-ui";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";
  import PlayIcon from "@lucide/svelte/icons/play";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import SquareIcon from "@lucide/svelte/icons/square";
  import EyeOffIcon from "@lucide/svelte/icons/eye-off";
  import ShieldAlertIcon from "@lucide/svelte/icons/shield-alert";
  import { forge } from "$lib/git";
  import { DOTNET_FEHLT, DOTNET_URL, NUR_WINDOWS, previewKind, previewUrl, xamlRender } from "$lib/files";
  import { allowWpf, editor, setPin, setUrl } from "$lib/editor.svelte";
  import { devUrl } from "$lib/editor.logic";
  import { devConfig } from "$lib/run.logic";
  import { detect, run, runStart, runStop } from "$lib/run.svelte";
  import { t } from "$lib/i18n";

  let { repo }: { repo: string } = $props();

  const s = $derived(editor(repo));
  const target = $derived(s.pin ?? s.active);
  const kind = $derived(target ? previewKind(target) : null);
  const f = $derived(target ? s.files[target] : undefined);
  // Gespeicherte URL nochmal pruefen: nur http(s) darf in den iframe.
  // Eine von Hand eingetragene Adresse gewinnt gegen die erkannte des eigenen Dev-Servers.
  const r = $derived(run(repo));
  const url = $derived(devUrl(s.url) || r.runs.find((x) => x.url)?.url || "");

  // Dev-Server: was der Start-Knopf starten wuerde (liest nur). Ausgabe und Rueckfragen zeigt das Panel "Ausgabe".
  $effect(() => void detect(repo));
  const dev = $derived(devConfig(r.configs, target ?? ""));
  // Nur ein npm-Lauf ist der Dev-Server (cargo run/dotnet watch stoppt die Vorschau nicht): der mit Adresse oder das
  // dev-Script, andere npm-Scripts daneben zaehlen nicht.
  const npm = $derived(r.runs.find((x) => x.state === "running" && x.cfg.target.kind === "npm" && (!!x.url || x.cfg.label === dev?.label)));
  const running = $derived(!!npm);
  function toggleDev() {
    if (npm) return void runStop(repo, npm.cfg.label);
    if (dev) void runStart(repo, dev);
  }

  // Zaehler des Neu-laden-Knopfs: haengt an ?v= bzw. baut den iframe neu auf.
  let n = $state(0);
  // mtime aendert sich beim Speichern: damit laedt die WebView Seite und Bild neu. Eine Webseite bindet andere
  // Dateien ein (CSS, JS): bei ihr zaehlt die juengste aller offenen Dateien.
  const stamp = $derived(
    kind === "web" ? Math.max(0, ...Object.values(s.files).map((o) => o.mtime ?? 0)) : (f?.mtime ?? 0),
  );
  const src = $derived(target ? previewUrl(repo, target, `${stamp}-${n}`) : "");
  // XAML laden kann Code ausfuehren: unter Windows erst nach Freigabe des Projekts (anderswo rendert ohnehin nichts).
  const locked = $derived(navigator.userAgent.includes("Windows") && !s.wpf);

  // URL-Feld: erst Enter uebernimmt, sonst laedt der iframe bei jedem Tastendruck.
  let draft = $state("");
  let bad = $state(false);
  $effect(() => {
    draft = s.url;
  });
  function go() {
    const v = devUrl(draft);
    bad = v === null;
    if (v !== null) setUrl(repo, v);
  }

  // WPF: statisches Bild, beim Tippen verzoegert neu gerendert. Das letzte gute Bild bleibt bei Fehlern stehen.
  let png = $state("");
  let error = $state("");
  let shown: string | null = null;
  $effect(() => {
    const path = target;
    const text = f?.text;
    void n;
    if (kind !== "xaml" || !path || text === undefined || url || locked) return;
    if (shown !== path) {
      shown = path;
      png = "";
      error = "";
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const out = await xamlRender(repo, path, text);
        if (stale) return;
        png = out;
        error = "";
      } catch (e) {
        if (!stale) error = String(e);
      }
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });
</script>

<div class="@container flex h-full min-h-0 flex-col text-ui">
  <!-- Schmal: Knopftexte weg, sonst drueckt die Leiste das Adressfeld auf null und das Panel scrollt quer -->
  <div class={paneBar}>
    <Input
      bind:value={draft}
      placeholder={r.runs.find((x) => x.url)?.url || (target ?? "http://localhost:5173")}
      title={t("Adresse eines laufenden Dev-Servers; leer = Datei bzw. gestarteten Dev-Server anzeigen (Enter übernimmt)")}
      aria-label={t("Adresse der Vorschau")}
      aria-invalid={bad}
      spellcheck={false}
      density="xs"
      class="min-w-0 flex-1 font-mono text-ellipsis"
      onkeydown={(e) => e.key === "Enter" && go()}
    />
    <Button
      variant="quiet"
      size="xs"
      class={running ? "text-foreground" : ""}
      disabled={!running && !dev}
      title={running
        ? t("Stoppen ({name})", { name: npm?.cfg.label ?? "" })
        : dev
          ? t("Dev-Server starten: {name} – führt Code aus dem Projekt aus", { name: dev.label })
          : t("Kein dev-, start- oder serve-Script in package.json gefunden")}
      onclick={toggleDev}
    >
      {#if running}<SquareIcon class="fill-current" />{:else}<PlayIcon />{/if} <span class="@max-[26rem]:hidden">Dev-Server</span>
    </Button>
    <Button
      variant="quiet"
      size="xs"
      disabled={!target}
      aria-pressed={!!s.pin}
      title={s.pin ? t("Angeheftet: {path} – lösen, um der aktiven Datei zu folgen", { path: s.pin }) : t("Vorschau an diese Datei heften")}
      onclick={() => setPin(repo, s.pin ? null : target)}
    >
      {#if s.pin}<PinOffIcon />{:else}<PinIcon />{/if} <span class="@max-[26rem]:hidden">{t("Anheften")}</span>
    </Button>
    <IconButton size="md" label={t("Neu laden")} onclick={() => n++}><RefreshCwIcon class="size-3.5" /></IconButton>
  </div>
  {#if bad}
    <div class="text-destructive border-border border-b px-2 py-1" role="alert">{t("Nur http://- oder https://-Adressen.")}</div>
  {/if}
  <div class="min-h-0 flex-1 overflow-auto">
    {#if url}
      <!-- bg-white: Seiten ohne eigenen Hintergrund rechnen mit Weiss wie im Browser. -->
      <!-- sandbox ohne allow-top-navigation: die Seite darf das App-Fenster nicht ersetzen (dort haette sie alle Befehle der App). -->
      <!-- allow-modals/-downloads: confirm(), alert() und Downloads der laufenden App sollen wie im Browser gehen. -->
      {#key n}<iframe
          src={url}
          sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-downloads"
          title={t("Vorschau {url}", { url })}
          class="size-full border-0 bg-white"
        ></iframe>{/key}
    {:else if !target}
      <Empty icon={EyeOffIcon}>{t("Keine Datei für die Vorschau. Datei öffnen oder Adresse eingeben.")}</Empty>
    {:else if kind === "web"}
      <!-- Zusaetzlich ohne allow-same-origin: alle Projekte liegen auf einem Origin, per fetch laese die Seite sonst fremde Dateien. -->
      <iframe {src} sandbox="allow-scripts allow-forms" title={t("Vorschau {url}", { url: target })} class="size-full border-0 bg-white"></iframe>
    {:else if kind === "image"}
      <div class="grid min-h-full place-items-center p-3">
        <img {src} alt={target} class="max-w-full" />
      </div>
    {:else if kind === null}
      <!-- File name only (path in the field above): the full path broke mid-word in a narrow pane. -->
      <Empty icon={EyeOffIcon}><span class="break-words" title={target}>{t("Keine Vorschau für {path}.", { path: target.split("/").pop() ?? target })}</span></Empty>
    {:else if !f}
      <Empty>{t("Lädt …")}</Empty>
    {:else if kind === "markdown"}
      <div class="p-3"><Markdown text={f.text} onerror={(e) => (s.error = e)} /></div>
    {:else if locked}
      <Empty icon={ShieldAlertIcon}>
        {t("Die WPF-Vorschau lädt XAML aus diesem Projekt. XAML kann dabei Code ausführen – nur für Projekte erlauben, denen du vertraust.")}
        {#snippet action()}<Button size="xs" variant="outline" onclick={() => allowWpf(repo)}>{t("WPF-Vorschau erlauben")}</Button>{/snippet}
      </Empty>
    {:else if error === NUR_WINDOWS}
      <Empty icon={EyeOffIcon}>{t("WPF-Vorschau nur unter Windows.")}</Empty>
    {:else if error === DOTNET_FEHLT}
      <Empty icon={EyeOffIcon}>
        {t("Für die WPF-Vorschau fehlt die .NET 8 Desktop Runtime.")}
        {#snippet action()}<TextButton
            tone="primary"
            class="underline"
            onclick={() => forge.openUrl(DOTNET_URL).catch((e) => (s.error = String(e)))}>{t("Bei Microsoft herunterladen")}</TextButton
          >{/snippet}
      </Empty>
    {:else}
      {#if error}
        <pre class="text-destructive border-border border-b px-2 py-1 font-mono text-meta whitespace-pre-wrap select-text" role="alert">{error}</pre>
      {/if}
      {#if png}
        <div class="grid place-items-center p-3">
          <img src="data:image/png;base64,{png}" alt={t("WPF-Vorschau {path}", { path: target })} class="max-w-full" />
        </div>
      {:else if !error}
        <Empty>{t("Rendert …")}</Empty>
      {/if}
    {/if}
  </div>
</div>
