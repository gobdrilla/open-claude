use super::*;

use crate::test_util::Tmp;

fn tmp(name: &str) -> Tmp {
    Tmp::new(&format!("skills-scan-{name}"))
}

fn put(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[test]
fn frontmatter_einfach_quotes_escapes() {
    assert_eq!(frontmatter("---\nname: a\ndescription: Tut was\n---\nbody"), (Some("a".into()), Some("Tut was".into())));
    assert_eq!(frontmatter("\u{feff}---\r\nname: b\r\ndescription: \"x: y\"\r\n---\r\n"), (Some("b".into()), Some("x: y".into())));
    assert_eq!(frontmatter("name: kein block"), (None, None));
    assert_eq!(frontmatter(""), (None, None));
    // Ohne schliessendes --- nicht crashen.
    assert_eq!(frontmatter("---\nname: c"), (Some("c".into()), None));
    // Leere description = None, nicht "".
    assert_eq!(frontmatter("---\nname: a\ndescription:\n---\n"), (Some("a".into()), None));
    assert_eq!(frontmatter("---\nname: a\ndescription: \"\"\n---\n"), (Some("a".into()), None));
    // Plain-Scalar ueber mehrere Zeilen.
    assert_eq!(frontmatter("---\ndescription:\n  eins\n  zwei\n---\n"), (None, Some("eins zwei".into())));
    // Doppelpunkt im Wert, Einzel-Quotes, CRLF mit >-.
    assert_eq!(frontmatter("---\ndescription: Use when: x\n---\n").1.as_deref(), Some("Use when: x"));
    assert_eq!(frontmatter("---\nname: 'q'\n---\n").0.as_deref(), Some("q"));
    assert_eq!(frontmatter("---\r\ndescription: >-\r\n  a\r\n  b\r\n---\r\n").1.as_deref(), Some("a b"));
    // Nur ein Quote ist kein Quoting.
    assert_eq!(frontmatter("---\nname: \"halb\n---\n").0.as_deref(), Some("\"halb"));
    // YAML: '' in Einzel-Quotes ist ein ', \" in Doppel-Quotes ein ".
    assert_eq!(frontmatter("---\ndescription: 'it''s'\n---\n").1.as_deref(), Some("it's"));
    assert_eq!(frontmatter("---\ndescription: \"sag \\\"hi\\\"\"\n---\n").1.as_deref(), Some("sag \"hi\""));
}

#[test]
fn frontmatter_mehrzeilig() {
    let t = "---\nname: a\ndescription: >\n  Zeile eins\n  Zeile zwei\nother: x\n---\n";
    assert_eq!(frontmatter(t), (Some("a".into()), Some("Zeile eins Zeile zwei".into())));
    let t = "---\ndescription: |-\n  erste\n\n  zweite\nname: z\n---\n";
    assert_eq!(frontmatter(t), (Some("z".into()), Some("erste zweite".into())));
    // Folgezeilen fremder Keys landen nicht in description.
    let t = "---\ndescription: d\nmeta:\n  name: falsch\n---\n";
    assert_eq!(frontmatter(t), (None, Some("d".into())));
}

#[test]
fn listet_user_projekt_plugin() {
    let root = tmp("list");
    let (home, repo, plug) = (root.join("home"), root.join("repo"), root.join("plug"));
    put(&home.join(".claude/skills/eins/SKILL.md"), "---\nname: eins\ndescription: E\n---\n");
    // Ohne Frontmatter: Ordnername.
    put(&home.join(".claude/skills/ordner/SKILL.md"), "nur text");
    std::fs::create_dir_all(home.join(".claude/skills/leer")).unwrap();
    put(&repo.join(".claude/skills/proj/SKILL.md"), "---\nname: proj\n---\n");
    put(&plug.join("skills/tool/SKILL.md"), "---\nname: tool\ndescription: T\n---\n");
    let installed = serde_json::json!({ "version": 2, "plugins": {
        "cav@market": [{ "installPath": plug }],
        "aus@x": [{ "installPath": root.join("fehlt") }],
    }});
    put(&home.join(".claude/plugins/installed_plugins.json"), &installed.to_string());
    put(
        &home.join(".claude/settings.json"),
        r#"{"skillOverrides":{"eins":"off","x":"quatsch"},"enabledPlugins":{"cav@market":true,"aus@x":true}}"#,
    );
    put(&repo.join(".claude/settings.json"), r#"{"enabledPlugins":{"aus@x":false}}"#);

    let info = list(&home, &repo);
    let keys: Vec<_> = info.skills.iter().map(|s| (s.key.as_str(), s.source)).collect();
    assert_eq!(keys, [("eins", "user"), ("ordner", "user"), ("proj", "project"), ("cav:tool", "plugin")]);
    let tool = &info.skills[3];
    assert_eq!((tool.name.as_str(), tool.description.as_str(), tool.plugin.as_deref()), ("tool", "T", Some("cav@market")));
    assert_eq!(info.plugins, ["aus@x", "cav@market"]);
    // Unbekannte Werte fallen raus.
    assert_eq!(info.user.skill_overrides, BTreeMap::from([("eins".into(), "off".into())]));
    assert!(info.team.skill_overrides.is_empty());
}

#[test]
fn fehlendes_und_kaputtes_ist_leer() {
    let root = tmp("empty");
    put(&root.join(".claude/settings.json"), "{kaputt");
    put(&root.join(".claude/plugins/installed_plugins.json"), "[]");
    let info = list(&root, &root.join("gibtsnicht"));
    assert!(info.skills.is_empty() && info.plugins.is_empty());
    assert_eq!(info.user, Settings::default());
    // Serialisiert exakt nach Vertrag (camelCase, plugin nur bei Plugin-Skills).
    let v = serde_json::to_value(&info).unwrap();
    assert_eq!(v, serde_json::json!({
        "skills": [], "plugins": [],
        "user": { "skillOverrides": {}, "enabledPlugins": {} },
        "team": { "skillOverrides": {}, "enabledPlugins": {} },
    }));
}

#[test]
fn scan_symlink_dateien_und_fehlende_ordner() {
    let root = tmp("fs");
    let skills = root.join("home/.claude/skills");
    put(&root.join("extern/linked/SKILL.md"), "---\nname: linked\n---\n");
    put(&skills.join("echt/SKILL.md"), "---\nname: echt\n---\n");
    // Datei statt Ordner, Ordner ohne SKILL.md, SKILL.md als Ordner.
    put(&skills.join("lose.md"), "---\nname: lose\n---\n");
    put(&skills.join("ohne/README.md"), "x");
    std::fs::create_dir_all(skills.join("komisch/SKILL.md")).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("extern/linked"), skills.join("link")).unwrap();
        std::os::unix::fs::symlink(root.join("weg"), skills.join("kaputt")).unwrap();
    }
    let info = list(&root.join("home"), &root.join("repo-fehlt"));
    let keys: Vec<_> = info.skills.iter().map(|s| s.key.as_str()).collect();
    #[cfg(unix)]
    // Key = Ordnername (Symlink "link"), name bleibt "linked"
    assert_eq!(keys, ["echt", "link"]);
    #[cfg(not(unix))]
    assert_eq!(keys, ["echt"]);
    // Ganz ohne .claude: leer, kein Panic.
    assert!(list(&root.join("nix"), &root.join("nix")).skills.is_empty());
}

