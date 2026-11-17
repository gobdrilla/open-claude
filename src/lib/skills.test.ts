import { test } from "node:test";
import assert from "node:assert/strict";
import {
  profileFor, resolve, localPayload, adjust, emptyProject, pkey, managed, renameProfile, touched, fromProject, profileOf, migrateNamespace, layers,
  type Layers, type SkillStore, type Settings,
} from "./skills.ts";

const none: Settings = { skillOverrides: {}, enabledPlugins: {} };

test("resolve: Projekt > Profil > Team > User > Default", () => {
  const l: Layers = {
    user: { skillOverrides: { a: "off", b: "off", c: "off", d: "name-only" }, enabledPlugins: { p: true } },
    team: { skillOverrides: { b: "on", c: "on" }, enabledPlugins: {} },
    profile: { overrides: { c: "off", e: "off" }, plugins: { p: false } },
    project: { overrides: { e: "on" }, plugins: {} },
  };
  assert.deepEqual(resolve("skill", "a", l), { value: "off", source: "user" });
  assert.deepEqual(resolve("skill", "b", l), { value: "on", source: "team" });
  assert.deepEqual(resolve("skill", "c", l), { value: "off", source: "profile" });
  assert.deepEqual(resolve("skill", "e", l), { value: "on", source: "project" });
  assert.deepEqual(resolve("skill", "x", l), { value: "on", source: "default" });
  assert.deepEqual(resolve("plugin", "p", l), { value: false, source: "profile" });
  assert.deepEqual(resolve("plugin", "q", l), { value: false, source: "default" });
});

test("localPayload: nichts zu schreiben ohne Profil/Projekt und ohne User+Team-Konflikt", () => {
  assert.deepEqual(localPayload({ user: none, team: none }), { skillOverrides: null, enabledPlugins: null });
  const user = { skillOverrides: { a: "off" as const }, enabledPlugins: { p: true } };
  assert.deepEqual(localPayload({ user, team: none, profile: null, project: emptyProject() }), {
    skillOverrides: null,
    enabledPlugins: null,
  });
});

test("localPayload: voll gemergt, 'on' faellt raus, {} ueberdeckt User", () => {
  const user = { skillOverrides: { a: "off" as const, b: "name-only" as const }, enabledPlugins: { p: true, q: true } };
  const team = { skillOverrides: { c: "off" as const }, enabledPlugins: {} };
  // User+Team ohne Profil: Claude nimmt sonst nur Teams Objekt
  assert.deepEqual(localPayload({ user, team }).skillOverrides, { a: "off", b: "name-only", c: "off" });
  const project = { overrides: { a: "on" as const }, plugins: { q: false } };
  assert.deepEqual(localPayload({ user, team, project }), {
    skillOverrides: { b: "name-only", c: "off" },
    enabledPlugins: { p: true, q: false },
  });
  const only = { skillOverrides: { a: "off" as const }, enabledPlugins: {} };
  assert.deepEqual(localPayload({ user: only, team: none, profile: { overrides: { a: "on" }, plugins: {} } }).skillOverrides, {});
});

test("pkey: Trenner, Schlusstrenner, Windows-Gross/Klein", () => {
  assert.equal(pkey("C:\\dev\\proj\\"), "c:/dev/proj");
  assert.equal(pkey("c:/Dev/Proj"), "c:/dev/proj");
  assert.equal(pkey("/Users/X/proj/"), "/Users/X/proj");
  assert.equal(pkey("/"), "/");
});

test("managed: nur mit Store-Eintrag oder wirksamem Profil", () => {
  const s = { profiles: { web: emptyProject() }, kindProfiles: { Tauri: "web" }, projects: { "c:/dev/a": emptyProject() } };
  assert.equal(managed(s, "C:\\dev\\a", null), true);
  assert.equal(managed(s, "/b", "Tauri"), true);
  assert.equal(managed(s, "/b", "Unity"), false);
  assert.equal(managed({ ...s, profiles: {} }, "/b", "Tauri"), false);
});

test("renameProfile: Verweise ziehen mit, loeschen faellt auf Typ zurueck", () => {
  const p = { overrides: { a: "off" as const }, plugins: {} };
  const s = {
    profiles: { web: p, game: p },
    kindProfiles: { Tauri: "web", Unity: "game" },
    projects: { "/a": { ...emptyProject(), profile: "web" }, "/b": { ...emptyProject(), profile: null } },
  };
  const r = renameProfile(s, "web", "app");
  assert.deepEqual(Object.keys(r.profiles).sort(), ["app", "game"]);
  assert.deepEqual(r.kindProfiles, { Tauri: "app", Unity: "game" });
  assert.equal(r.projects["/a"].profile, "app");
  assert.equal(r.projects["/b"].profile, null);
  const d = renameProfile(s, "web", null);
  assert.deepEqual(Object.keys(d.profiles), ["game"]);
  assert.deepEqual(d.kindProfiles, { Unity: "game" });
  assert.ok(!("profile" in d.projects["/a"]));
  assert.deepEqual(s.kindProfiles, { Tauri: "web", Unity: "game" });
});

