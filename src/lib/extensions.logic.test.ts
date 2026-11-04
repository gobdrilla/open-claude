import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_LINKS,
  MAX_TEXT,
  REQUIRED,
  checkValue,
  compileLinker,
  findLinks,
  parseManifest,
  resolve,
  segments,
  serial,
  type LinkDecl,
  type Linker,
  type SettingDecl,
} from "./extensions.logic.ts";

const base = {
  manifestVersion: 1,
  id: "tickets",
  name: "Tickets",
  version: "1.0.0",
  contributes: {
    settings: [
      { key: "url", type: "string", scope: "repo", format: "url-template", title: "URL" },
      { key: "pattern", type: "string", scope: "repo", format: "regex", title: "Muster", default: "\\b([A-Z][A-Z0-9_]+-[1-9][0-9]*)\\b" },
    ],
    linkProviders: [{ id: "ticket", title: "Ticket", pattern: "${config:pattern}", url: "${config:url}" }],
  },
};
const parse = (patch: (m: any) => void) => {
  const m = structuredClone(base) as any;
  patch(m);
  return parseManifest(JSON.stringify(m));
};
const err = (patch: (m: any) => void) => {
  const r = parse(patch);
  assert.ok("error" in r, JSON.stringify(r));
  return r.error;
};

test("parseManifest: gültiges Manifest", () => {
  const r = parseManifest(JSON.stringify(base));
  assert.ok("manifest" in r);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.manifest.contributes.settings[0].scope, "repo");
  assert.equal(r.manifest.contributes.linkProviders[0].id, "ticket");
  // contributes and scope are optional
  const m = parseManifest(JSON.stringify({ manifestVersion: 1, id: "a", name: "A", version: "0.1.0" }));
  assert.ok("manifest" in m);
  assert.deepEqual(m.manifest.contributes, { settings: [], linkProviders: [] });
});

test("parseManifest: Fehler", () => {
  assert.match((parseManifest("{kaputt") as { error: string }).error, /^Manifest ist kein gültiges JSON: /);
  assert.match((parseManifest("[]") as { error: string }).error, /^Manifest ungültig/);
  assert.match(err((m) => delete m.id), /Manifest ungültig: id/);
  for (const id of ["ABC", "a.b", "-x", "1a", ""]) assert.match(err((m) => (m.id = id)), /Manifest ungültig: id/, id);
  assert.equal(err((m) => (m.manifestVersion = 2)), "Benötigt eine neuere Version von L'Atelier");
  assert.match(err((m) => delete m.manifestVersion), /manifestVersion/);
  assert.equal(err((m) => (m.main = "dist/main.js")), "Erweiterungen mit Code werden noch nicht unterstützt");
  assert.equal(err((m) => (m.permissions = ["network:https://x"])), "Erweiterungen mit Code werden noch nicht unterstützt");
  assert.ok("manifest" in parse((m) => (m.permissions = [])));
  assert.match(err((m) => m.contributes.settings.push({ ...m.contributes.settings[0] })), /„url“ kommt doppelt vor/);
  assert.match(err((m) => (m.contributes.settings[0].key = "urlTemplate")), /settings\[0\]\.key/);
  assert.match(err((m) => m.contributes.settings.push({ key: "mode", type: "enum", title: "Modus" })), /enum muss/);
  assert.match(err((m) => (m.contributes.settings[0].default = true)), /default passt nicht/);
  assert.match(err((m) => m.contributes.settings.push({ key: "on", type: "boolean", title: "An", default: "ja" })), /default passt nicht/);
  assert.match(err((m) => (m.version = "1.0")), /version/);
  assert.match(err((m) => (m.name = 5)), /name muss ein Text sein/);
  assert.match(err((m) => (m.contributes.linkProviders = {})), /linkProviders muss eine Liste/);
});

test("parseManifest: Unbekanntes nur als Warnung", () => {
  const r = parse((m) => {
    m.contributes.commands = [];
    m.icon = "x.png";
  });
  assert.ok("manifest" in r);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join(), /contributes\.commands/);
  assert.match(r.warnings.join(), /icon/);
});

