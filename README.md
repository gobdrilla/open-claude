# L'Atelier de Claude

Die Werkstatt für Claude Code: Repo-Liste, eigenes Terminal, Mini-IDE und Git-Client in einer App. Findet alle Git-Repos unter einem Dev-Ordner und startet
`claude` im gewählten Projekt in einem eingebauten Terminal, daneben ein Aktivitäts-Panel mit
Session, Workflows und Agents. Dazu kommen ein Git-Client (Änderungen stagen und committen, Verlauf
mit Graph, Branches, Stashes, Tags, Merge-Editor, Klonen von GitHub und GitLab) und ein Editor mit
Dateibaum, Vorschau, Run-Leiste und Test-Explorer.

Tauri v2 (Rust) + SvelteKit + shadcn-svelte.

## Installation

### Windows

Setup aus den [Releases](../../releases) laden und ausführen. Die Anwendung ist nicht signiert,
Windows fragt daher einmalig nach: *Weitere Informationen → Trotzdem ausführen*.

Voraussetzungen auf dem Rechner (fehlen `claude` oder Git, bietet die Titelleiste beim Start die Installation an):

- `claude` auf dem PATH — sonst öffnet sich das Terminal ohne startende CLI
- Git for Windows — für die Git-Ansicht, die Zeit des letzten Commits und für Befehle mit Pipes,
  Umleitungen oder Variablen im Terminal (`ocui-sh` reicht sie an die Git-Bash weiter, sonst an `cmd`)
- Windows 10 1809 oder neuer (ConPTY)

### macOS

`.dmg` (Apple Silicon oder Intel) aus den [Releases](../../releases) laden. Die Anwendung ist
nicht signiert, macOS blockiert den ersten Start daher: im Finder mit Rechtsklick auf die App
→ *Öffnen* wählen, oder per Terminal die Quarantäne-Markierung entfernen:

```sh
xattr -dr com.apple.quarantine "/Applications/Atelier.app"
```

Voraussetzung: `claude` auf dem PATH, sonst öffnet sich das Terminal ohne startende CLI. Fehlt es, bietet
die Titelleiste beim Start die Installation an.

### Linux

AppImage oder `.deb` aus den [Releases](../../releases) laden. Das AppImage braucht
Ausführrechte (`chmod +x`), das `.deb` lässt sich mit `apt install ./atelier_*.deb`
einrichten.

Voraussetzungen auf dem Rechner (fehlt `claude`, bietet die Titelleiste beim Start die Installation an):

- `claude` auf dem PATH — sonst öffnet sich das Terminal ohne startende CLI
- WebKitGTK (`libwebkit2gtk-4.1-0`) und `libayatana-appindicator3-1` für das Tray-Icon,
  auf gängigen Distributionen meist schon vorhanden

## Bedienung

Tippen filtert unscharf: `adbe` findet `adesk-backend`, `uber` findet `Überblick`. Auch Sprachen sind
suchbar (`rust`).

| Taste | Aktion |
| --- | --- |
| `⏎` / Klick | Git-Ansicht öffnen |
| `Strg` + `⏎` / `Umschalt` + Klick | Claude im Projekt starten |
| `↑` `↓` | Projekt wählen |
| `Strg` + `1`…`9` | Claude im Treffer starten |
| `Strg` + `G` | Git-Ansicht öffnen |
| `Strg` + `Shift` + `E` | Editor öffnen |
| `Strg` + `N` | Repo klonen |
| `Strg` + `Shift` + `N` | Neues Repo anlegen |
| `Strg` + `T` | Claude ohne Projekt starten (im Home-Ordner) |
| `Strg` + `K` | Suche fokussieren |
| `Strg` + `P` | Projekt anpinnen |
| `Strg` + `E` | Ordner im Explorer öffnen |
| `Strg` + `R` | Neu einlesen |
| `Strg` + `O` | Dev-Ordner wechseln |
| `F1` | Kürzel-Übersicht |
| Rechtsklick | Weitere Aktionen, z. B. vom Gerät löschen |
| `Esc` | Suche leeren, sonst schließen (je nach Einstellung ins Tray) |

Im Terminal gehen alle Tasten an die Shell, außer:

| Taste | Aktion |
| --- | --- |
| `Shift` + `Esc` oder `Strg` + `Shift` + `W` | Zurück zur Liste, Sitzung läuft weiter |
| `Alt` + `G` | Git-Ansicht des Projekts |
| `Alt` + `E` | Ordner im Explorer öffnen |
| `Strg` + `Shift` + `E` | Editor öffnen |
| `Strg` + `Shift` + `C` | Auswahl kopieren |
| `Strg` + `V` | Einfügen |

Angepinnte Projekte stehen immer oben. Der Projekttyp (Unity, Tauri, Godot, Unreal, Flutter, Next.js,
Nuxt, SvelteKit, Angular, Django) bzw. sonst die Sprache wird an den üblichen Projektdateien erkannt
(`src-tauri/`, `project.godot`, `Cargo.toml`, `*.csproj`, …) und als Badge angezeigt, daneben Branch
und Alter des letzten Commits. Die Suche findet beides, `rust` also auch Tauri-Projekte.
Unity-Projekte zeigen `Unity <Version>` mit einem Punkt für Editor offen/zu; per Rechtsklick lassen sich der Editor öffnen/schließen und Unity-Support
einrichten (siehe [Unity-Ansicht](#unity)).

Beim ersten Start fragt die App nach dem Dev-Ordner, vorbelegt mit `%DEV%`, sonst `%USERPROFILE%\Dev`;
später wechselt `Strg` + `O` ihn. Einstellungen, Pins und der Repo-Cache liegen in `settings.json`
im App-Datenordner `com.marlonschmitz.openclaude` (Windows `%APPDATA%`, macOS
`~/Library/Application Support`, Linux `~/.local/share`).

Pro Projekt läuft höchstens eine Sitzung. Erneutes Starten springt zur offenen Sitzung,
laufende Sitzungen sind in der Liste markiert. Beenden (Titelleiste oder das X am Badge *läuft*)
fragt vorher nach. Das Terminal startet erst `claude`, danach bleibt eine Shell offen: unter macOS
und Linux die Login-Shell aus `$SHELL`, unter Windows die eigene Shell `ocui-sh`, die neben der App
liegt. Fehlt sie, nimmt die App Git-Bash, `pwsh` oder `cmd`.

*Aktivität* in der Titelleiste blendet rechts das Panel zur Sitzung ein: Kontext, Limits, Kosten und
Todos der laufenden Session, Workflows mit Phasen und Agents, Agent-Aufrufe und Bilder. Gespeicherte
Workflow-Vorlagen lassen sich dort bearbeiten und starten. Die Daten liefert die eingebaute Mod
(`src-tauri/mods/open-claude`), die jedes gestartete `claude` mitbekommt; eigene Mods kommen aus
`~/.claude/open-claude-mods`.

Das Zahnrad rechts in der Suchleiste enthält Zoom, Hell/Dunkel/System, die Rückfragen bei
Git-Aktionen, *Skill-Profile*, *Claude-Einstellungen* (wie `/config`) und *Nach Updates suchen*.
Unter Windows und Linux kommen zwei Schalter dazu:

- *Schließen legt ins Tray* (Standard: an): Schließen versteckt das Fenster nur, es kommt per
  Klick aufs Tray-Icon zurück; beendet wird die App über *Beenden* im Kontextmenü des Tray-Icons.
  Ist der Schalter aus, beendet Schließen die App samt allen laufenden Sitzungen.
- *Autostart* startet die App bei der Anmeldung des Benutzers.

Unter macOS gibt es beide nicht: Schließen versteckt das Fenster, ein Klick aufs Dock- oder Menüleisten-Icon holt es
zurück, Cmd+Q beendet die App. Autostart läuft dort über die Anmeldeobjekte der Systemeinstellungen.

Daneben liegen *Neu einlesen*, *Claude ohne Projekt*, *Neues Repo*, *Klonen* und *Konten* als Icons.

## Editor

`Strg` + `Shift` + `E` öffnet den Editor des Projekts: Dateibaum, Tabs, die sich per Ziehen
umsortieren und an den Kanten teilen lassen, `Strg` + `P` zum Suchen und `Strg` + `S` zum Speichern.
Hat sich eine Datei seit dem Öffnen auf der Platte geändert, speichert der Editor nicht still drüber.
Zeilenenden (LF/CRLF) und BOM bleiben erhalten, Löschen geht in den Papierkorb.

- **Vorschau:** HTML, Markdown und Bilder, dazu der laufende Dev-Server, sobald die Run-Leiste
  eine lokale Adresse ausgibt. Unter Windows auch WPF-XAML (braucht die .NET 8 Desktop Runtime,
  Freigabe pro Projekt).
- **Run-Leiste:** startet Skripte aus `package.json` (npm, pnpm, yarn, bun) sowie `cargo` und
  `dotnet` mit Build-Profilen (Debug/Release, Zusatzargumente).
- **Tests:** erkennt vitest, jest, `node --test`, `cargo test`, dotnet und pytest und zeigt
  Ergebnisse je Test; einzelne Dateien oder Tests lassen sich gezielt starten.

## Git-Ansicht

`Strg` + `G` in der Liste oder *Git* im Terminal-Kopf öffnet die Git-Ansicht des Projekts.
Links stehen Branches (mit ↑↓ zum Upstream), Remotes, Tags, Stashes und offene Pull Requests,
rechts die Tabs *Änderungen*, *Verlauf*, *Releases*, *Pipelines*/*Actions* und bei Unity-Projekten
zusätzlich *Unity*, dazu *Skills*. Aktionen gibt es per Rechtsklick, Löschen,
Reset, Verwerfen und Force-Push fragen vorher nach. Nicht gemergte Branches lassen sich nach
einer zweiten Rückfrage trotzdem löschen.

- **Nicht gemergt:** Oben in der Sidebar stehen alle Branches mit Commits, die noch nicht im
  Production-Branch sind, mit Anzahl und Alter. Gemergte Branches sind ausgegraut. Der
  Production-Branch wird erkannt (`origin/HEAD`, sonst `main`/`master`) oder übers Zahnrad bzw.
  Rechtsklick auf einen Branch fest eingestellt; das steht pro Repo in `git config ocui.base`.

- **Änderungen:** Doppelklick oder Leertaste stagt bzw. unstagt eine Datei. Im Diff lassen sich
  einzelne Hunks oder per Klick/Umschalt-Klick einzelne Zeilen stagen, unstagen und verwerfen.
  Commit mit `Strg` + `⏎`, *Amend* lädt die letzte Nachricht.
- **Verlauf:** Commit-Graph über alle Branches, Suche nach Text, Autor oder SHA (lädt dafür ältere
  Commits nach, bis 5000 automatisch, danach per Klick). Rechtsklick auf
  einen Commit: Branch oder Tag anlegen, auschecken, Cherry-Pick, Revert, Reset.
- **Konflikte:** Bei Merge, Rebase, Cherry-Pick oder Revert zeigt ein Banner die offenen
  Konflikte mit *Fortsetzen* und *Abbrechen*. Klick auf eine Konfliktdatei öffnet den
  Merge-Editor: pro Block Ours, Theirs, beide oder Basis wählen, `F7` springt zum nächsten
  Konflikt, `Strg` + `S` speichert und markiert die Datei als gelöst.
- **Unity** *(nur Unity-Projekte)*: Status von CLI, Editor (installiert/offen/verbunden), Pipeline-Paket
  und Skill, dazu *Unity-Support einrichten* mit Log-Ausgabe. Editor öffnen/schließen (Schließen fragt
  nach, *Erzwingen* beendet den Prozess hart). *EditMode*/*PlayMode* starten Tests: läuft der Editor
  und ist per Pipeline erreichbar, laufen sie darüber, sonst im Batchmode; ist er offen, aber nicht
  erreichbar, kommt ein Fehlertext statt eines Ergebnisses. Grün nur ohne fehlgeschlagene,
  übersprungene oder unklare Tests, Fehler mit Meldung je Test.
- **Skills:** Alle Skills aus `~/.claude/skills`, `.claude/skills` des Projekts und installierten
  Plugins, mit Suche, Quelle und Beschreibung. Plugins lassen sich als Gruppe an- und ausschalten.
  Neben jedem Schalter steht, woher der Wert kommt (User, Team, Profil, angepasst); Anpassungen
  lassen sich einzeln zurücksetzen. Oben wählt man das Profil: nach Projekttyp, fest oder keins.
  *Skill-Profile* im Einstellungsmenü legt Profile als Vorlagen an (leer oder aus einem Projekt)
  und ordnet sie Projekttypen zu. Anpassungen im Projekt ändern das Profil nie. Das Ergebnis landet
  vor jedem Start und bei jeder Änderung als `skillOverrides`/`enabledPlugins` in
  `.claude/settings.local.json`; andere Keys bleiben erhalten, die Datei kommt in
  `.git/info/exclude`. Ist sie eingecheckt, schreibt die App nichts. Projekte ohne Profil und
  Anpassung bleiben unberührt. Änderungen an `~/.claude/settings.json` greifen erst beim nächsten
  Start über die App.
- *Claude*, *Explorer* und Aktualisieren stehen oben in der Titelleiste.

| Taste | Aktion |
| --- | --- |
| `Strg` + `1` … `4` | Änderungen / Verlauf / Releases / Pipelines |
| `Strg` + `5` | Unity *(nur Unity-Projekte)* |
| `Strg` + `6` | Skills |
| `Strg` + `Shift` + `F` | Fetch |
| `Strg` + `Shift` + `L` | Pull (Merge; Rebase über das Menü daneben) |
| `Strg` + `Shift` + `P` | Push, ohne Upstream mit `-u origin` |
| `F5` | Aktualisieren, passiert auch bei Fensterfokus |
| `Esc` oder `Strg` + `Shift` + `W` | Zurück zur Liste |

Fetch, Pull und Push melden sich mit dem Token des Kontos an, das dem Repo zugeordnet ist,
sonst über die Credential-Helper von Git (z. B. den Git Credential Manager aus Git for Windows).

## Konten und Klonen

*Konten* (Icon in der Suchleiste) verwaltet GitHub- und GitLab-Konten, auch selbst gehostete
(Host-Feld, z. B. `gitlab.firma.de`). Anmelden geht per Personal Access Token oder mit
*Von gh/glab übernehmen*, wenn die jeweilige CLI angemeldet ist. Nötige Token-Rechte:

| Anbieter | Scopes |
| --- | --- |
| GitHub | `repo`, `read:org` |
| GitLab | `api`, `read_repository`, `write_repository` |

GitLab braucht `api`, damit Pipelines neu gestartet und Releases angelegt werden können.
Der Token liegt nur im Schlüsselbund des Systems (Dienst `ocui`: Windows-Anmeldeinformations-
verwaltung, macOS-Schlüsselbund, unter Linux Secret Service), die Kontoliste ohne Token in
`settings.json`.

*Klonen* (`Strg` + `N`) listet die eigenen Repos des gewählten Kontos, zuletzt aktive zuerst.
Tippen filtert lokal, `⏎` bzw. *Überall suchen* sucht auf dem Server. Alternativ eine beliebige
Git-URL einfügen. Zielordner ist `<Dev-Ordner>/<Name>`, wählbar sind HTTPS oder SSH. Beim
Klonen über HTTPS wird der Token nur für diesen einen Aufruf mitgegeben und nirgends
gespeichert. Danach liest die App neu ein und markiert das Projekt.

## Entwicklung

```sh
npm install
npm run tauri dev                      # baut vorher ocui-sh mit

npm run check                          # Svelte + TypeScript
node --test src/lib/*.test.ts          # Frontend-Logik (Node 24, ohne Vitest)
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

Bauen:

```sh
npm run tauri build -- --no-bundle       # nur die .exe
npm run tauri build -- --bundles nsis    # Setup
npm run tauri build -- --bundles msi     # MSI für die Softwareverteilung
```

Hinter einem Proxy mit eigenem Root-Zertifikat brauchen die Paketmanager einen Hinweis:
`.cargo/config.toml` setzt dafür `check-revoke = false`, und für die shadcn-Registry hilft
`NODE_OPTIONS=--use-system-ca`.

## Releases bauen

Windows-, macOS- (Apple Silicon und Intel) und Linux-Builds laufen kostenlos über
GitHub Actions (`.github/workflows/release.yml`). Ein Tag `vX.Y.Z` pushen löst den Build
aus und legt einen Entwurf unter [Releases](../../releases) mit allen Installern an; der
Entwurf muss danach manuell freigegeben werden. Über *Actions → Release → Run workflow*
lässt sich derselbe Workflow auch ohne Release nur zum Testen der Builds anstoßen, die
Bundles liegen dann als Artefakte am Workflow-Lauf.