test("touched: Profilinhalt, Zuordnung und Anpassung", () => {
  const repos = [{ path: "/a", kind: "Tauri" }, { path: "/b", kind: "Unity" }, { path: "/c" }];
  const a = { profiles: { web: { overrides: {}, plugins: {} } }, kindProfiles: { Tauri: "web" }, projects: {} };
  assert.deepEqual(touched(a, a, repos), []);
  const b = { ...a, profiles: { web: { overrides: { x: "off" as const }, plugins: {} } } };
  assert.deepEqual(touched(a, b, repos), ["/a"]);
  assert.deepEqual(touched(a, { ...a, kindProfiles: { Tauri: "web", Unity: "web" } }, repos), ["/b"]);
  assert.deepEqual(touched(a, { ...a, projects: { "/c": adjust(undefined, "skill", "x", "off") } }, repos), ["/c"]);
});

test("fromProject: Profil plus Projekt-Anpassung, geloeschtes Profil = keins", () => {
  const s = {
    profiles: { web: { overrides: { a: "off" as const, b: "off" as const }, plugins: { p: true } } },
    kindProfiles: { Tauri: "web" },
    projects: { "/a": adjust(undefined, "skill", "b", "on"), "/x": { ...emptyProject(), profile: "weg" } },
  };
  assert.deepEqual(fromProject(s, "/a", "Tauri"), { overrides: { a: "off", b: "on" }, plugins: { p: true } });
  assert.equal(profileOf(s, "/x", "Tauri"), null);
});

test("migrateNamespace: open-claude:* wird atelier:*, Rest bleibt", () => {
  const s = {
    profiles: { web: { overrides: { "open-claude:forge-pr": "off" as const, "caveman:caveman": "off" as const }, plugins: { "x@y": false } } },
    kindProfiles: { node: "web" },
    projects: {
      "/a": { overrides: { "open-claude:smart-tests": "on" as const }, plugins: {}, profile: null },
      "/b": { overrides: { mine: "off" as const }, plugins: {} },
    },
  };
  const m = migrateNamespace(s);
  assert.deepEqual(m.profiles.web, { overrides: { "atelier:forge-pr": "off", "caveman:caveman": "off" }, plugins: { "x@y": false } });
  assert.deepEqual(m.projects["/a"], { overrides: { "atelier:smart-tests": "on" }, plugins: {}, profile: null });
  assert.equal(m.projects["/b"], s.projects["/b"]);
  assert.deepEqual(m.kindProfiles, s.kindProfiles);
  assert.deepEqual(migrateNamespace(m), m);
});

// Profile store: explicit, by kind, none, deleted
const info = { user: none, team: none };
const web = { overrides: { a: "off" as const }, plugins: { "caveman@caveman": false } };

const store = (): SkillStore => ({
  profiles: { web, game: { overrides: {}, plugins: {} } },
  kindProfiles: { Tauri: "web" },
  projects: {
    "/typ": { overrides: {}, plugins: {} },
    "/explizit": { overrides: {}, plugins: {}, profile: "web" },
    "/keins": { overrides: {}, plugins: {}, profile: null },
    "/fremd": { overrides: {}, plugins: {}, profile: "game" },
  },
});
const repos = [
  { path: "/typ", kind: "Tauri" },
  { path: "/explizit", kind: "Unity" },
  { path: "/keins", kind: "Tauri" },
  { path: "/fremd", kind: "Tauri" },
  { path: "/neu", kind: "Tauri" }, // nie angefasst, kein Store-Eintrag
  { path: "/ohneTyp", kind: null },
];

const users = (s: SkillStore, name: string) => repos.filter((r) => profileOf(s, r.path, r.kind) === s.profiles[name]).map((r) => r.path);

test("Profilnutzer: explizit schlaegt Typ, null schliesst aus, kind null/undefined nie", () => {
  const s = store();
  assert.deepEqual(users(s, "web"), ["/typ", "/explizit", "/neu"]);
  assert.deepEqual(users(s, "game"), ["/fremd"]);
});