test("eingebaute Manifeste sind gültig, Pflichtfelder wie im Schema", () => {
  const dir = fileURLToPath(new URL("../extensions", import.meta.url));
  const schema = JSON.parse(readFileSync(join(dir, "manifest.schema.json"), "utf8"));
  assert.deepEqual([...schema.required].sort(), [...REQUIRED].sort());
  for (const k of REQUIRED) assert.match(err((m) => delete m[k]), /Manifest ungültig/, k);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const r = parseManifest(readFileSync(join(dir, e.name, "manifest.json"), "utf8"));
    assert.ok("manifest" in r, `${e.name}: ${JSON.stringify(r)}`);
    assert.deepEqual(r.warnings, [], e.name);
    assert.equal(r.manifest.id, e.name);
  }
});

const decls = (parseManifest(JSON.stringify(base)) as { manifest: { contributes: { settings: SettingDecl[] } } }).manifest.contributes.settings;
const flag: SettingDecl = { key: "on", type: "boolean", title: "An", scope: "repo", default: true };

test("resolve: Projekt > global > default", () => {
  const all = [...decls, flag];
  assert.deepEqual(resolve(all, {}, {}), { url: "", pattern: base.contributes.settings[1].default, on: true });
  assert.equal(resolve(all, { url: "https://g/$1" }, {}).url, "https://g/$1");
  assert.equal(resolve(all, { url: "https://g/$1" }, { url: "https://p/$1" }).url, "https://p/$1");
  assert.equal(resolve(all, { url: "https://g/$1" }, { url: "" }).url, "https://g/$1");
  assert.equal(resolve(all, {}, { on: "false" }).on, false);
  assert.equal(resolve(all, { on: false }, {}).on, false);
  // wrong type in the store is ignored
  assert.equal(resolve(all, { on: "nein", url: 5 as never }, {}).on, true);
  // scope global ignores project values
  assert.equal(resolve([{ ...flag, scope: "global" }], {}, { on: "false" }).on, true);
});

test("checkValue", () => {
  const [url, pattern] = decls;
  assert.match(checkValue(pattern, "([A-Z]")!, /Ungültiger regulärer Ausdruck/);
  assert.equal(checkValue(pattern, "#(\\d+)"), null);
  assert.ok(checkValue(url, "javascript:alert($1)"));
  assert.ok(checkValue(url, "firma.atlassian.net/browse/$1"));
  assert.ok(checkValue(url, "ftp://x/$1"));
  assert.equal(checkValue(url, "https://x/browse/$1"), null);
  assert.equal(checkValue(url, ""), null);
  const mode: SettingDecl = { key: "m", type: "enum", title: "M", scope: "global", enum: [["A", "a"]] };
  assert.equal(checkValue(mode, "a"), null);
  assert.ok(checkValue(mode, "b"));
});

const provider: LinkDecl = { id: "ticket", title: "Jira-Ticket", pattern: "${config:pattern}", prefixes: "${config:keys}", url: "${config:url}" };
const jira = (v: Record<string, string>) =>
  compileLinker(provider, { pattern: "\\b([A-Z][A-Z0-9_]+-[1-9][0-9]*)\\b", keys: "", url: "https://x.atlassian.net/browse/$1", ...v }) as Linker;
const ids = (text: string, ls: Linker[]) => findLinks(text, ls).map((l) => l.id);

test("compileLinker: leer = inaktiv, ungültig = Hinweis", () => {
  assert.equal(compileLinker(provider, { pattern: "", url: "https://x/$1" }), null);
  assert.equal(compileLinker(provider, { pattern: "x", url: "" }), null);
  assert.equal(compileLinker(provider, {}), null);
  assert.match(compileLinker(provider, { pattern: "(", url: "https://x/$1" }) as string, /^Jira-Ticket: Ungültiger regulärer Ausdruck/);
  assert.match(compileLinker(provider, { pattern: "x", url: "javascript:$1" }) as string, /http\(s\)/);
  assert.equal(typeof jira({}), "object");
});

