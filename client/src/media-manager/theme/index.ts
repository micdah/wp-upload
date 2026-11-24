// Public API of the media manager's theme (track F3). F1 mounts
// MediaManagerThemeProvider at the root of the media-manager chunk.

export {
  COLOR_SCHEME_STORAGE_KEY,
  MediaManagerThemeProvider,
  type MediaManagerThemeProviderProps,
  mediaManagerColorSchemeManager,
} from './MediaManagerThemeProvider'
export { mediaManagerCssVariablesResolver } from './resolver'
export {
  darkPalette,
  grayPalette,
  mediaManagerTheme,
  neonPalette,
  variantColorResolver,
} from './theme'
export {
  cssVar,
  darkTokens,
  lightTokens,
  type SemanticToken,
  sharedTokens,
  type TokenName,
} from './tokens'
