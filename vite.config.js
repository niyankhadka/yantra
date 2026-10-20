import { defineConfig } from 'vite';

export default defineConfig({
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
