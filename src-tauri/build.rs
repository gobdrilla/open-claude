fn main() {
    let mut windows = tauri_build::WindowsAttributes::new();
    // MSVC: Manifest (Common Controls v6) per Linker in alle Binaries, auch ins Test-Binary. tauri-build bettet es nur
    // in die App ein; ohne bricht `cargo test` unter Windows mit STATUS_ENTRYPOINT_NOT_FOUND ab.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build fehlgeschlagen");
}
