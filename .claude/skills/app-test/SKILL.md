---
name: app-test
description: Die echte Dev-App schnell und ohne Maus, Tastatur oder Fensterfokus des Users bedienen (scripts/ui.mjs über die Dev-Bridge), um eine Änderung im UI zu prüfen. Nutzen, wenn eine Änderung in der laufenden App getestet, durchgeklickt, im UI geprüft oder per Screenshot angesehen werden soll. Nie System Events, cliclick oder andere OS-Eingaben dafür nehmen.
---

# App testen ohne Fokusklau

`scripts/ui.mjs` steuert die Dev-App über `src-tauri/src/devbridge.rs` (nur Debug-Builds): DOM-Events im Webview, kein OS-Input. Ein Schritt dauert meist 2–100 ms. Der User kann parallel weiterarbeiten.

## Start

```sh
node scripts/dev-bg.mjs      # statt npm run tauri dev; im Hintergrund, Bash mit dangerouslyDisableSandbox
```

`dev-bg.mjs` startet die App hinter der App, die gerade vorne ist, auch bei jedem Neustart nach einer Rust-Änderung. Bereit ist sie, sobald `node scripts/ui.mjs eval "return 1"` mit `1` antwortet; nach einer Rust-Änderung startet sie neu, Port und Token wechseln, das CLI liest sie jedes Mal neu.

## Befehle

Mehrere Schritte mit `--` verketten, das spart den Node-Start:

```sh
node scripts/ui.mjs snap -- click "label=Settings" -- wait "[role=dialog]" -- snap "[role=dialog]"
```

| Befehl | Wirkung |
|---|---|
| `snap [ziel]` | Gliederung wie ein Accessibility-Baum: Bedienelemente mit `@eN`-Refs, Überschriften, Text, Terminals (letzte Zeilen), Editoren (Zeilen, Cursor). Erst `snap`, dann handeln. |
| `click` / `dbl` / `right` / `hover <ziel>` | volle Pointer-Sequenz (bits-ui öffnet auf `pointerdown`) |
| `fill <ziel> <text>` | ersetzt den Inhalt: Input, Textarea, contenteditable, CodeMirror |
| `type <ziel> <text>` | fügt an der Auswahl ein (CodeMirror: `replaceSelection`) |
| `term <ziel> <text>` | schreibt in den PTY eines xterm (`\r` = Enter) |
| `press <taste> [ziel]` | `Enter`, `Escape`, `Mod+k` (Mod = Cmd/Ctrl); auf das fokussierte Element oder `ziel` |
| `wait` / `gone <ziel> [ms]` | wartet, bis das Ziel da bzw. weg ist (Standard 5000 ms) |
| `text <ziel>` | sichtbarer Text; CodeMirror: ganzes Dokument; Terminal: ganzer Puffer |
| `shot <datei.png>` | Screenshot nur des App-Fensters (macOS, `screencapture -l`), auch wenn es verdeckt ist. Danach mit Read ansehen. |
| `eval <js>` | Rumpf einer async-Funktion im Webview, `return` liefert JSON |
| `size <w> <h>`, `reload`, `sleep <ms>` | Fenstergröße, Seite neu laden, warten |

Ziele: `@e12` (aus `snap`), `text=Speichern` (sichtbarer Text, exakte Treffer zuerst), `label=Settings` (aria-label/title/placeholder, exakt), sonst CSS-Selektor. Bei mehreren Treffern nimmt das CLI den ersten und meldet die Anzahl. Texte in `fill`/`type`/`term` kennen `\n \r \t \e`.

## Fallen

- **Der Klick auf eine Projektzeile öffnet eine Claude-Session.** Gezielt die Buttons `Editor (⌘+2)` / `Git (⌘+3)` in der Zeile klicken. Eine versehentlich gestartete Session per `term` mit `\r` am Trust-Dialog („No, exit“) oder `label=End session` beenden.
- Während eines Tests keine Quelldateien ändern: HMR lädt neu, die App springt zur Projektliste, Refs werden ungültig.
- Refs gelten bis zum Reload. Nach `reload` oder einem Neustart erneut `snap`.
- Liegt das Fenster nicht auf dem aktiven Space (z. B. weil der User eine App im Vollbild hat), rendert WebKit nicht. `ui.mjs` lässt rAF dann über Timer laufen, schaltet CSS-Animationen ab und beendet Web-Animationen sofort. Optik von Animationen ist so nicht prüfbar, Logik und `shot` schon.
- Synthetische Events sind `isTrusted=false`: Kein Browser-Default wie Text-Einfügen per keydown oder ein natives `<select>`-Popup. Dafür gibt es `fill`/`type`. `:hover`-CSS greift nicht.
- `document.hasFocus()` ist im Hintergrund `false`. Fokus über `document.activeElement` prüfen.
