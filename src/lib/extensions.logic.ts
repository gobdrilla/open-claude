// App extensions ("Erweiterungen") v1: declarative manifests (settings + link patterns), no extension code runs.
// Pure functions, tested with node --test. Runtime state: extensions.svelte.ts. Schema for authors: src/extensions/manifest.schema.json.

export const MANIFEST_VERSION = 1;
/** Required top-level fields; a test keeps them equal to "required" in manifest.schema.json. */
export const REQUIRED = ["manifestVersion", "id", "name", "version"];

export type SettingDecl = {
  key: string;
  type: "string" | "boolean" | "enum";
  title: string;
  description?: string;
  default?: string | boolean;
  enum?: [string, string][];
  placeholder?: string;
  format?: "url-template" | "regex";
  /** repo: global value, overridable per project (local git config ocui.ext.<id>.<key>). */
  scope: "global" | "repo";
};
export type LinkDecl = { id: string; title: string; pattern: string; prefixes?: string; url: string };
export type Manifest = {
  manifestVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  contributes: { settings: SettingDecl[]; linkProviders: LinkDecl[] };
};
export type Parsed = { manifest: Manifest; warnings: string[] } | { error: string };
export type Values = Record<string, string | boolean>;

// Git config variable names are case-insensitive and allow only alphanumerics and "-": lowercase kebab only.
const IDENT = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const TOP = new Set(["$schema", "manifestVersion", "id", "name", "version", "description", "author", "homepage", "contributes", "main", "permissions", "engines"]);
const CONTRIB = new Set(["settings", "linkProviders"]);
const SETTING = new Set(["key", "type", "title", "description", "default", "enum", "placeholder", "format", "scope"]);
const LINK = new Set(["id", "title", "pattern", "prefixes", "url"]);

class Invalid extends Error {}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function str(o: Record<string, unknown>, k: string, path: string, opt: { optional?: boolean; max?: number; re?: RegExp } = {}) {
  const v = o[k];
  if (v === undefined && opt.optional) return undefined;
  if (typeof v !== "string" || (!opt.optional && !v)) throw new Invalid(`${path}${k} muss ein Text sein`);
  if (opt.max && v.length > opt.max) throw new Invalid(`${path}${k} ist länger als ${opt.max} Zeichen`);
  if (opt.re && !opt.re.test(v)) throw new Invalid(`${path}${k} darf nur a–z, 0–9 und - enthalten und muss mit einem Buchstaben beginnen`);
  return v;
}
function unknown(o: Record<string, unknown>, known: Set<string>, path: string, warnings: string[]) {
  for (const k of Object.keys(o)) if (!known.has(k)) warnings.push(`Unbekanntes Feld ${path}${k} wird ignoriert`);
}
function list(o: Record<string, unknown>, k: string, path: string): Record<string, unknown>[] {
  const v = o[k] ?? [];
  if (!Array.isArray(v) || !v.every(isObj)) throw new Invalid(`${path}${k} muss eine Liste von Objekten sein`);
  return v;
}
function unique(items: { [k: string]: unknown }[], k: string, path: string) {
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it[k])) throw new Invalid(`${path}: ${k} „${it[k]}“ kommt doppelt vor`);
    seen.add(it[k]);
  }
}

function setting(o: Record<string, unknown>, path: string, warnings: string[]): SettingDecl {
  unknown(o, SETTING, path, warnings);
  const type = o.type;
  if (type !== "string" && type !== "boolean" && type !== "enum") throw new Invalid(`${path}type muss string, boolean oder enum sein`);
  const d: SettingDecl = { key: str(o, "key", path, { max: 64, re: IDENT })!, type, title: str(o, "title", path, { max: 80 })!, scope: "global" };
  d.description = str(o, "description", path, { optional: true, max: 300 });
  d.placeholder = str(o, "placeholder", path, { optional: true, max: 200 });
  if (o.scope !== undefined) {
    if (o.scope !== "global" && o.scope !== "repo") throw new Invalid(`${path}scope muss global oder repo sein`);
    d.scope = o.scope;
  }
  if (o.format !== undefined) {
    if (o.format !== "url-template" && o.format !== "regex") throw new Invalid(`${path}format muss url-template oder regex sein`);
    if (type !== "string") throw new Invalid(`${path}format gibt es nur bei type string`);
    d.format = o.format;
  }
  if (type === "enum") {
    const e = o.enum;
    if (!Array.isArray(e) || !e.length || !e.every((x) => Array.isArray(x) && x.length === 2 && x.every((s) => typeof s === "string")))
      throw new Invalid(`${path}enum muss eine Liste von [Bezeichnung, Wert] sein`);
    d.enum = e as [string, string][];
  }
  if (o.default !== undefined) {
    const ok = type === "boolean" ? typeof o.default === "boolean" : typeof o.default === "string" && (type === "string" || d.enum!.some(([, v]) => v === o.default));
    if (!ok) throw new Invalid(`${path}default passt nicht zu type ${type}`);
    d.default = o.default as string | boolean;
  }
  return d;
}