#[test]
fn nicht_utf8_crasht_nicht_und_bleibt_sichtbar() {
    let root = tmp("latin1");
    let skills = root.join(".claude/skills");
    put(&skills.join("ok/SKILL.md"), "---\nname: ok\n---\n");
    std::fs::create_dir_all(skills.join("latin")).unwrap();
    // "Gr\xfc\xdfe" in Latin-1.
    std::fs::write(skills.join("latin/SKILL.md"), b"---\nname: latin\ndescription: Gr\xfc\xdfe\n---\n").unwrap();
    std::fs::create_dir_all(root.join(".claude/plugins")).unwrap();
    std::fs::write(root.join(".claude/plugins/installed_plugins.json"), b"\xff\xfe{").unwrap();
    std::fs::write(root.join(".claude/settings.json"), b"\xff\xfe{").unwrap();
    let info = list(&root, &root.join("repo"));
    assert!(info.plugins.is_empty());
    // Claude Code liest die Datei trotzdem; in der App darf der Skill nicht verschwinden.
    let keys: Vec<_> = info.skills.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["latin", "ok"]);
}

#[test]
fn installed_plugins_varianten() {
    let root = tmp("plugins");
    let home = root.join("home");
    let (a1, a2, leer) = (root.join("a1"), root.join("a2"), root.join("leer"));
    put(&a1.join("skills/s1/SKILL.md"), "---\nname: s1\n---\n");
    put(&a2.join("skills/s2/SKILL.md"), "---\nname: s2\n---\n");
    std::fs::create_dir_all(&leer).unwrap();
    let installed = serde_json::json!({ "plugins": {
        "multi@m": [{ "installPath": a1 }, { "installPath": a2 }],
        "ohneskills@m": [{ "installPath": leer }],
        "nopath@m": [{}],
        "leerliste@m": [],
        "objekt@m": { "installPath": a2 },
        "ohneat": [{ "installPath": a2 }],
    }});
    put(&home.join(".claude/plugins/installed_plugins.json"), &installed.to_string());
    put(&home.join(".claude/settings.json"), r#"{"enabledPlugins":{"multi@m":true,"ohneskills@m":"ja"}}"#);
    let info = list(&home, &root.join("repo"));
    let keys: Vec<_> = info.skills.iter().map(|s| (s.key.as_str(), s.plugin.as_deref().unwrap())).collect();
    // Mehrere Installationen: nur die erste; ohne @ ist der ganze Key der Namensraum.
    assert_eq!(keys, [("multi:s1", "multi@m"), ("ohneat:s2", "ohneat")]);
    // Alle installierten Plugins erscheinen, auch ohne Skills; Nicht-Bool = nicht gesetzt.
    assert_eq!(info.plugins, ["leerliste@m", "multi@m", "nopath@m", "objekt@m", "ohneat", "ohneskills@m"]);
    assert!(!info.user.enabled_plugins.contains_key("ohneskills@m"));
}

#[test]
fn installed_plugins_fehlt_oder_kaputt() {
    for (i, text) in [None, Some("{kaputt"), Some("{\"plugins\":[1]}"), Some("{\"plugins\":null}"), Some("42")].iter().enumerate() {
        let root = tmp(&format!("inst{i}"));
        put(&root.join(".claude/skills/u/SKILL.md"), "---\nname: u\n---\n");
        if let Some(t) = text {
            put(&root.join(".claude/plugins/installed_plugins.json"), t);
        }
        let info = list(&root, &root.join("repo"));
        assert!(info.plugins.is_empty(), "{text:?}");
        assert_eq!(info.skills.len(), 1, "{text:?}");
    }
}

#[test]
fn settings_schichten_lesen() {
    let root = tmp("settings");
    let (home, repo) = (root.join("home"), root.join("repo"));
    let installed = serde_json::json!({ "plugins": { "p@m": [{ "installPath": root.join("p") }], "q@m": [{ "installPath": root.join("q") }] }});
    put(&home.join(".claude/plugins/installed_plugins.json"), &installed.to_string());
    put(&home.join(".claude/settings.json"), r#"{"enabledPlugins":{"p@m":false,"q@m":true},"skillOverrides":{"a":"name-only","b":"user-invocable-only","c":"on","d":1}}"#);
    // Team: kaputte Typen ignoriert, gueltige gewinnen gegenueber User.
    put(&repo.join(".claude/settings.json"), r#"{"enabledPlugins":{"p@m":true},"skillOverrides":["x"]}"#);
    let info = list(&home, &repo);
    assert_eq!(info.plugins, ["p@m", "q@m"]);
    assert_eq!(info.team.enabled_plugins, BTreeMap::from([("p@m".into(), true)]));
    assert_eq!(info.user.skill_overrides.len(), 3);
    assert!(!info.user.skill_overrides.contains_key("d"));
    assert!(info.team.skill_overrides.is_empty());
    // settings.json ist ein Array: leer statt Panic.
    put(&repo.join(".claude/settings.json"), "[]");
    assert_eq!(list(&home, &repo).team, Settings::default());
}

#[test]
fn mods_nur_mit_plugin_json() {
    let d = tmp("mods");
    put(&d.join("b/.claude-plugin/plugin.json"), r#"{"name":"usage","description":"Zeigt Usage"}"#);
    put(&d.join("a/.claude-plugin/plugin.json"), "kaputt");
    put(&d.join("c/readme.md"), "keine Mod");
    let m = mods(&d);
    let names: Vec<_> = m.iter().map(|m| (m.name.as_str(), m.description.as_str())).collect();
    assert_eq!(names, [("a", ""), ("usage", "Zeigt Usage")]);
    assert!(mods(&d.join("fehlt")).is_empty());
}
