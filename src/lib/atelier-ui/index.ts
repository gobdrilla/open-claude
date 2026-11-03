// Atelier UI: the single source of the app's controls; import only via "$lib/atelier-ui".
// scripts/check-ui.mjs (npm run check) rejects raw <button>/<input>/<select>/<textarea> outside this folder.
// primitives/ is shadcn-svelte base material (partly patched locally; never regenerate via the CLI).

// Primitives
export { Button, buttonVariants, type ButtonVariant, type ButtonSize } from "./primitives/button/index.js";
export { Input } from "./primitives/input/index.js";
export { Textarea } from "./primitives/textarea/index.js";
export { Badge } from "./primitives/badge/index.js";
export * as Dialog from "./primitives/dialog/index.js";
export * as Command from "./primitives/command/index.js";

// Buttons and fields
export { default as Row } from "./Row.svelte";
export { default as SectionToggle } from "./SectionToggle.svelte";
export { default as IconButton } from "./IconButton.svelte";
export { default as TextButton } from "./TextButton.svelte";
export { default as RefreshButton } from "./RefreshButton.svelte";
export { default as Checkbox } from "./Checkbox.svelte";
export { default as Slider } from "./Slider.svelte";
export { default as Switch } from "./Switch.svelte";
export { default as Segmented } from "./Segmented.svelte";
export { default as Select } from "./Select.svelte";
export { default as Tabs } from "./Tabs.svelte";
export { default as FolderField } from "./FolderField.svelte";

// Structure and dialogs
export { default as SectionHead } from "./SectionHead.svelte";
export { default as Empty } from "./Empty.svelte";
export { default as ConfirmDialog } from "./ConfirmDialog.svelte";
export { default as PromptDialog } from "./PromptDialog.svelte";
export { default as DiffDialog } from "./DiffDialog.svelte";

// Menus (bits-ui directly, with these classes) and helpers
export { menuContent, menuItem, menuSeparator } from "./menu";
export { default as ContextItem } from "./ContextItem.svelte";
export { fileIcon } from "./fileIcon";
export { paneBar } from "./pane";
