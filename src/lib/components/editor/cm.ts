// CodeMirror-Zubehoer fuer CodePane: Thema aus den CSS-Variablen der App und Sprachwahl nach Dateiname.
import { EditorView } from "codemirror";
import { Compartment, RangeSet, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, GutterMarker, ViewPlugin, WidgetType, gutter, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  foldEffect,
  foldService,
  foldable,
  foldedRanges,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { foldsChanged } from "./setup.ts";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { languages } from "@codemirror/language-data";
import { styleTags, tags as t } from "@lezer/highlight";
import type { St } from "../../testing.logic.ts";
import { indentBlock, type GitMark } from "../../editor.logic.ts";
// tr: t is @lezer/highlight's tags here.
import { t as tr } from "../../i18n.ts";

const chrome = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--foreground)", backgroundColor: "var(--card)", fontSize: "13px" },
    // body hat user-select: none; ohne das laesst WebKit im Editor weder markieren noch tippen.
    ".cm-content": { caretColor: "var(--primary)", userSelect: "text", WebkitUserSelect: "text", padding: "8px 0" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--primary)" },
    // Fokussiert kraeftiger als unfokussiert
    ".cm-selectionBackground": { backgroundColor: "color-mix(in oklch, var(--primary) 20%, transparent)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "color-mix(in oklch, var(--primary) 30%, transparent)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--primary) 5%, transparent)" },
    ".cm-gutters": {
      backgroundColor: "var(--card)",
      color: "color-mix(in oklch, var(--muted-foreground) 55%, transparent)",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
    // Platz links fuer die Spalte der Faltpfeile (foldArrows).
    ".cm-line": { paddingLeft: "16px" },
    // Einrueckungslinien starten sonst bei 2px statt am Text (Bibliothek rechnet mit Standard-Padding).
    ".cm-line.cm-indent-markers::before": { left: "16px" },
    // Breite 0: der Pfeil verschiebt keinen Text, er ragt nur nach links in den Zeilenrand.
    ".cm-foldInline": {
      display: "inline-block",
      width: "0",
      textIndent: "-13px",
      whiteSpace: "nowrap",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      opacity: 0,
      transition: "opacity .15s",
    },
    // Wie Rider: alle Pfeile sichtbar, solange die Maus im Editor ist.
    "&:hover .cm-foldInline": { opacity: 1 },
    // Eingeklappt immer sichtbar, sonst findet man den Weg zurueck nicht.
    ".cm-foldInline.cm-folded": { opacity: 1 },
    ".cm-foldInline:hover": { color: "var(--foreground)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--muted)", border: "none", color: "var(--muted-foreground)" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--primary) 18%, transparent)" },
    ".cm-searchMatch": { backgroundColor: "oklch(0.8 0.13 85 / 0.3)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "oklch(0.8 0.13 85 / 0.55)" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "color-mix(in oklch, var(--primary) 12%, transparent)",
      outline: "1px solid color-mix(in oklch, var(--primary) 45%, transparent)",
    },
    // CM's own z-index 300 put the breadcrumb bar above dialogs (z-50); the panels sit outside the scroller anyway.
    ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)", zIndex: 1 },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid color-mix(in oklch, var(--border) 60%, transparent)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid color-mix(in oklch, var(--border) 60%, transparent)" },
    ".cm-textfield": { backgroundColor: "var(--background)", border: "1px solid var(--input)", borderRadius: "6px" },
    ".cm-button": {
      backgroundImage: "none",
      backgroundColor: "var(--secondary)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid color-mix(in oklch, var(--foreground) 10%, transparent)",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)",
      overflow: "hidden",
    },
    // Fixed width: shrink-to-fit made it depend on where the tooltip stood, so every re-measure moved it.
    ".cm-tooltip.cm-tooltip-hover": { width: "max-content", maxWidth: "min(44rem, calc(100vw - 2rem))" },
    ".cm-lsp-hover-tooltip pre": { whiteSpace: "pre-wrap" },
    ".cm-ghost": { color: "var(--muted-foreground)", opacity: "0.7", whiteSpace: "pre" },
    ".cm-lsp-actions": { margin: 0, padding: "4px", listStyle: "none", maxHeight: "16rem", overflowY: "auto", fontSize: "12px" },
    ".cm-lsp-actions > li": { padding: "3px 8px", borderRadius: "4px", cursor: "pointer", whiteSpace: "nowrap" },
    ".cm-lsp-actions > li[aria-selected], .cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  },
);

