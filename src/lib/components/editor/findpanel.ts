import { EditorState, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { getSearchQuery, searchPanelOpen } from "@codemirror/search";
import { countLabel, countMatches } from "$lib/findcount.logic";
import { LANG, t } from "$lib/i18n";

// German texts for the Strg+F panel and CodeMirror's own go-to-line dialog (Mod-Alt-g); English keeps CodeMirror's own.
const phrases = LANG !== "de" ? [] : EditorState.phrases.of({
  Find: "Suchen",
  Replace: "Ersetzen",
  next: "Nächster",
  previous: "Vorheriger",
  all: "Alle markieren",
  "match case": "Groß/klein",
  regexp: "Regex",
  "by word": "Ganzes Wort",
  replace: "Ersetzen",
  "replace all": "Alle ersetzen",
  close: "Schließen",
  "current match": "Aktueller Treffer",
  "on line": "in Zeile",
  "replaced $ matches": "$ Treffer ersetzt",
  "replaced match on line $": "Treffer in Zeile $ ersetzt",
  "Go to line": "Zu Zeile springen",
  go: "OK",
});

/** "3 von 12" next to the search field, recounted on query, document and selection changes. */
const count = ViewPlugin.fromClass(
  class {
    el = Object.assign(document.createElement("span"), { className: "cm-search-count" });
    timer = 0;
    constructor(view: EditorView) {
      if (searchPanelOpen(view.state)) this.schedule(view);
    }
    update(u: ViewUpdate) {
      if (searchPanelOpen(u.state) && (u.docChanged || u.selectionSet || !searchPanelOpen(u.startState) || getSearchQuery(u.state) !== getSearchQuery(u.startState))) this.schedule(u.view);
    }
    schedule(view: EditorView) {
      // The panel DOM exists only while it is open; the panel plugin creates it, Prec.lowest below runs this one after it.
      const field = view.dom.querySelector(".cm-search [main-field]");
      if (field && this.el.previousElementSibling !== field) field.after(this.el);
      // A count scans the whole document (~15 ms at 9000 lines): once typing pauses, not on every keystroke.
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        const q = getSearchQuery(view.state);
        const sel = view.state.selection.main;
        let label = "";
        if (q.search && !q.valid) label = t("Ungültiger Ausdruck");
        else if (q.search) {
          const c = countMatches(q.getCursor(view.state), sel);
          // Selected match past the cap: its number is unknown, but it is one ("? von 1000+").
          if (c.more && !c.index && countMatches(q.getCursor(view.state, sel.from), sel, 1).index) c.index = -1;
          label = countLabel(c);
        }
        this.el.textContent = label;
      }, 100);
    }
    destroy() {
      clearTimeout(this.timer);
      this.el.remove();
    }
  },
);

const look = EditorView.theme({
  // Fixed width so the buttons do not jump while counting; 80% like CodeMirror's labels.
  ".cm-search-count": { display: "inline-block", minWidth: "8em", marginRight: ".6em", fontSize: "80%", color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" },
  // Without a query there is nothing to count: no gap in narrow panes.
  ".cm-search-count:empty": { display: "none" },
  ".cm-search input[type=checkbox]": { accentColor: "var(--primary)" },
  // Room for the absolutely placed close button, so wrapped labels in narrow panes do not run under it.
  ".cm-panel.cm-search": { paddingRight: "1.75em" },
});

export const findPanel = [phrases, Prec.lowest(count), look];
