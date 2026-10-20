import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { resolveLevels, resolvePage, sourceHash, ROOT } from './lib/build.js';

/**
 * Drill-down `{ "$ref": "./levels/x.json" }` entries in imported .json payloads
 * (the gallery examples) are inlined at import time, as the CLI does. A ref is
 * relative to the file that contains it and must stay inside the project
 * (lib/build.js resolveLevels: no absolute paths, no `..` out, symlinks
 * resolved); one that cannot be loaded stays a `$ref` with `$error`, which the
 * validator reports. Referenced files are watched, so editing a level reloads.
 * Answer pages (the gallery's Q&A and chart pages) get their diagram blocks'
 * `src` files inlined the same way (lib/build.js resolvePage).
 */
function drillRefs() {
  return {
    name: 'yantra-drill-refs',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.json')) return null;
      const page = /"kind"\s*:\s*"page"/.test(code);
      if (!page && !code.includes('"$ref"')) return null;
      let payload;
      try {
        payload = JSON.parse(code);
      } catch {
        return null;
      }
      if (page && payload?.kind === 'page') {
        const dir = path.dirname(file);
        for (const b of Array.isArray(payload.blocks) ? payload.blocks : []) if (b?.type === 'diagram' && typeof b.src === 'string') this.addWatchFile(path.resolve(dir, b.src));
        return { code: JSON.stringify(resolvePage(payload, dir)), map: null };
      }
      if (!payload || typeof payload !== 'object' || payload.diagrams === undefined) return null;
      const resolved = resolveLevels(payload, path.dirname(file), { root: ROOT, onLoad: (f) => this.addWatchFile(f) });
      return { code: JSON.stringify(resolved), map: null };
    }
  };
}

/** After `vite build`, record which sources dist/ was built from (lib/build.js reuses a fresh build). */
function buildStamp() {
  let outDir = path.join(ROOT, 'dist');
  return {
    name: 'yantra-build-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (path.resolve(outDir) === path.join(ROOT, 'dist')) fs.writeFileSync(path.join(outDir, '.yantra-sources'), `${sourceHash()}\n`);
    }
  };
}

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
  plugins: [drillRefs(), buildStamp(), englishOnly],
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
