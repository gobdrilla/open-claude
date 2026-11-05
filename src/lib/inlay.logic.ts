// Pure helpers for LSP inlay hints (components/editor/inlay.svelte.ts).

export type InlayHint = {
  position: { line: number; character: number };
  label: string | { value: string }[];
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
};

/** Label parts are joined; their tooltips/locations are not used. */
export const inlayLabel = (label: InlayHint["label"]): string => (typeof label === "string" ? label : label.map((p) => p.value).join(""));

/** Hint kind 2 = parameter name: sits in front of the argument, so it stays left of text typed at its position. */
export const inlaySide = (h: InlayHint): number => (h.kind === 2 ? -1 : 1);

/**
 * initializationOptions per server key (SERVERS in src-tauri/src/lsp.rs) where inlay hints are opt-in.
 * rust-analyzer and clangd enable them by default.
 */
export const INIT_OPTIONS: Record<string, unknown> = {
  // Code Vision: usage and implementation counts; Run/Debug lenses would need commands this client does not run.
  rust: {
    lens: {
      enable: true,
      run: { enable: false },
      debug: { enable: false },
      implementations: { enable: true },
      references: { adt: { enable: true }, method: { enable: true }, trait: { enable: true } },
    },
  },
  typescript: {
    preferences: {
      includeInlayParameterNameHints: "literals",
      includeInlayParameterNameHintsWhenArgumentMatchesName: false,
      includeInlayVariableTypeHints: true,
      includeInlayVariableTypeHintsWhenTypeMatchesName: false,
      includeInlayFunctionLikeReturnTypeHints: false,
    },
  },
};

/**
 * INIT_OPTIONS plus, for typescript, typescript-svelte-plugin from the app's LSP folder (src-tauri/src/lsp.rs installs it
 * in Svelte projects): without it tsserver reads every .svelte import in a .ts file as default-only and reports
 * "Module '\"*.svelte\"' has no exported member". tsserver skips the plugin where it is missing.
 */
export const initOptions = (server: string, lspDir: string): unknown =>
  server === "typescript"
    ? { ...(INIT_OPTIONS.typescript as object), plugins: [{ name: "typescript-svelte-plugin", location: lspDir }] }
    : INIT_OPTIONS[server];

const TS_LENS = {
  referencesCodeLens: { enabled: true, showOnAllFunctions: true },
  implementationsCodeLens: { enabled: true, showOnInterfaceMethods: true },
};

/** workspace/didChangeConfiguration settings per server key, sent once after initialize: Code Vision is opt-in there. */
export const SETTINGS: Record<string, unknown> = {
  typescript: { typescript: TS_LENS, javascript: TS_LENS },
  svelte: { typescript: TS_LENS, javascript: TS_LENS },
};
