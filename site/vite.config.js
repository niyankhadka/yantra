/**
 * The Yantra website, https://yantra.nbk.com.np/ (GitHub Pages), as one Vite multi-page build:
 *   npm run dev:site     http://localhost:3001/ (playground at /playground/)
 *   npm run build:site   -> dist-pages/ (static files, no backend)
 *   npm run preview:site serve dist-pages/ at http://localhost:4174/
 *
 * Entries: playground/index.html (the playground, served at /playground/) and
 * site/src/site.js (the script and styles of every other page). The landing page, the
 * docs (rendered from docs/*.md and site/guides/*.md), 404.html, sitemap.xml and the
 * static files come from site/build/pages.js: the dev server renders them on request, the
 * build emits them next to the bundle. The site is served from the root of its domain.
 */
import path from 'node:path';
import { defineConfig } from 'vite';
import { ROOT } from '../lib/build.js';
import { themeCss } from '../src/core/theme.js';
import { inlineRefs, playgroundFiles } from './build/playground.js';

const SITE_ENTRY = path.join(ROOT, 'site', 'src', 'site.js');
const THEME_ID = 'virtual:yantra-theme.css';

/** The design tokens of src/core/theme.js as CSS (the same variables the viewer uses). */
function themeTokens() {
  return {
    name: 'yantra-site-theme',
    resolveId: (id) => (id === THEME_ID ? `\0${THEME_ID}` : null),
    load: (id) => (id === `\0${THEME_ID}` ? themeCss() : null)
  };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

/** Landing page, docs, 404 and static files: rendered on request in dev, emitted in the build. */
function sitePages() {
  // Loaded lazily so the config stays fast to load (pages.js reads the docs and examples)
  const pages = () => import('./build/pages.js');
  let statics = null;
  return {
    name: 'yantra-site-pages',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent((req.url || '/').split(/[?#]/)[0]);
        if (url.startsWith('/@') || url.startsWith('/playground/') || url.startsWith('/site/src/') || url.startsWith('/node_modules/') || url.startsWith('/src/')) return next();
        try {
          const mod = await pages();
          statics ||= mod.staticFiles();
          const files = await mod.siteFiles({ assets: { js: '/site/src/site.js', css: [] }, statics });
          let key = url.slice(1);
          if (key === '' || key.endsWith('/')) key += 'index.html';
          let body = files[key];
          let status = 200;
          if (body === undefined && !path.extname(key)) body = files[`${key}/index.html`];
          if (body === undefined) {
            body = files['404.html'];
            status = 404;
            key = '404.html';
          }
          const ext = path.extname(key);
          if (ext === '.html' && key !== 'demo/cloud-architecture.html') body = await server.transformIndexHtml(url, body);
          res.statusCode = status;
          res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
          res.end(body);
        } catch (err) {
          next(err);
        }
      });
    },
    async generateBundle(_, bundle) {
      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.facadeModuleId && path.resolve(c.facadeModuleId) === SITE_ENTRY);
      if (!entry) throw new Error('site entry chunk not found');
      const assets = { js: `/${entry.fileName}`, css: [...(entry.viteMetadata?.importedCss || [])].map((f) => `/${f}`) };
      const mod = await pages();
      for (const [fileName, source] of Object.entries(await mod.siteFiles({ assets }))) this.emitFile({ type: 'asset', fileName, source });
    }
  };
}

export default defineConfig({
  root: ROOT,
  base: '/',
  appType: 'mpa',
  publicDir: false,
  plugins: [inlineRefs(), playgroundFiles(), themeTokens(), sitePages()],
  server: { port: 3001, fs: { allow: [ROOT] } },
  preview: { port: 4174 },
  build: {
    // YANTRA_SITE_OUT builds elsewhere (tests/site.test.js builds into a temp folder)
    outDir: process.env.YANTRA_SITE_OUT ? path.resolve(process.env.YANTRA_SITE_OUT) : path.join(ROOT, 'dist-pages'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // The playground's core (validator, layout, every interface language) is one module graph by design
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        playground: path.join(ROOT, 'playground', 'index.html'),
        site: SITE_ENTRY
      }
    }
  }
});
