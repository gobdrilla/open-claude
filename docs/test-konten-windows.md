# Claude-Konten in eigenen Ordnern: Test unter Windows

Stand: Commit `31bf28b` („feat: Claude-Konten in eigenen Ordnern“). Befehle für PowerShell.

## Vorbereitung

1. Holen und bauen:
   ```powershell
   git pull
   npm ci
   npm run tauri dev
   ```
   Der Windows-Code (`#[cfg(windows)]` in `src-tauri/src/accounts.rs`) ließ sich auf dem Mac nicht kompilieren. Schlägt der Build fehl: Fehlermeldung notieren.

2. claude ab Version 2.1.318, sonst fehlt das Ablaufdatum:
   ```powershell
   claude --version
   ```

3. Sicherung der Dateien, auf die Zusatzkonten verlinken:
   ```powershell
   Copy-Item $env:USERPROFILE\.claude\settings.json $env:USERPROFILE\settings.json.bak
   Copy-Item $env:USERPROFILE\.claude\CLAUDE.md $env:USERPROFILE\CLAUDE.md.bak -ErrorAction SilentlyContinue
   ```

4. Pfade:
   - Standardkonto: `%USERPROFILE%\.claude`
   - Zusatzkonten: `%APPDATA%\com.marlonschmitz.openclaude\claude-accounts\<id>\`. Die `<id>` ist `a` plus 12 Hex-Zeichen.

## Tests

### 1. Dialog öffnen

Settings → Claude → Claude accounts → Manage.

- Das eigene Konto steht mit „Active · Default · Plan · Signed in until …“.
- Fehlt das Datum, ist claude zu alt.

### 2. Weiteres Konto anmelden

„Sign in another account“ klicken. Der Browser-Login startet über „Anmeldeseite öffnen“. Verlangt die Seite einen Code, ihn im Dialog eingeben.

- Danach erscheint eine neue Zeile mit der E-Mail und „Signed in until …“.
- Dieselbe E-Mail wie beim Standardkonto ergibt „… ist schon angemeldet“. Kein Ordner bleibt übrig.
- Wird der Login abgebrochen, verschwinden die Zeile und der Ordner.

### 3. Links im Konto-Ordner prüfen

```powershell
cd $env:APPDATA\com.marlonschmitz.openclaude\claude-accounts
Get-ChildItem          # zeigt die <id>
cd <id>
Get-ChildItem | Select-Object Name, LinkType, Target
```

- Diese Ordner sind **Junction**s mit Ziel `%USERPROFILE%\.claude\<name>`: `projects`, `sessions`, `ide`, `file-history`, `todos`, `skills`, `commands`, `agents`, `output-styles`, `workflows`, `plugins`.
- Diese Dateien sind **HardLink**s: `settings.json`, `history.jsonl`, `CLAUDE.md` (nur, wenn es die Datei in `.claude` gibt).
- Fehlt eine Datei in `%USERPROFILE%\.claude` (z. B. `keybindings.json`), entsteht sie **weder im Konto-Ordner noch in `.claude`**.
- `.claude.json` im Konto-Ordner enthält anfangs nur `theme` und `hasCompletedOnboarding`, keine Anmeldedaten.

### 4. Sitzung mit dem Zusatzkonto

Beim neuen Konto „Verwenden“ klicken und bestätigen, dann eine neue Claude-Sitzung öffnen.

- `/status` zeigt die E-Mail des Zusatzkontos.
- Keine Ersteinrichtung (Theme-Abfrage).
- Skills und Einstellungen sind da, die Sitzung erscheint im Verlauf-Panel.
- Sitzungen, die schon liefen, bleiben beim alten Konto.

### 5. Geteilte Bereiche umschalten

Zahnrad-Knopf beim Zusatzkonto.

- „Settings“ aus: `settings.json` im Konto-Ordner ist danach eine normale Datei (LinkType leer) mit demselben Inhalt.
- „Skills, commands, agents“ aus: die fünf Junctions verschwinden, die Ordner in `%USERPROFILE%\.claude` bleiben unverändert.
- Wieder an: die Links kommen zurück. Die eigene Kopie wird zu `settings.json.own`, beim zweiten Mal `settings.json.own2`.
- Der Haken im Dialog passt nach jedem Klick zum Zustand der Dateien.

### 6. `/config` im Zusatzkonto

In einer Sitzung des Zusatzkontos per `/config` etwas ändern, dann den Dialog neu öffnen.

- Bekannte Schwäche: Wahrscheinlich steht „Settings“ danach auf aus, weil claude die Datei neu schreibt und der Hardlink dabei bricht.
- Notieren: Passiert das? Ist die Änderung in `%USERPROFILE%\.claude\settings.json` angekommen?

### 7. Erneuern

„Erneuern“ beim Konto klicken.

- Der Login startet mit vorausgefüllter E-Mail.
- Danach steht ein neues Datum bei „Signed in until …“.

### 8. Konto entfernen

Erst das Standardkonto auf „Verwenden“ stellen, dann beim Zusatzkonto „Entfernen“ klicken und bestätigen.

- Der Ordner `claude-accounts\<id>` ist weg.
- `%USERPROFILE%\.claude` ist vollständig erhalten. Vor allem `settings.json`, `CLAUDE.md`, `skills`, `plugins` und `projects` mit der Sicherung aus Vorbereitung Schritt 3 vergleichen.

### 9. Aufräumen

Beim Test entstandene leere Ordner in `%USERPROFILE%\.claude` (`commands`, `agents`, `output-styles`, `workflows`, `todos`) dürfen gelöscht werden. Sie schaden aber nicht.

## Rückmeldung

- Build-Fehler, falls einer kam.
- Jeder Schritt, der anders lief als erwartet, mit der Ausgabe von `Get-ChildItem | Select-Object Name, LinkType, Target` und der Meldung im Dialog.
- Das Ergebnis von Schritt 6.
