import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";

// Ctrl+G (Strg+G on Windows/Linux, Control+G on the Mac) is go-to-line, opened by EditorView's window handler.
// Swallowed here so CodeMirror's Mod-g findNext does not also run on Windows/Linux (F3 stays find next; Cmd+G on the Mac).
export const gotoLineKey = Prec.high(keymap.of([{ key: "Ctrl-g", run: () => true, scope: "editor search-panel" }]));