function link(o: Record<string, unknown>, path: string, warnings: string[]): LinkDecl {
  unknown(o, LINK, path, warnings);
  return {
    id: str(o, "id", path, { max: 64, re: IDENT })!,
    title: str(o, "title", path, { max: 80 })!,
    pattern: str(o, "pattern", path)!,
    prefixes: str(o, "prefixes", path, { optional: true }),
    url: str(o, "url", path)!,
  };
}

/** JSON.parse plus a hand-written check of the flat v1 schema; unknown fields only warn, so v1.x manifests stay usable. */
export function parseManifest(text: string): Parsed {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // User manifests are checked with position in Rust (ext_scan); the engine message would be English.
    return { error: "Manifest ist kein gültiges JSON" };
  }
  if (!isObj(raw)) return { error: "Manifest ungültig: kein JSON-Objekt" };
  const mv = raw.manifestVersion;
  if (typeof mv === "number" && mv > MANIFEST_VERSION) return { error: "Benötigt eine neuere Version von L'Atelier" };
  if (raw.main !== undefined || (Array.isArray(raw.permissions) ? raw.permissions.length : raw.permissions !== undefined))
    return { error: "Erweiterungen mit Code werden noch nicht unterstützt" };
  const warnings: string[] = [];
  try {
    if (mv !== MANIFEST_VERSION) throw new Invalid("manifestVersion muss 1 sein");
    unknown(raw, TOP, "", warnings);
    const c = raw.contributes ?? {};
    if (!isObj(c)) throw new Invalid("contributes muss ein Objekt sein");
    unknown(c, CONTRIB, "contributes.", warnings);
    const settings = list(c, "settings", "contributes.").map((s, i) => setting(s, `contributes.settings[${i}].`, warnings));
    const linkProviders = list(c, "linkProviders", "contributes.").map((l, i) => link(l, `contributes.linkProviders[${i}].`, warnings));
    unique(settings, "key", "contributes.settings");
    unique(linkProviders, "id", "contributes.linkProviders");
    const manifest: Manifest = {
      manifestVersion: 1,
      id: str(raw, "id", "", { max: 64, re: IDENT })!,
      name: str(raw, "name", "", { max: 60 })!,
      version: str(raw, "version", "")!,
      description: str(raw, "description", "", { optional: true, max: 200 }),
      author: str(raw, "author", "", { optional: true, max: 100 }),
      homepage: str(raw, "homepage", "", { optional: true, max: 300 }),
      contributes: { settings, linkProviders },
    };
    if (!SEMVER.test(manifest.version)) throw new Invalid("version muss eine Version wie 1.0.0 sein");
    return { manifest, warnings };
  } catch (e) {
    if (e instanceof Invalid) return { error: `Manifest ungültig: ${e.message}` };
    throw e;
  }
}

/** Project value > global value > default. An empty project value does not count; git config holds booleans as text. */
export function resolve(decls: SettingDecl[], global: Values, repo: Record<string, string>): Values {
  const out: Values = {};
  for (const d of decls) {
    const r = d.scope === "repo" ? repo[d.key] : undefined;
    const g = global[d.key];
    const typeOk = (v: unknown) => (d.type === "boolean" ? typeof v === "boolean" : typeof v === "string");
    if (r !== undefined && r !== "") out[d.key] = d.type === "boolean" ? r === "true" : r;
    else if (typeOk(g) && g !== "") out[d.key] = g;
    else out[d.key] = d.default ?? (d.type === "boolean" ? false : "");
  }
  return out;
}

const fill = (tpl: string, groups: (string | undefined)[], id: string) =>
  tpl.replace(/\$(\d)|%BUGID%/g, (_, n) => encodeURIComponent(n === undefined || n === "1" ? id : (groups[+n] ?? "")));
