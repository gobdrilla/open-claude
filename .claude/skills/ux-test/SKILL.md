---
name: ux-test
description: Echte App unter Windows oder Linux durchklicken, jede Ansicht hell/dunkel per Screenshot prüfen und einen Bericht schreiben. Nutzen, wenn der User "UI testen", "ux-test", "Ansichten prüfen", "auf Windows/Linux testen" o. ä. sagt.
---

# UX-Test auf Windows und Linux

Ziel: Jede Ansicht in der **echten** App (WebView2 unter Windows, WebKitGTK unter Linux) prüfen, nicht im Browser. Du steuerst die App mit `ui.ps1` bzw. `ui.sh` (Ordner dieses Skills): Tasten senden, klicken, Screenshot machen. **Jeden Screenshot mit dem Read-Tool ansehen**, bevor du weitermachst. Ein Screenshot, den du nicht angesehen hast, zählt nicht als geprüft.

Code nicht ändern. Du schreibst nur einen Bericht. Fixes macht der User danach.

## 1. Vorbereitung

**Windows** (PowerShell):
```powershell
git pull
npm ci
npm run tauri dev        # im Hintergrund starten, erstes Bauen dauert einige Minuten
```
Treiber: `powershell -ExecutionPolicy Bypass -File .claude/skills/ux-test/ui.ps1 <befehl> ...`

**Linux:**
```sh
git pull
npm ci
# Wayland: xdotool/import sehen native Wayland-Fenster nicht, darum die App unter XWayland starten
GDK_BACKEND=x11 npm run tauri dev     # im Hintergrund
```
Pakete, falls etwas fehlt: `xdotool imagemagick` und für den Build `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf libssl-dev libdbus-1-dev pkg-config`.
Treiber: `bash .claude/skills/ux-test/ui.sh <befehl> ...`