test("findLinks: Treffer und URL", () => {
  const ls = [jira({})];
  const [l] = findLinks("fix: ABC-123 Login", ls);
  assert.deepEqual(l, { start: 5, end: 12, id: "ABC-123", url: "https://x.atlassian.net/browse/ABC-123", title: "Jira-Ticket" });
  assert.deepEqual(ids("UTF-8 und SHA-256 und ABC-0", ls), ["UTF-8", "SHA-256"]);
  assert.deepEqual(ids("ABC-1 UTF-8 XYZ-1 OPS-7 abc-2", [jira({ keys: "ABC, OPS" })]), ["ABC-1", "OPS-7"]);
});

test("findLinks: $0, %BUGID%, ohne Gruppe, Kodierung", () => {
  const mk = (pattern: string, url: string) => compileLinker(provider, { pattern, url }) as Linker;
  assert.equal(findLinks("see #42", [mk("#(\\d+)", "https://t/$0")])[0].url, "https://t/%2342");
  assert.equal(findLinks("see #42", [mk("#(\\d+)", "https://t/%BUGID%")])[0].url, "https://t/42");
  assert.equal(findLinks("see #42", [mk("#\\d+", "https://t/?q=$1")])[0].url, "https://t/?q=%2342");
  assert.equal(findLinks("bug a b!", [mk("bug ([a-z] [a-z])", "https://t/$1")])[0].url, "https://t/a%20b");
  // $2 without a second group is empty
  assert.equal(findLinks("#7", [mk("#(\\d)", "https://t/$1/$2")])[0].url, "https://t/7/");
});

test("findLinks: Überlappung, Länge 0, Grenzen", () => {
  const mk = (title: string, pattern: string) => compileLinker({ ...provider, title }, { pattern, url: "https://t/$1" }) as Linker;
  // same start: first registered wins; earlier start wins over the first provider
  const r = findLinks("ABC-12 x", [mk("A", "ABC-\\d+"), mk("B", "ABC-1")]);
  assert.deepEqual(r.map((l) => [l.title, l.id]), [["A", "ABC-12"]]);
  assert.deepEqual(findLinks("xABC-12", [mk("A", "ABC-\\d+"), mk("B", "xA")]).map((l) => l.title), ["B"]);
  assert.deepEqual(ids("aaa b a", [mk("A", "a*")]), ["aaa", "a"]);
  assert.equal(findLinks("ABC-1 ".repeat(1000), [jira({})]).length, MAX_LINKS);
  const long = "x".repeat(MAX_TEXT - 3) + " ABC-1";
  assert.equal(findLinks(long, [jira({})]).length, 0);
  assert.equal(findLinks("ABC-1 " + long, [jira({})]).length, 1);
});

test("segments: Rundlauf", () => {
  for (const t of ["", "ABC-1", "x ABC-1 y OPS-2", "ABC-1ABC-2", "nichts"]) {
    const s = segments(t, findLinks(t, [jira({})]));
    assert.equal(s.map((p) => p.text).join(""), t);
  }
  assert.deepEqual(segments("a ABC-1 b", findLinks("a ABC-1 b", [jira({})])), [
    { text: "a " },
    { text: "ABC-1", url: "https://x.atlassian.net/browse/ABC-1", title: "Jira-Ticket" },
    { text: " b" },
  ]);
});

test("serial: Schreibvorgänge nacheinander, Fehler blockiert nicht", async () => {
  const run = serial();
  const log: string[] = [];
  let busy = 0;
  const task = (name: string, ms: number, fail = false) => () =>
    new Promise<string>((ok, no) => {
      assert.equal(busy++, 0, `${name} startet, während ein anderer läuft`);
      log.push(`start ${name}`);
      setTimeout(() => {
        busy--;
        log.push(`end ${name}`);
        fail ? no(new Error(name)) : ok(name);
      }, ms);
    });
  const a = run(task("set", 20));
  const b = run(task("fail", 5, true));
  const c = run(task("unset", 1));
  assert.equal(await a, "set");
  await assert.rejects(b, /fail/);
  assert.equal(await c, "unset");
  assert.deepEqual(log, ["start set", "end set", "start fail", "end fail", "start unset", "end unset"]);
});