// Spezifischere Tags gewinnen (definition(...) vor variableName), die Reihenfolge ist egal.
const highlight = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: t.docComment, color: "var(--muted-foreground)" },
  { tag: [t.macroName, t.annotation, t.processingInstruction, t.meta], color: "var(--syn-meta)" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "var(--primary)" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "var(--primary)", fontStyle: "italic" },
  { tag: [t.string, t.special(t.string), t.attributeValue, t.monospace], color: "var(--syn-string)" },
  { tag: [t.regexp, t.escape], color: "var(--syn-regexp)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.color, t.unit], color: "var(--syn-number)" },
  { tag: [t.constant(t.variableName), t.self, t.special(t.variableName), t.labelName], color: "var(--syn-const)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: "var(--syn-type)" },
  { tag: [t.definition(t.typeName), t.definition(t.className)], color: "var(--syn-type)", fontWeight: "500" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syn-fn)" },
  { tag: t.function(t.definition(t.variableName)), color: "var(--syn-fn)", fontWeight: "500" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--foreground)", fontWeight: "500" },
  { tag: [t.propertyName, t.attributeName, t.tagName], color: "var(--syn-prop)" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "var(--muted-foreground)" },
  { tag: t.heading, color: "var(--primary)", fontWeight: "bold" },
  { tag: t.quote, color: "var(--muted-foreground)" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--syn-type)", textDecoration: "underline" },
  { tag: t.inserted, color: "var(--success)" },
  { tag: t.deleted, color: "var(--destructive)" },
  { tag: t.changed, color: "var(--warning)" },
  { tag: t.invalid, color: "var(--destructive)" },
]);

export const theme: Extension = [chrome, syntaxHighlighting(highlight)];

// Indent guides as in VS Code/JetBrains: one line per indent level, blank lines bridged, the block around the cursor
// brighter. Same colors for light and dark: the CSS variables already switch with the app theme.
const guide = "color-mix(in oklch, var(--foreground) 16%, transparent)";
const activeGuide = "color-mix(in oklch, var(--foreground) 40%, transparent)";
export const indentGuides: Extension = indentationMarkers({
  thickness: 1,
  colors: { light: guide, dark: guide, activeLight: activeGuide, activeDark: activeGuide },
});

/** Indent unit detected from the file (Tab key and guides); without a hint CodeMirror's default stays. */
export const indentOf = (unit: string | null): Extension => (unit ? indentUnit.of(unit) : []);

// Fold by indentation where the grammar has no fold for the line (YAML, Python-like text, template blocks in .svelte),
// as VS Code does.
let probing = false;
/** Fold services that only fill gaps return null while this runs. */
export const probingGrammar = () => probing;
/** The grammar's own fold for the line: foldable() with the gap-filling fold services (indent, LSP) silenced. */
export function grammarFold(state: EditorState, from: number, to: number) {
  probing = true;
  try {
    return foldable(state, from, to);
  } finally {
    probing = false;
  }
}
export const indentFolding: Extension = foldService.of((state, from, to) => {
  if (probing || grammarFold(state, from, to)) return null;
  const doc = state.doc;
  const n = doc.lineAt(from).number;
  const last = indentBlock((i) => doc.line(i).text, n, doc.lines, state.tabSize);
  return last ? { from: to, to: doc.line(last).to } : null;
});