Screenshots in einen eigenen Ordner außerhalb des Repos, z. B. `%TEMP%\ux-test\` bzw. `/tmp/ux-test/`, Dateinamen wie `03-git-verlauf-dark-1280.png`.

## 2. Treiber

| Befehl | Windows (`ui.ps1`) | Linux (`ui.sh`) |
|---|---|---|
| Screenshot | `shot C:\…\x.png` | `shot /tmp/ux-test/x.png` |
| Tasten | `keys "^1"` (Strg+1), `"%2"` (Alt+2), `"{F1}"`, `"{ESC}"`, `"^+e"` | `keys ctrl+1`, `alt+2`, `F1`, `Escape`, `ctrl+shift+e` |
| Klick / Rechtsklick / Hover | `click 640 120`, `rclick …`, `hover …` | `click 640 120`, `rclick …`, `hover …` |
| Fenstergröße | `size 1280 760` (physische Pixel = logisch × Skalierung) | `size 1280 720` |

Koordinaten sind Pixel im letzten Screenshot, also relativ zur linken oberen Fensterecke. Erst Screenshot, Ziel im Bild suchen, dann klicken, dann neuer Screenshot. Klappt etwas zweimal nicht, den User bitten, den Schritt von Hand zu machen, und danach fotografieren.

Unter Windows mit Skalierung 150 %: 1280×720 logisch heißt `size 1920 1080`.

## 3. Ablauf

1. Fenster auf 1280×720 (logisch). Design dunkel: Einstellungen (Zahnrad oben rechts auf der Startseite) → Allgemein → Design → Dunkel.
2. Checkliste unten Punkt für Punkt: hinnavigieren, Screenshot, **ansehen**, gegen die Kriterien prüfen, Ergebnis notieren.
3. Alles nochmal in **hell**.
4. Die mit „schmal“ markierten Ansichten zusätzlich bei 900×600.
5. Tastatur- und Plattform-Checks (Abschnitt 5).
6. Bericht (Abschnitt 7).

Ein Projekt zum Testen wählen, das Änderungen, Verlauf und Releases hat (z. B. dieses Repo). Klick auf ein Projekt startet `claude` darin, das ist gewollt.

## 4. Checkliste der Ansichten

Kriterien überall: nichts abgeschnitten, überlappend oder aus dem Rahmen; einzeilige Texte brechen nicht um (z. B. „20 min“, Branch-Namen); keine horizontalen Scrollbalken; gleich große Schrift für Gleichrangiges; Umlaute korrekt; Icons vorhanden; Kontrast in hell lesbar; Fokusrahmen sichtbar bei Tastaturbedienung.

**Startseite**
- [ ] Oben: Suche, „Claude ohne Projekt“, „+ Projekt ▾“, Zahnrad. Unten: Limits, „N Projekte · aktualisiert HH:MM“ mit ↻, „F1 Hilfe“. *(schmal)*
- [ ] Laufende Sitzungen erscheinen als **Tabs ganz oben** unter der Titelleiste, es gibt keine Karten „Läuft“.
- [ ] „Wartet auf dich“ erscheint nur, wenn eine Sitzung auf eine Antwort wartet.
- [ ] Gewählte oder gehoverte Projektzeile zeigt rechts „Claude · Editor · Git“; die Zeile wird dabei nicht höher.
- [ ] Alt gedrückt halten: Zeilen zeigen „Alt+1 …“ statt der Zeit.
- [ ] „+ Projekt ▾“ öffnet das Menü: Klonen, Neues Repo, Ordner hinzufügen, Sitzung beitreten. Jeden Dialog einmal öffnen und fotografieren.
- [ ] Rechtsklick auf ein Projekt und auf eine Gruppe: Kontextmenü vollständig, Kürzel rechts lesbar.

**Einstellungen** (Zahnrad)
- [ ] Dialog mit Navigation links: Allgemein, Terminal, Git, Claude, Info. Jeden Bereich fotografieren.
- [ ] Unterdialoge aus den Bereichen öffnen (Git-Konten, Claude-Einstellungen, Claude-Konten, Skill-Profile, Tastenkürzel „Anzeigen“): Sie liegen **über** dem Einstellungsdialog, nicht dahinter.

**Hilfe** (F1)
- [ ] Einspaltig nach Bereichen gegliedert; Kürzel: Strg+1/2/3 für die Ansichten, Alt+1…5 für die Git-Tabs, Klick/⏎ öffnet Claude.

**Titelleiste** (in jedem Projekt)
- [ ] „← Projekte“, Projektname, Branch-Chip, Trennstrich, danach direkt der Umschalter **Claude | Editor | Git** (links, nicht mittig). Fensterknöpfe rechts. *(schmal: Name kürzt sich, nichts überlappt)*
- [ ] Freie Fläche der Titelleiste zieht das Fenster (von Hand prüfen oder den User fragen).

**Claude-Ansicht**
- [ ] Die ClaudeBar geht über die **ganze Breite**: kleines Logo, „Modus ▾“, „Modell ▾“, „Denken ▾“, MCP, Skills; rechts Teilen, Aktivität, + Sitzung, Einstellungen. *(schmal: keine zweite Zeile, nichts abgeschnitten)*
- [ ] Modus-, Modell- und Denken-Menü öffnen sich jeweils (je ein Screenshot).
- [ ] Skills öffnet einen Dialog mit Skills und Plugins.
- [ ] Aktivitäts-Panel (Knopf „Aktivität“): beginnt **unter** der ClaudeBar, gleiche Oberkante wie das Terminal, keine Ecke stößt an eine Linie.
  - Tabs Sitzung | Arbeit | Bilder | Prompts, passen ohne Scrollen.
  - Sitzung: Kontext, 5 h, Woche, Aktiv, Todos lesbar.
  - Arbeit: Abschnitte Vorlagen, Workflows, Agents, jeweils mit Zähler und einklappbar (einmal zu- und wieder aufklappen); „Details“ öffnet die Workflow-Großansicht.
  - Bilder: Kacheln, Badge „Datei“ bei Bildern von der Platte, Klick zeigt das Bild groß.
  - Unten das Feld „Nebenfrage an Claude“ mit „Fragen“.
- [ ] Zweite Sitzung (+ Sitzung): zweiter Tab oben; Rechtsklick auf einen Tab → „Sitzung beenden …“.

**Git-Ansicht** (Strg+3)
- [ ] Kopfzeile: Repo-Kachel mit Branch, Fetch, nur **eine** gefüllte Hauptaktion (Pull oder Push) mit Zähler, Stash, Branch; rechts Dateimanager, ↻, Konto. *(schmal: Branch-Name bleibt sichtbar)*
- [ ] Tabs Änderungen | Verlauf | Releases | CI (| Unity), kein Skills-Tab. Wechsel mit Alt+1 … Alt+4.
- [ ] Änderungen: eine Datei anklicken, dann ↓/↑: Die Auswahl wandert durch beide Listen, der Diff wechselt mit. Leertaste staged bzw. unstaged. Commit-Bereich: „Commit + Push“ und „Commit (n)“ ragen nicht über den Rand. *(schmal)*
- [ ] Verlauf: Zeitspalte einzeilig („20 min“, „2 h“), Avatare nicht abgeschnitten, Commit-Details unten.
- [ ] Releases: erstes Release vorgewählt, Tag nur, wenn er anders als der Titel ist.
- [ ] CI: Status-Icons mit Tooltip, Zeit als „Dauer … · vor …“.
- [ ] Menüs: Pull ▾ (Häkchen am Standard), Push ▾, Konto ▾, Rechtsklick auf einen Branch („Löschen …“).

**Editor** (Strg+2)
- [ ] Werkzeugleiste: Startziel, Starten/Stoppen/Neu starten, Panel-Schalter mit Text (Dateien, Suche, Tests, Vorschau, Probleme mit Zähler), ⋯-Menü mit Layout. *(schmal: Texte verschwinden einheitlich, nicht einzelne)*
- [ ] Panels: Dateibaum, Suche (Zeilennummern einzeilig), Tests, Vorschau, Probleme; jedes einmal fotografieren. Ein Panel-Schalter zeigt nur „aktiv“, wenn sein Panel sichtbar ist.
- [ ] Datei öffnen (Strg+P), Tabs der Dateien lesbar.

## 5. Tastatur- und Plattform-Checks

- [ ] Strg+1/2/3 wechseln die Ansicht, auch wenn der Fokus **im Terminal** und **im Code-Editor** steht. Im Terminal wird dabei nichts eingetippt.
- [ ] Strg+Umschalt+E öffnet den Dateimanager im Projektordner. Strg+D auf der Startseite pinnt das gewählte Projekt an bzw. ab.
- [ ] Esc bzw. Umschalt+Esc führt zurück zu den Projekten; Esc schließt offene Dialoge zuerst.
- [ ] **Windows:** AltGr+Q (@) und AltGr+8/9 ([ ]) im Terminal tippen die Zeichen und lösen kein Kürzel aus. Einmal mit Skalierung 125 % oder 150 % prüfen: Schrift scharf, nichts verschoben.
- [ ] **Linux:** Dialoge sitzen mittig und **scharf**, nicht unscharf und nicht auf volle Höhe gezogen (bekannte WebKitGTK-Falle, siehe `primitives/dialog/dialog-content.svelte`). Kontextmenüs öffnen sich an der Maus. Wenn möglich auch einmal ohne `GDK_BACKEND=x11` nur ansehen (Wayland-nativ): Fenster, Titelleiste, Dialoge.

## 6. Windows: Update von „Open Claude“ (nur wenn der User es testen will)

Braucht einen Rechner, auf dem noch die alte „Open Claude“-Installation liegt, und den neuen `setup.exe` aus dem Release-Lauf (Artefakt `bundles-windows`). Den Lauf startet der User selbst (Actions → Release → Run workflow).

1. Vorher fotografieren bzw. notieren: Startmenü-Eintrag, Desktop-Verknüpfung, angeheftetes Taskleisten-Symbol, `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"`.
2. `setup.exe /UPDATE` ausführen, wie es der Updater macht.
3. Erwartet: Startmenü und Desktop heißen „Atelier“ und starten `%LOCALAPPDATA%\Atelier\ocui.exe`. Das angeheftete Symbol startet die neue Version. Der Run-Eintrag heißt „Atelier“ statt „Open Claude“. Beim nächsten Start wird **kein** Update auf dieselbe Version mehr angeboten.

## 7. Bericht

Datei `ux-test-<windows|linux>-<datum>.md` im Screenshot-Ordner, dazu eine kurze Zusammenfassung im Chat:

```
System: Windows 11 23H2, 150 %, WebView2 1xx | Ubuntu 24.04, GNOME, X11/XWayland, WebKitGTK 2.xx
Stand: <git rev-parse --short HEAD>

| # | Ansicht | hell/dunkel, Größe | Ergebnis | Problem | Screenshot |
|---|---------|--------------------|----------|---------|------------|
| 1 | Git › Verlauf | dunkel 1280 | Fehler | Zeit „20 min“ bricht um | 03-git-verlauf-dark-1280.png |
```

- Ergebnis: OK, Fehler (kaputt oder nicht bedienbar), Unschön (sichtbar, aber benutzbar).
- Pro Problem: was genau, wo im Bild, ob es nur hell/dunkel oder nur schmal auftritt, vermutete Datei, falls offensichtlich.
- Am Ende: was nicht geprüft werden konnte und warum.
