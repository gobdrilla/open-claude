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