// Faltpfeil wie in Rider: feste Spalte direkt links vom Code (Zeilenrand), nicht hinter den anderen Gutters.
// Eingeklappt bleibt der Pfeil (›) und klappt per Klick wieder auf.
class FoldArrow extends WidgetType {
  readonly from: number;
  readonly to: number;
  readonly shut: boolean;
  // Keine parameter properties: node --test (Strip-Only-TypeScript) kann sie nicht.
  constructor(from: number, to: number, shut: boolean) {
    super();
    this.from = from;
    this.to = to;
    this.shut = shut;
  }
  eq(o: FoldArrow) {
    return o.from === this.from && o.to === this.to && o.shut === this.shut;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = this.shut ? "cm-foldInline cm-folded" : "cm-foldInline";
    el.textContent = this.shut ? "›" : "⌄";
    el.title = tr(this.shut ? "Aufklappen" : "Zuklappen");
    el.onmousedown = (e) => {
      e.preventDefault();
      const range = { from: this.from, to: this.to };
      view.dispatch({ effects: (this.shut ? unfoldEffect : foldEffect).of(range) });
    };
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const arrows = (view: EditorView): DecorationSet => {
  const { state } = view;
  const folded = foldedRanges(state);
  const out = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      // Folded range first: foldable() may answer differently (or not at all) while the block is shut.
      let shut: { from: number; to: number } | null = null;
      folded.between(line.to, line.to, (a, b) => void (a === line.to && (shut = { from: a, to: b })));
      const r = shut ?? foldable(state, line.from, line.to);
      if (r) out.push(Decoration.widget({ widget: new FoldArrow(r.from, r.to, !!shut), side: -1 }).range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
};

export const foldArrows = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = arrows(view);
    }
    update(u: ViewUpdate) {
      const lsp = u.transactions.some((t) => t.effects.some((e) => e.is(foldsChanged)));
      if (lsp || u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || foldedRanges(u.startState) !== foldedRanges(u.state))
        this.decorations = arrows(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/** Language-Server-Anbindung (lsp.svelte.ts attach); leer ohne Freigabe oder Server. */
export const lspExt = new Compartment();
/** Platz fuer den Zeilenumbruch (Alt+Z), umgeschaltet per reconfigure. */
export const wrap = new Compartment();

/** Platz fuer die Sprache im EditorState; sie wird nachgeladen und dann per reconfigure eingesetzt. */
export const lang = new Compartment();

// Endungen, die language-data nicht kennt, auf eine verwandte Grammatik umgebogen. Ohne Eintrag bliebe die Datei
// einfarbiger Text - das betraf vor allem .svelte.
// ponytail: .svelte/.astro/.razor laufen als HTML (Script/Style-Bloecke stimmen, {#if}-Bloecke bleiben Text);
// @replit/codemirror-lang-svelte 6.0.0 (2022) erzeugt auf src/routes/+page.svelte Fehlerknoten, darum nicht eingebaut.
const ALIAS: [RegExp, string][] = [
  [/\.(svelte|astro|razor|cshtml)$/i, "a.html"],
  [/\.(xaml|axaml|csproj|fsproj|vbproj|props|targets|slnx|resx|config|manifest|nuspec|plist|storyboard|uxml)$/i, "a.xml"],
  [/\.(jsonc|json5|webmanifest|asmdef|asmref)$|^(composer|flake|bun)\.lock$/i, "a.json"],
  // Nur die Lockfiles, die wirklich TOML sind; yarn.lock und Gemfile.lock bleiben Text.
  [/^(cargo|poetry|uv)\.lock$|(^|\.)editorconfig$/i, "a.toml"],
  // Unity
  [/\.uss$/i, "a.css"],
  [/\.(meta|unity|prefab|asset)$/i, "a.yaml"],
];
// Grammatiken ausserhalb von language-data; sie gehen vor. C#: echter Baum statt clike (Folding, Einrueckung, Definitionen).
const extra = [
  LanguageDescription.of({
    name: "C#",
    extensions: ["cs"],
    // Attribute wie [Fact] als Meta faerben, wie #[test] in Rust (das Paket faerbt sie als Property).
    load: () =>
      import("@codincod/codemirror-lang-csharp").then(
        (m) =>
          new LanguageSupport(
            m.csharpLanguage.configure({ props: [styleTags({ "Attribute/TypeName Attribute/ScopedTypeName/TypeName": t.meta })] }),
            m.csharp().support,
          ),
      ),
  }),
];
const find = (name: string) => LanguageDescription.matchFilename(extra, name) ?? LanguageDescription.matchFilename(languages, name);

/** Sprache zum Dateinamen; die Grammatik kommt erst bei Bedarf als eigener Chunk. null = nur Text. */
export async function language(path: string): Promise<Extension | null> {
  const file = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const name = ALIAS.find(([re]) => re.test(file))?.[1] ?? file;
  // language-data vergleicht Endungen genau; Foo.CS oder README.MD (Windows) sonst ohne Grammatik.
  const desc = find(name) ?? find(name.replace(/\.[^.]+$/, (e) => e.toLowerCase()));
  return (await desc?.load()) ?? null;
}

// --- Test-Explorer: Marken an Testdefinitionen ---


class TestMarker extends GutterMarker {
  readonly id: string;
  readonly state: St;
  constructor(id: string, state: St) {
    super();
    this.id = id;
    this.state = state;
  }
  eq(o: TestMarker) {
    return o.id === this.id && o.state === this.state;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-test-${this.state}`;
    s.textContent = this.state === "passed" ? "✓" : this.state === "failed" ? "✗" : this.state === "running" || this.state === "queued" ? "◌" : "▶";
    s.title = this.state === "running" || this.state === "queued" ? tr("Läuft …") : this.state === "idle" ? tr("Test ausführen") : tr("Erneut ausführen");
    return s;
  }
}

/** Marken ersetzen (Zeilen 1-basiert); danach wandern sie mit den Aenderungen mit. */
export const setTestMarks = StateEffect.define<{ line: number; id: string; state: St }[]>();

const testMarks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setTestMarks)) continue;
      const doc = tr.state.doc;
      const ranges = e.value.filter((m) => m.line <= doc.lines).map((m) => new TestMarker(m.id, m.state).range(doc.line(m.line).from));
      set = RangeSet.of(ranges, true);
    }
    return set;
  },
});

/** ▶ at an entry point (script, Main, fn main): starts the run config with this label. */
class RunMarker extends GutterMarker {
  readonly label: string;
  readonly running: boolean;
  constructor(label: string, running: boolean) {
    super();
    this.label = label;
    this.running = running;
  }
  eq(o: RunMarker) {
    return o.label === this.label && o.running === this.running;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.running ? "cm-run-on" : "cm-test-idle";
    s.textContent = "▶";
    s.title = this.running ? tr("{name} läuft – Ausgabe zeigen", { name: this.label }) : tr("{name} starten", { name: this.label });
    return s;
  }
}

/** Run markers, replaced as a whole (lines 1-based); they move with edits. */
export const setRunMarks = StateEffect.define<{ line: number; label: string; running: boolean }[]>();

const runMarks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setRunMarks)) continue;
      const doc = tr.state.doc;
      set = RangeSet.of(e.value.filter((m) => m.line <= doc.lines).map((m) => new RunMarker(m.label, m.running).range(doc.line(m.line).from)), true);
    }
    return set;
  },
});

/** Gutter mit ▶/✓/✗ an Testdefinitionen (Klick: run(id)) und ▶ an Startpunkten (Klick: start(label)). */
export function testGutter(run: (id: string) => void, start: (label: string) => void): Extension {
  return [
    testMarks,
    runMarks,
    gutter({
      class: "cm-test-gutter",
      markers: (v) => [v.state.field(testMarks), v.state.field(runMarks)],
      domEventHandlers: {
        mousedown(view, line) {
          let id: string | null = null;
          let label: string | null = null;
          view.state.field(testMarks).between(line.from, line.from, (_a, _b, m) => void (id = (m as TestMarker).id));
          view.state.field(runMarks).between(line.from, line.from, (_a, _b, m) => void (label = (m as RunMarker).label));
          if (id !== null) run(id);
          else if (label !== null) start(label);
          else return false;
          return true;
        },
      },
    }),
    EditorView.theme({
      ".cm-test-gutter .cm-gutterElement": { cursor: "pointer", padding: "0 2px", fontSize: "11px" },
      ".cm-test-idle, .cm-test-queued, .cm-test-running": { color: "var(--muted-foreground)" },
      ".cm-test-skipped": { color: "var(--warning)" },
      ".cm-test-passed": { color: "var(--success)" },
      ".cm-test-failed": { color: "var(--destructive)" },
      ".cm-run-on": { color: "var(--success)" },
    }),
  ];
}

// --- Git-Gutter: Aenderungen gegenueber HEAD ---

export class GitMarker extends GutterMarker {
  readonly kind: GitMark["kind"];
  constructor(kind: GitMark["kind"]) {
    super();
    this.kind = kind;
  }
  eq(o: GitMarker) {
    return o.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-git-${this.kind}`;
    return s;
  }
}
const gitMarker = { add: new GitMarker("add"), mod: new GitMarker("mod"), del: new GitMarker("del") };

/** Marken ersetzen (Zeilen 1-basiert); bis zum naechsten Ersetzen wandern sie mit den Aenderungen mit. */
export const setGitMarks = StateEffect.define<GitMark[]>();

export const gitMarks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setGitMarks)) continue;
      const doc = tr.state.doc;
      set = RangeSet.of(e.value.filter((m) => m.line <= doc.lines).map((m) => gitMarker[m.kind].range(doc.line(m.line).from)), true);
    }
    return set;
  },
});

/** Schmaler Balken neben dem Text: neu gruen, geaendert gelb, darunter geloescht rot. A click on a mark calls show. */
export const gitGutter = (show: (view: EditorView) => void): Extension => [
  gitMarks,
  gutter({
    class: "cm-git-gutter",
    markers: (v) => v.state.field(gitMarks),
    domEventHandlers: {
      mousedown(view, line) {
        let hit = false;
        view.state.field(gitMarks).between(line.from, line.from, () => void (hit = true));
        if (hit) show(view);
        return hit;
      },
    },
  }),
  EditorView.theme({
    ".cm-git-gutter .cm-gutterElement": { width: "3px", padding: "0" },
    ".cm-git-gutter .cm-gutterElement:has(span)": { cursor: "pointer" },
    ".cm-git-add, .cm-git-mod, .cm-git-del": { display: "block", height: "100%" },
    ".cm-git-add": { backgroundColor: "var(--success)" },
    ".cm-git-mod": { backgroundColor: "var(--warning)" },
    ".cm-git-del": { boxShadow: "inset 0 -2px var(--destructive)" },
  }),
];
