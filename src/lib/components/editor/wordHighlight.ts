// Occurrences of the word at the cursor, as in VS Code. basicSetup already has highlightSelectionMatches(): its view
// plugin is one shared object, so CodeMirror keeps a single instance and this only switches the option on (the config
// facet ORs it). Viewport only and capped at 100 matches by CodeMirror, so huge files cost nothing extra.
import { EditorView } from "@codemirror/view";
import { highlightSelectionMatches } from "@codemirror/search";

export const wordHighlight = [
  highlightSelectionMatches({ highlightWordAroundCursor: true }),
  // The word under the cursor itself stays plain.
  EditorView.theme({
    ".cm-selectionMatch.cm-selectionMatch-main": {
      backgroundColor: "transparent",
    },
  }),
];
