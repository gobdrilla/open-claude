# Testanleitung Windows: Repo-Gruppen in Editor und Git

Neu: Aus einer Gruppen-Sitzung zeigen Editor und Git alle Repos der Gruppe. Der Projektname in der Titelleiste ist dann ein Dropdown.
Alle Befehle in PowerShell im Repo-Ordner.

## 0. Vorbereitung

```powershell
git pull
npm ci
npm run tauri dev
```

Testgruppe anlegen (wird am Ende wieder gelöscht):

1. Auf der Startseite Rechtsklick auf ein Projekt → **„Repo-Gruppe erstellen …“**.
2. Name `TestGruppe`, ein zweites Projekt anhaken. Das zuerst gewählte Projekt ist das Haupt-Repo.
3. **Speichern**. Oben in der Liste erscheint unter „Gruppen“ der Eintrag `TestGruppe`.

## 1. Git über alle Repos

1. `TestGruppe` anklicken. Die Claude-Sitzung startet im Haupt-Repo, der Tab heißt `TestGruppe`.
2. `Strg+3` (oder oben **Git**).
   - Erwartet: Neben dem Projektnamen in der Titelleiste steht ein kleiner Pfeil ▾ (Tooltip „Anderes Projekt der Gruppe“).
3. Auf den Projektnamen klicken.
   - Erwartet: Ein Menü mit beiden Repos und ihrem Branch.
4. Das zweite Repo wählen.
   - Erwartet: Die Git-Ansicht zeigt jetzt dieses Repo, Name und Branch in der Titelleiste wechseln mit.

## 2. Editor über alle Repos

1. `Strg+2` (oder oben **Editor**).
   - Erwartet: Der Editor zeigt das Repo, das gerade in Git offen war. Das Dropdown ist weiterhin da.
2. Im Dropdown auf das andere Repo wechseln und wieder zurück.
   - Erwartet: Der Dateibaum wechselt jedes Mal, offene Dateien bleiben pro Repo erhalten.
3. Optional: In einer Datei etwas tippen (nicht speichern), auf das andere Repo wechseln und zurück. Die ungespeicherte Änderung ist noch da. Danach rückgängig machen.

## 3. Zurück zu Claude

1. Aus Editor oder Git `Strg+1` (oder oben **Claude**).
   - Erwartet: Der vorhandene Tab `TestGruppe` ist aktiv. Es darf **kein zusätzlicher Tab** entstehen (vorher startete hier eine eigene Sitzung nur im Haupt-Repo).

## 4. Normale Projekte unverändert

1. Oben **Projekte** (`Strg+Umschalt+W`) zurück zur Startseite.
2. Bei einem einzelnen Projekt (nicht der Gruppe) mit der Maus über die Zeile fahren und dort **Git** klicken.
   - Erwartet: Projektname ohne Pfeil, kein Dropdown.

## 5. Aufräumen

1. Den Tab `TestGruppe` mit dem ✕ schließen → **Beenden**.
2. Rechtsklick auf `TestGruppe` → **„Gruppe löschen …“** → **Löschen**. Die Projekte selbst bleiben unverändert.

## Rückmeldung

Bei einem Fehler den Schritt nennen (z. B. „2.2“) und kurz beschreiben, was stattdessen passiert ist. Ein Screenshot der Titelleiste hilft.