test("Typ ohne Zuordnung und leerer kind ergeben kein Profil", () => {
  const kp = { Tauri: "web" };
  assert.equal(profileFor(undefined, "Unity", kp), null);
  assert.equal(profileFor(undefined, "", kp), null);
  assert.equal(profileFor(undefined, undefined, kp), null);
  assert.equal(profileOf(store(), "/ohneTyp", null), null);
});

test("geloeschtes Profil, auf das Projekt oder Typ noch verweist, gilt als keins", () => {
  const s = store();
  delete s.profiles.web; // Verweise bleiben stehen (z.B. alter Store)
  assert.equal(profileOf(s, "/explizit", "Unity"), null);
  assert.equal(profileOf(s, "/typ", "Tauri"), null);
  assert.deepEqual(localPayload(layers(info, s, "/typ", "Tauri")), { skillOverrides: null, enabledPlugins: null });
  assert.deepEqual(fromProject(s, "/explizit", "Unity"), { overrides: {}, plugins: {} });
});

test("renameProfile loeschen: explizit -> nach Typ, Typ-Zuordnung weg, andere unberuehrt", () => {
  const s = renameProfile(store(), "web", null);
  assert.deepEqual(Object.keys(s.profiles), ["game"]);
  assert.deepEqual(s.kindProfiles, {});
  assert.equal("profile" in s.projects["/explizit"], false);
  assert.equal(s.projects["/keins"].profile, null);
  assert.equal(s.projects["/fremd"].profile, "game");
  for (const r of repos) assert.notEqual(profileFor(s.projects[r.path], r.kind, s.kindProfiles), "web");
});

test("renameProfile umbenennen: alle Nutzer folgen, per Typ nicht touched", () => {
  const a = store();
  const b = renameProfile(a, "web", "frontend");
  assert.deepEqual(users(b, "frontend"), ["/typ", "/explizit", "/neu"]);
  assert.equal("web" in b.profiles, false);
  assert.equal(b.profiles.frontend, web);
  // explizite Projekte aendern ihren Store-Eintrag -> einmal neu geschrieben (idempotent), Typ-Nutzer nicht
  assert.deepEqual(touched(a, b, repos), ["/explizit"]);
  // Umbenennen auf sich selbst ist No-op
  assert.deepEqual(renameProfile(a, "web", "web"), a);
});

test("touched nach Loeschen: nur Nutzer des Profils", () => {
  const a = store();
  assert.deepEqual(touched(a, renameProfile(a, "web", null), repos), ["/typ", "/explizit", "/neu"]);
});

test("touched: Profil-Aenderung trifft Nutzer, Projekt-Anpassung bleibt erhalten", () => {
  const a = store();
  a.projects["/typ"] = adjust(a.projects["/typ"], "skill", "a", "on");
  const b: SkillStore = { ...a, profiles: { ...a.profiles, web: { overrides: { a: "off", b: "off" }, plugins: {} } } };
  assert.deepEqual(touched(a, b, repos), ["/typ", "/explizit", "/neu"]);
  assert.equal(resolve("skill", "a", layers(info, b, "/typ", "Tauri")).source, "project");
  assert.equal(resolve("skill", "b", layers(info, b, "/typ", "Tauri")).source, "profile");
});

test("adjust behaelt profile-Modus (undefined bleibt nach Typ, null bleibt keins)", () => {
  const s = store();
  const t = adjust(s.projects["/typ"], "skill", "x", "off");
  assert.equal("profile" in t, false);
  assert.equal(profileFor(t, "Tauri", s.kindProfiles), "web");
  assert.equal(adjust(s.projects["/keins"], "plugin", "p@m", true).profile, null);
  assert.equal(adjust(undefined, "skill", "x").profile, undefined);
});

test("Plugin-Skill-Keys mit ':' und Plugin-IDs mit '@' werden unveraendert durchgereicht", () => {
  const user: Settings = { skillOverrides: { "caveman:caveman-commit": "name-only" }, enabledPlugins: { "caveman@caveman": true } };
  let project = adjust(undefined, "skill", "caveman:caveman", "off");
  project = adjust(project, "plugin", "caveman@caveman", false);
  const l = { user, team: none, profile: null, project };
  assert.deepEqual(resolve("skill", "caveman:caveman-commit", l), { value: "name-only", source: "user" });
  assert.deepEqual(resolve("skill", "caveman", l), { value: "on", source: "default" });
  assert.deepEqual(localPayload(l), {
    skillOverrides: { "caveman:caveman-commit": "name-only", "caveman:caveman": "off" },
    enabledPlugins: { "caveman@caveman": false },
  });
});

