---
name: forge-pr
description: Pull Request (GitHub) bzw. Merge Request (GitLab) anlegen, CI-Status und Review-Kommentare lesen und beantworten, über die MCP-Tools git, forge_read und forge_write von L'Atelier de Claude. Nutzen bei "PR erstellen", "Merge Request", "CI-Status", "Pipeline", "Review-Kommentare", "PR mergen".
---

# Forge: PR/MR, CI, Kommentare

Die Tools `forge_read` (GET) und `forge_write` (POST/PATCH/PUT/DELETE) sprechen die API des `origin`-Remotes mit dem Konto aus L'Atelier de Claude. Es gibt weder `gh` noch `glab` noch einen Token im Spiel.

## Regeln

- Nie nach einem Token fragen, keinen suchen, nie in Befehle oder Dateien schreiben. Meldet ein Tool „Kein Konto“: Nutzer bitten, in L'Atelier de Claude unter „Konten“ anzumelden. Dann stoppen.
- `path` beginnt mit `/` und gilt ab der API-Wurzel (`https://api.github.com` bzw. `https://<host>/api/v4`), nie eine volle URL.
- Das Repo-Präfix steht in der Tool-Beschreibung („Dieses Repository: …“). Genau so übernehmen, nicht raten. Pfade außerhalb dieses Präfixes lehnt das Tool ab.
- `body` ist ein JSON-Objekt, kein String. Listen mit `query` paginieren (`per_page`).
- Vorher beim Nutzer bestätigen lassen, mit konkreter Angabe was passiert: PR/MR anlegen (Titel, Quell- und Zielbranch, Beschreibung), mergen, schließen, jedes `DELETE`, Force-Push. Anlegen, Mergen, Schließen und `DELETE` fragt die App zusätzlich ab; CI-Neustart und andere Schreibzugriffe nicht, dort kommt die Bestätigung nur vom Skill.
- Kommentieren und lesen: ohne Rückfrage, aber Kommentartext vorher dem Nutzer nennen, wenn er in seinem Namen erscheint.

## Präfix

| Forge | Präfix | Beispiel |
|---|---|---|
| GitHub | `/repos/<owner>/<repo>` | `/repos/octo/app` |
| GitLab | `/projects/<Pfad URL-kodiert oder ID>` | `/projects/gruppe%2Funter%2Fapp` |

GitLab: `/` im Projektpfad ist `%2F`, nicht `/`. Unten steht `<P>` für das Präfix.

## 1. Branch pushen

1. `git`-Tool: `["branch", "--show-current"]`, `["status", "-sb"]`. Nicht auf `main`/`master` pushen, dann erst Branch vorschlagen.
2. `git`-Tool: `["push", "-u", "origin", "<branch>"]`. Auth läuft über das Konto.

## 2. PR/MR anlegen

Standardbranch: `forge_read` `<P>` (GitHub: `default_branch`, GitLab: `default_branch`). Titel und Beschreibung aus `git log <ziel>..HEAD` ableiten, auf Deutsch, wenn das Repo es so hält. Bestätigung einholen, dann:

GitHub, `POST <P>/pulls`:
```json
{ "title": "Titel", "head": "feature", "base": "main", "body": "Beschreibung", "draft": false }
```

GitLab, `POST <P>/merge_requests`:
```json
{ "title": "Titel", "source_branch": "feature", "target_branch": "main", "description": "Beschreibung" }
```

Antwort enthält `html_url` (GitHub) bzw. `web_url` (GitLab): dem Nutzer zeigen. Existiert schon ein PR/MR (422 bzw. 409), den bestehenden suchen: GitHub `GET <P>/pulls?head=<owner>:<branch>&state=open`, GitLab `GET <P>/merge_requests?source_branch=<branch>&state=opened`.

## 3. CI-Status lesen

GitHub (`<sha>` = `git rev-parse HEAD`, oder `head.sha` des PR):
- `GET <P>/commits/<sha>/check-runs` (`conclusion` je Check)
- `GET <P>/commits/<sha>/status` (ältere Status-APIs)
- Fehlgeschlagener Lauf: `GET <P>/actions/runs?head_sha=<sha>`, dann `GET <P>/actions/runs/<id>/jobs`, Log `GET <P>/actions/jobs/<job_id>/logs`

GitLab (`<iid>` = Nummer des MR):
- `GET <P>/merge_requests/<iid>/pipelines`
- `GET <P>/pipelines/<pipeline_id>/jobs` (`status`: `failed`)
- Log: `GET <P>/jobs/<job_id>/trace`

Bei Fehlschlag: den relevanten Teil des Logs (Ende, erste Fehlermeldung) zusammenfassen, nicht das ganze Log ausgeben. CI neu starten ist schreibend, also bestätigen: GitHub `POST <P>/actions/runs/<id>/rerun-failed-jobs`, GitLab `POST <P>/pipelines/<id>/retry`.

## 4. Review-Kommentare lesen und beantworten

GitHub:
- Zeilenkommentare: `GET <P>/pulls/<n>/comments` (`path`, `line`, `body`, `id`)
- Allgemeine: `GET <P>/issues/<n>/comments`
- Reviews: `GET <P>/pulls/<n>/reviews`
- Antwort auf Zeilenkommentar: `POST <P>/pulls/<n>/comments/<id>/replies` mit `{ "body": "…" }`
- Allgemein kommentieren: `POST <P>/issues/<n>/comments` mit `{ "body": "…" }`

GitLab:
- `GET <P>/merge_requests/<iid>/discussions` (Threads; `position.new_path`, `position.new_line`, nur `resolved: false` relevant)
- Antwort: `POST <P>/merge_requests/<iid>/discussions/<discussion_id>/notes` mit `{ "body": "…" }`
- Allgemein: `POST <P>/merge_requests/<iid>/notes` mit `{ "body": "…" }`

Vorgehen: offene Kommentare nach Datei gruppieren, `open_file` auf die betroffene Zeile, Änderung vorschlagen oder umsetzen, committen, per `git` pushen, dann kurz im Thread antworten.

## 5. Mergen

Nur auf ausdrücklichen Wunsch, nach Bestätigung, und erst wenn CI grün ist.

- GitHub: `PUT <P>/pulls/<n>/merge` mit `{ "merge_method": "squash" }` (`merge` | `squash` | `rebase`)
- GitLab: `PUT <P>/merge_requests/<iid>/merge` mit `{ "squash": true }`

Schließen: GitHub `PATCH <P>/pulls/<n>` mit `{ "state": "closed" }`, GitLab `PUT <P>/merge_requests/<iid>` mit `{ "state_event": "close" }`. Auch bestätigen.
