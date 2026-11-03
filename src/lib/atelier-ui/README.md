# atelier-ui

The app's own control library. Import only via the barrel: `import { Button, Row } from "$lib/atelier-ui"`.
`scripts/check-ui.mjs` (part of `npm run check`) rejects raw `<button>`, `<input>`, `<select>`, `<textarea>` outside this folder and deep imports into it.
Missing a variant? Add it here (small, generic), not as ad-hoc classes in a view.
`primitives/` is shadcn-svelte base material, partly patched. Never regenerate it with the shadcn CLI (the dialog/command centering patch for WebKitGTK would be lost).

## Components

| Name | Purpose |
| --- | --- |
| `Button`, `buttonVariants` | Base button; variants `default` (primary), `outline`, `secondary`, `ghost`, `quiet`, `toggle`, `destructive`, `ghost-danger`, `glow`, `link`. |
| `IconButton` | Icon-only button; `label` is required and becomes the tooltip. |
| `TextButton` | Inline text link-style button. |
| `RefreshButton` | The ↻ button with loading spin. |
| `Input`, `Textarea` | Text fields (`density` prop). |
| `Checkbox`, `Switch`, `Slider` | Boolean and range controls. |
| `Segmented` | Single choice among a few options; `variant="nav"` is the view switcher. |
| `Select` | Dropdown single choice; `label` shows a muted name before the value ("Modell Opus"). |
| `Tabs` | Tab bar with optional counts. |
| `Row`, `SectionToggle` | Clickable list row, collapsible section header. |
| `FolderField` | Path field with folder picker. |
| `SectionHead` | Thin header strip of a pane section. |
| `Empty` | Empty state (icon, one sentence, optional action and hint). |
| `SettingsSection`, `SettingRow` | Settings layout: heading + framed rows, label/description left, control right. |
| `ConfirmDialog`, `PromptDialog`, `DiffDialog` | Standard dialogs. |
| `Dialog`, `Command` | Primitive namespaces (dialog, command palette). |
| `Badge` | Small status label. |
| `menuContent`, `menuItem`, `menuSeparator`, `menuShortcut` | Class strings for bits-ui ContextMenu/DropdownMenu. |
| `ContextItem` | One ContextMenu item (label, `destructive`). |
| `fileIcon`, `paneBar` | Helpers: icon per file name, pane header classes. |

## Type scale

Tokens in `src/app.css` (`@theme`), registered in `cn()` so tailwind-merge treats them as font sizes:

| Class | Size / line height | Use |
| --- | --- | --- |
| `text-meta` | 11px / 16px | Meta info, counts, timestamps, shortcut hints, section headings. |
| `text-ui` | 12px / 16px | Default for lists, buttons, fields. |
| `text-body` | 13px / 20px | Dialog text, project names, empty states. |
| `text-title` | 15px / 22px | Dialog and view titles. |

10px and smaller only in badges with a background.

## Guidelines

- **Header pattern:** every view/panel header is [title/context left] · [view actions right, icon + text] · [overflow ⋯]. The title bar is global only (navigation + window).
- **Icon + text:** icon-only only for ×, ↻, ⋯ (and ▷ in list rows), always via `IconButton` with `label` (tooltip). Peer buttons in one bar are either all labelled or none.
- **One primary per area:** at most one filled primary button per area. Destructive actions never right next to the primary; put them in a menu or keep distance and confirm.
- **Empty states:** always `Empty`, centered in the free area: one sentence, optionally one button (`action`) or a shortcut (`hint`).
- **Every function has a visible way:** context menus and keyboard shortcuts are only shortcuts to something that is also reachable by a visible control.

## Glossary (German UI text)

| Use | Not | Note |
| --- | --- | --- |
| Sitzung | Session | Everywhere in UI text, including tab labels and buttons ("+ Sitzung"). Identifiers in code may stay `session`. |
| Projekt | Repo | When it means the project the user works on. "Repository"/"Repo" only where the Git object itself is meant (e.g. "Neues Repo anlegen", remote URL). |
| CI | Actions, Pipelines | Tab label and headings. Provider names (GitHub Actions, GitLab CI) only in descriptions. |
