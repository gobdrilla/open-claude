# Testanleitung Windows: Alt-Ziffern, große Dateien, Testsuite

Betrifft die Commits `4cde902` (Alt-Ziffern), `74b6d0d` (große Dateien) und `163eee1` (Tests aufgeräumt).
Alle Befehle in PowerShell im Repo-Ordner.

## 0. Vorbereitung

```powershell
git pull
npm ci
```

Vor Schritt 3 die Zahl der Test-Temp-Ordner notieren:

```powershell
(Get-ChildItem $env:TEMP -Directory -Filter 'ocui-*' | Where-Object Name -notlike 'ocui-dev-*').Count
```

## 1. Alt-Ziffern auf der Startseite

App starten: `npm run tauri dev`. Die Startseite mit der Projektliste muss sichtbar sein.

1. **Alt halten:** An den Projektzeilen erscheinen die Ziffern 1–9. **Loslassen:** Sie verschwinden sofort.
2. **Hauptfall:** Alt 5–6 Mal schnell hintereinander antippen. Die Ziffern müssen bei *jedem* Druck aufblitzen. Vorher reagierte nur jeder zweite Druck.
3. **Kein Fenstermenü:** Alt einmal antippen und loslassen, dann `Pfeil runter` oder `Leertaste` drücken. Es darf sich kein Windows-Systemmenü öffnen (Wiederherstellen/Verschieben/Schließen).
4. **Alt+1** öffnet weiterhin das erste Projekt, wie vorher.
5. **AltGr nicht kaputt:** Im Editor eine Datei öffnen und mit AltGr `@ { } [ ] \ € ~ |` tippen. Alle Zeichen müssen erscheinen.
6. **Alt im Terminal:** In einer Claude-Session oder im Terminal ein paar Wörter tippen. Dann springt `Alt+B` ein Wort zurück und `Alt+F` ein Wort vor.
7. **Optional, ganz am Ende:** `Alt+F4` schließt das Fenster weiterhin.

Falls Schritt 2 weiterhin hakt: notieren, ob die Ziffern gar nicht kommen oder nur verzögert.

## 2. Große Dateien

Im Ordner eines Projekts, das in der App offen ist, zwei Testdateien anlegen:

```powershell
Set-Content -NoNewline -Path lang-unter.js -Value ((('x' * 9999) + "`n") * 50)
Set-Content -NoNewline -Path lang-ueber.js -Value ("a`n" + ('x' * 10000))
```

1. In der App den Editor öffnen (Projektzeile → `Editor (Strg+2)`) und `lang-unter.js` öffnen.
   - Erwartet: Die Datei ist sofort offen (unter 1 s), ohne Hinweisleiste.
   - Vorher hing der Editor hier mehrere Sekunden.
2. `lang-ueber.js` öffnen.
   - Erwartet: Oben steht die Leiste **„Große Datei: ohne Highlighting“**, die Datei ist trotzdem sofort offen.
3. Aufräumen:

   ```powershell
   Remove-Item lang-unter.js, lang-ueber.js
   ```

## 3. Tests unter Windows

App vorher beenden.

```powershell
npm run check
node --test src/lib/*.test.ts
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
```

Erwartet:

- `npm run check`: 0 errors.
- `node --test`: `pass 322`, `fail 0`.
- `clippy`: keine Warnungen.
- `cargo test`: alles `ok`, `0 failed`.
  - Einige Tests stehen als `ignored`, das ist richtig: zwei gitlab.com-Netztests und drei Messtests.
  - Neu ist `tests/ocui_sh.rs`, ein Integrationstest für ocui-sh. Er lief bisher nie unter Windows, darauf besonders achten. Der Test `nur_claude` läuft nur auf Mac/Linux und fehlt unter Windows absichtlich.

Danach die Temp-Ordner noch einmal zählen (Befehl aus Schritt 0). Die Zahl muss gleich geblieben sein, früher blieben pro Lauf etwa 80 Ordner liegen.

## Rückmeldung

Bei einem Fehler:

- den Schritt nennen (z. B. „1.2“),
- bei Tests die Ausgabe ab `failures:` bzw. ab der ersten roten Zeile mitschicken.
