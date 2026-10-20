import { defineConfig } from 'vite';

/**
 * The viewer bundle carries only the English interface strings: in `vite build`,
 * src/core/i18n.js gets an empty locale set, and `yantra build` embeds the tables a
 * payload needs (lib/build.js; registerStrings() adds them at load). The example
 * gallery chunk imports src/core/locales/ itself, so dist/ and `npm run dev` keep
 * every language.
 */
const englishOnly = {
  name: 'yantra-english-only',
  apply: 'build',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './locales/index.js' && importer && /[\\/]src[\\/]core[\\/]i18n\.js$/.test(importer)) return '\0yantra-locales';
    return null;
  },
  load(id) {
    return id === '\0yantra-locales' ? 'export const TABLES = {};' : null;
  }
};

export default defineConfig({
  plugins: [englishOnly],
  server: {
    port: 3000,
    open: true
  },
  build: {
    // One entry JS + one CSS file so `yantra build` can inline them into a single HTML.
    // The example gallery (dynamic import, used only without an embedded payload)
    // stays in a separate chunk that built files never load.
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: { manualChunks: undefined }
    }
  }
});