function httpUrl(s: string): string | null {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
// Engine messages are English and differ (WebKit "missing )", V8 "Unterminated group"); the common ones get a German hint.
const REGEX_HINTS: [RegExp, string][] = [
  [/missing \)|unterminated group/i, "„(“ ohne schließende „)“"],
  [/unmatched/i, "„)“ ohne öffnende „(“"],
  [/missing terminating \]|unterminated character class/i, "„[“ ohne schließende „]“"],
  [/nothing to repeat/i, "*, + oder ? ohne Zeichen davor"],
  [/\\ at end of pattern/i, "„\\“ am Ende"],
  [/out of order/i, "Bereich in falscher Reihenfolge, z. B. [z-a] oder {3,1}"],
];
const regexError = (v: string) => {
  try {
    new RegExp(v, "g");
    return null;
  } catch (e) {
    const hint = REGEX_HINTS.find(([re]) => re.test(String(e)))?.[1];
    return hint ? `Ungültiger regulärer Ausdruck: ${hint}` : "Ungültiger regulärer Ausdruck";
  }
};
const URL_ERROR = "Muss nach dem Einsetzen eine http(s)-Adresse ergeben, z. B. https://firma.atlassian.net/browse/$1";

/** Error text for an edited value, or null. Empty is always allowed (= not set). */
export function checkValue(d: SettingDecl, v: string): string | null {
  if (!v) return null;
  if (d.format === "regex") return regexError(v);
  if (d.format === "url-template") return httpUrl(fill(v, ["X-1", "X-1"], "X-1")) ? null : URL_ERROR;
  if (d.type === "enum" && !d.enum?.some(([, x]) => x === v)) return "Unbekannter Wert";
  return null;
}

export type Linker = { title: string; re: RegExp; prefixes: string[]; url: string };

/** null: inactive (pattern or url empty after ${config:…}); string: invalid pattern/url from the manifest. */
export function compileLinker(p: LinkDecl, v: Values): Linker | string | null {
  const sub = (s: string) => s.replace(/\$\{config:([a-z][a-z0-9-]*)\}/g, (_, k) => String(v[k] ?? "")).trim();
  const pattern = sub(p.pattern);
  const url = sub(p.url);
  if (!pattern || !url) return null;
  const bad = regexError(pattern) ?? (httpUrl(fill(url, ["X-1", "X-1"], "X-1")) ? null : URL_ERROR);
  if (bad) return `${p.title}: ${bad}`;
  const prefixes = sub(p.prefixes ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // shortcut: JS regex can backtrack (ReDoS) and only the input length is capped; patterns come only from own settings
  // or deliberately enabled manifests. Move matching to Rust's linear-time regex once patterns come from repos (.gitbugtraq) or a registry.
  return { title: p.title, re: new RegExp(pattern, "g"), prefixes, url };
}

/** Errors of providers broken by the manifest, each once: the settings tab keys its list by the text. */
export function linkerProblems(m: Manifest, v: Values): string[] {
  return [...new Set(m.contributes.linkProviders.map((p) => compileLinker(p, v)).filter((l) => typeof l === "string"))];
}

/** id: the matched key ($1, else $0), shown as "ABC-123 öffnen". */
export type Link = { start: number; end: number; id: string; url: string; title: string };
export const MAX_TEXT = 20_000;
export const MAX_LINKS = 200;

/** Matches of all linkers, without overlaps (earlier start wins, then the earlier linker). Scans at most MAX_TEXT chars. */
export function findLinks(text: string, linkers: Linker[]): Link[] {
  const s = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  const found: (Link & { n: number })[] = [];
  linkers.forEach((l, n) => {
    const re = l.re;
    re.lastIndex = 0;
    let hits = 0;
    for (let m = re.exec(s); m && hits < MAX_LINKS; m = re.exec(s)) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      const id = m[1] ?? m[0];
      if (l.prefixes.length && !l.prefixes.some((p) => id.toLowerCase().startsWith(p + "-"))) continue;
      const url = httpUrl(fill(l.url, m, id));
      if (!url) continue;
      found.push({ start: m.index, end: m.index + m[0].length, id, url, title: l.title, n });
      hits++;
    }
  });
  found.sort((a, b) => a.start - b.start || a.n - b.n);
  const out: Link[] = [];
  let end = 0;
  for (const { n: _, ...f } of found) {
    if (f.start < end) continue;
    out.push(f);
    end = f.end;
    if (out.length === MAX_LINKS) break;
  }
  return out;
}

/** Runs async tasks one after another, in call order; a failed task does not block the next.
 *  Two git config writes at once fail on .git/config.lock (Enter plus change, or blur plus "Global verwenden"). */
export function serial() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const p = last.then(task);
    last = p.catch(() => {});
    return p;
  };
}

/** Text split into plain and linked parts; concatenated it is the input again. */
export function segments(text: string, links: Link[]): { text: string; url?: string; title?: string }[] {
  const out: { text: string; url?: string; title?: string }[] = [];
  let at = 0;
  for (const l of links) {
    if (l.start > at) out.push({ text: text.slice(at, l.start) });
    out.push({ text: text.slice(l.start, l.end), url: l.url, title: l.title });
    at = l.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
