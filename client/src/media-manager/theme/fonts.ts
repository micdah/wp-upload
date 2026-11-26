// Self-hosted Geist and Geist Mono (variable, upright only). Imported only by
// the theme provider, so the font CSS and files belong to the lazily loaded
// media-manager chunk and never to the entry chunk or the old upload page.
// Each subset is a separate woff2 behind a unicode-range, so a browser only
// downloads the subsets a page actually renders (normally just latin).
//
// The faces register as 'Geist Variable' and 'Geist Mono Variable'; the font
// stacks in tokens.ts name them first.
//
// Orbitron (600 only) is the wordmark's face (--font-brand). Self-hosting it
// here replaces the old page's Google Fonts request for the media manager;
// index.html's link goes with the old page in M5.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/orbitron/600.css'
