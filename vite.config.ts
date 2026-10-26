import { defineConfig } from 'vite';

/**
 * Shared base options. The actual extension build is orchestrated by
 * scripts/build.mjs, which invokes Vite's programmatic API once per
 * entry point (content script, service worker, popup) so every output
 * is a standalone, dependency-free bundle — as required by MV3.
 */
export default defineConfig({
  build: {
    target: 'chrome110',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
  },
});
