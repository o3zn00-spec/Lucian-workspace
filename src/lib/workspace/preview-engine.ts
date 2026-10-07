// Live preview engine — takes a project's virtual file system and produces
// a single self-contained HTML document suitable for iframe srcDoc.
//
// Strategy by detected framework:
//  - html / static: resolve <link>, <script src>, and relative URL references
//    against the virtual FS, inlining assets where possible.
//  - react-jsx / react-tsx: load React + ReactDOM + Babel standalone from CDN,
//    transpile all .jsx/.tsx files in-browser, and bootstrap a root component.
//  - vue: load Vue 3 from CDN and bootstrap an inline Vue app.

import type { EnvVar, ProjectFile, PreviewMode } from "@/types/workspace";
import { getExtension } from "./filesystem";
import { buildMockBootstrap } from "./api-mocker";

interface PreviewOptions {
  files: ProjectFile[];
  framework: string;
  mode: PreviewMode;
  envVars: EnvVar[];
}

const REACT_CDN = "https://unpkg.com/react@18/umd/react.development.js";
const REACT_DOM_CDN = "https://unpkg.com/react-dom@18/umd/react-dom.development.js";
const BABEL_CDN = "https://unpkg.com/@babel/standalone/babel.min.js";
const VUE_CDN = "https://unpkg.com/vue@3/dist/vue.global.js";

/** Build a self-contained HTML string for the iframe. */
export function buildPreviewDoc(opts: PreviewOptions): string {
  const { files, framework, mode, envVars } = opts;
  const fileMap = new Map(files.map((f) => [f.path, f]));

  // Build the mock bootstrap once — it's the same for all framework types.
  const mockBootstrap = buildMockBootstrap({ mode, envVars });

  // Next.js projects: instead of showing an info card, we extract the page
  // component and render it as a React component. This won't handle SSR or
  // API routes, but it WILL show the UI — which is what the user wants.
  if (framework === "nextjs") {
    return buildReactPreview(files, fileMap, mode, envVars, true, mockBootstrap, true);
  }
  if (framework === "react-jsx" || framework === "react-tsx" || framework === "react-vite") {
    return buildReactPreview(files, fileMap, mode, envVars, framework === "react-tsx" || framework === "react-vite", mockBootstrap, false);
  }
  if (framework === "vue") {
    return buildVuePreview(files, fileMap, mode, envVars, mockBootstrap);
  }
  // Default: HTML/static
  return buildHtmlPreview(files, fileMap, mode, envVars, mockBootstrap);
}

/** Next.js projects can't be fully executed in a browser iframe (they need
 *  SSR + a Node.js server). We explain this clearly and show the pages
 *  directory layout so the user understands what was detected. The mock
 *  bootstrap is still injected so that if/when real execution is added
 *  later, the two features work together. */
function buildNextjsPreview(
  _files: ProjectFile[],
  _fileMap: Map<string, ProjectFile>,
  mode: PreviewMode,
  _envVars: EnvVar[],
  _mockBootstrap: string,
): string {
  return wrapInfo(
    "Next.js project detected",
    `<p>This project uses Next.js, which requires a Node.js server with SSR (server-side rendering) and an API routes runtime. A browser-only iframe cannot execute those — this is a fundamental browser limitation, not a bug in DevWorkspace.</p>
     <p><strong>What you can do:</strong></p>
     <ul>
       <li>The React components in <code>app/</code> or <code>pages/</code> can be previewed by extracting them into a plain React project (JSX/TSX) and importing that instead.</li>
       <li>If the project is already deployed on Vercel, open the deployed URL directly in a new browser tab — DevWorkspace is not a Vercel replacement.</li>
       <li>For local Next.js development, run <code>npm run dev</code> in a terminal and visit <code>http://localhost:3000</code> in your browser.</li>
     </ul>
     <p>Current preview mode: <strong>${mode.toUpperCase()}</strong>. Switching to Demo or Fake mode will not change this — the limitation is structural.</p>
     <p style="margin-top:0.75rem;font-size:12px;color:#718096;">The API mocking layer is active and will intercept network calls if/when real execution is enabled in a future update.</p>`,
  );
}

// ---------------------------------------------------------------------------
// HTML / Static preview
// ---------------------------------------------------------------------------

function buildHtmlPreview(
  files: ProjectFile[],
  fileMap: Map<string, ProjectFile>,
  mode: PreviewMode,
  envVars: EnvVar[],
  mockBootstrap: string,
): string {
  const indexHtml =
    fileMap.get("index.html") ??
    fileMap.get("public/index.html") ??
    files.find((f) => f.path.endsWith("index.html"));

  if (!indexHtml) {
    return wrapNoPreview(
      "No index.html found",
      "This project does not contain an index.html file. Add one to see a live preview.",
    );
  }

  let html = indexHtml.content;

  // Inline <link rel="stylesheet" href="..."> for local CSS files.
  html = html.replace(
    /<link[^>]*href=["']([^"']+)["'][^>]*>/gi,
    (match, href: string) => {
      if (/^https?:\/\//i.test(href) || href.startsWith("//")) return match;
      const localPath = resolveLocalPath(href, files);
      const f = localPath ? fileMap.get(localPath) : undefined;
      if (f && !f.binary) {
        return `<style data-src="${href}">\n${f.content}\n</style>`;
      }
      return match;
    },
  );

  // Inline <script src="..."></script> for local JS files.
  html = html.replace(
    /<script[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (match, src: string) => {
      if (/^https?:\/\//i.test(src) || src.startsWith("//")) return match;
      const localPath = resolveLocalPath(src, files);
      const f = localPath ? fileMap.get(localPath) : undefined;
      if (f && !f.binary) {
        const isModule = /type=["']module["']/i.test(match);
        return `<script${isModule ? ' type="module"' : ""} data-src="${src}">\n${f.content}\n</script>`;
      }
      return match;
    },
  );

  // Inline <img src="..."> for local image files.
  html = html.replace(
    /(<img[^>]*\ssrc=["'])([^"']+)(["'][^>]*>)/gi,
    (match, prefix: string, src: string, suffix: string) => {
      if (/^https?:\/\//i.test(src) || src.startsWith("//") || src.startsWith("data:")) return match;
      const localPath = resolveLocalPath(src, files);
      const f = localPath ? fileMap.get(localPath) : undefined;
      if (f && f.binary) {
        return `${prefix}${f.content}${suffix}`;
      }
      return match;
    },
  );

  // Inline url(...) in inline <style> blocks (best effort).
  html = html.replace(
    /url\(["']?([^"')]+)["']?\)/gi,
    (match, url: string) => {
      if (/^(https?:|data:|\/\/|#)/i.test(url)) return match;
      const localPath = resolveLocalPath(url, files);
      const f = localPath ? fileMap.get(localPath) : undefined;
      if (f && f.binary) return `url(${f.content})`;
      return match;
    },
  );

  return injectEnvAndMode(html, mode, envVars, mockBootstrap);
}

// ---------------------------------------------------------------------------
// NPM package resolution via esm.sh + module mocking
// ---------------------------------------------------------------------------

/** Server-only modules that can't run in a browser. We mock them with
 *  empty/stub implementations so imports don't crash. */
const SERVER_ONLY_MODULES = new Set([
  "fs", "fs/promises", "path", "node:path", "os", "node:os",
  "crypto", "node:crypto", "stream", "node:stream", "buffer", "node:buffer",
  "url", "node:url", "util", "node:util", "querystring", "node:querystring",
  "net", "node:net", "tls", "node:tls", "http", "node:http", "https", "node:https",
  "zlib", "node:zlib", "child_process", "node:child_process",
  "worker_threads", "node:worker_threads", "perf_hooks", "node:perf_hooks",
  "express", "pg", "mysql", "mysql2", "mongodb", "redis", "ioredis",
  "bcryptjs", "jsonwebtoken", "nodemailer", "aws-sdk", "@aws-sdk/client-s3",
  "@aws-sdk/client-ses", "@neondatabase/serverless", "@vercel/blob",
  "@vercel/edge-config", "@upstash/redis", "@prisma/client",
]);

/** CSS/asset file extensions that should be mocked as empty objects. */
const ASSET_EXTENSIONS = new Set([
  "css", "scss", "sass", "less", "styl",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "webm", "mov", "avi", "wav", "ogg",
  "pdf", "zip", "csv",
]);

/** Check if a module name is a bare npm package (not a relative path or alias). */
function isBareModule(importPath: string): boolean {
  if (importPath.startsWith(".") || importPath.startsWith("/")) return false;
  // @/ and ~/ are aliases, not npm packages
  if (importPath.startsWith("@/") || importPath.startsWith("~/")) return false;
  // @scope/name is an npm package (e.g. @radix-ui/react-tooltip)
  // But @/ is an alias — handled above
  return true;
}

/** Check if a module is server-only and should be mocked. */
function isServerOnlyModule(importPath: string): boolean {
  // Strip node: prefix
  const normalized = importPath.replace(/^node:/, "");
  // Check exact match or subpath (e.g. "fs/promises" matches "fs")
  if (SERVER_ONLY_MODULES.has(normalized)) return true;
  const base = normalized.split("/")[0];
  if (SERVER_ONLY_MODULES.has(base)) return true;
  return false;
}

/** Check if a module is a CSS/asset file import. */
function isAssetImport(importPath: string): boolean {
  const ext = importPath.split(".").pop()?.toLowerCase() ?? "";
  return ASSET_EXTENSIONS.has(ext);
}

/** Check if a module is Next.js-specific and should be mocked. */
function isNextjsModule(importPath: string): boolean {
  return importPath === "next" ||
    importPath.startsWith("next/") ||
    importPath.startsWith("next-auth") ||
    importPath === "next-themes" ||
    importPath.startsWith("next-themes/");
}

/** Packages that are dev-only or server-only and should NOT be loaded from esm.sh. */
const SKIP_ESM_PACKAGES = new Set([
  "vite", "@vitejs/plugin-react", "@tailwindcss/vite", "@vercel/node",
  "webpack", "rollup", "esbuild", "typescript", "@types/node",
  "eslint", "prettier", "postcss", "autoprefixer",
  "tailwindcss", // Tailwind is a build tool, not a runtime package
  "prisma", "@prisma/client", // Prisma needs a database connection
  "sharp", // Image processing, Node.js only
  "wouter", "react-router-dom", // Routers that need URL access — mocked instead
]);

/** Extract all bare module imports from source files.
 *  Returns a list of unique package names that need to be loaded from esm.sh. */
function extractNpmPackages(files: ProjectFile[]): string[] {
  const packages = new Set<string>();
  const importRe = /(?:import\s+.*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

  for (const f of files) {
    if (f.binary) continue;
    if (["jsx", "tsx", "js", "ts"].includes(getExtension(f.path))) {
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(f.content)) !== null) {
        const imp = m[1];
        if (!isBareModule(imp)) continue;
        if (imp === "react" || imp === "react-dom" || imp === "react-dom/client") continue;
        if (isServerOnlyModule(imp)) continue;
        if (isNextjsModule(imp)) continue;
        if (isAssetImport(imp)) continue;
        // Extract the package name (handle @scope/name and name/subpath)
        let pkgName: string;
        if (imp.startsWith("@")) {
          const parts = imp.split("/");
          pkgName = parts.slice(0, 2).join("/");
        } else {
          pkgName = imp.split("/")[0];
        }
        // Skip dev-only / server-only packages.
        if (SKIP_ESM_PACKAGES.has(pkgName)) continue;
        packages.add(pkgName);
      }
    }
  }
  return Array.from(packages).sort();
}

/** Generate the preload script that loads npm packages from esm.sh.
 *  Uses an import map so all packages share the same React instance. */
function generateNpmPreload(packages: string[]): string {
  if (packages.length === 0) return "";

  // Generate import statements for each package.
  // esm.sh serves any npm package as an ES module.
  // The ?deps= parameter ensures React is shared (not bundled into each package).
  // The ?external=react,react-dom parameter tells esm.sh to NOT bundle React
  // and instead use the import map to resolve it.
  const imports = packages.map((pkg) =>
    `try { const mod = await import('https://esm.sh/${pkg}?external=react,react-dom'); __NPM_PACKAGES__['${pkg}'] = mod; } catch(e) { console.warn('Failed to load ${pkg}:', e.message); __NPM_PACKAGES__['${pkg}'] = {}; }`
  ).join("\n      ");

  return `
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@18.3.1",
        "react-dom": "https://esm.sh/react-dom@18.3.1",
        "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
        "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
        "scheduler": "https://esm.sh/scheduler@0.23.2"
      }
    }
  </script>
  <script type="module">
    window.__NPM_PACKAGES__ = {};
    window.__NPM_LOADED__ = false;
    (async () => {
      // Load React and ReactDOM first so they're available globally.
      try {
        const ReactMod = await import('react');
        const ReactDOMMod = await import('react-dom');
        window.React = ReactMod.default || ReactMod;
        window.ReactDOM = ReactDOMMod.default || ReactDOMMod;
      } catch(e) {
        console.error('Failed to load React from esm.sh:', e);
      }
      // Load all other npm packages in parallel.
      ${imports}
      window.__NPM_LOADED__ = true;
      window.dispatchEvent(new Event('__npm_loaded__'));
    })();
  </script>`;
}

/** Generate mock implementations for server-only and Next.js modules. */
function generateModuleMocks(): string {
  return `
  <script>
    window.__MODULE_MOCKS__ = {
      // --- Server-only modules ---
      'fs': { readFileSync: () => '', writeFileSync: () => {}, existsSync: () => false, readdirSync: () => [], mkdirSync: () => {}, readFile: () => Promise.resolve(''), writeFile: () => Promise.resolve(), readdir: () => Promise.resolve([]), stat: () => Promise.resolve({}), createReadStream: () => ({ pipe: () => {} }), promises: { readFile: () => Promise.resolve(''), writeFile: () => Promise.resolve(), readdir: () => Promise.resolve([]), stat: () => Promise.resolve({}) } },
      'fs/promises': { readFile: () => Promise.resolve(''), writeFile: () => Promise.resolve(), readdir: () => Promise.resolve([]), stat: () => Promise.resolve({}) },
      'path': { join: (...args) => args.join('/'), resolve: (...args) => args.join('/'), basename: (p) => p.split('/').pop(), dirname: (p) => p.split('/').slice(0,-1).join('/'), extname: (p) => { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i) : ''; }, normalize: (p) => p, relative: (a,b) => b, sep: '/' },
      'node:path': { join: (...args) => args.join('/'), resolve: (...args) => args.join('/'), basename: (p) => p.split('/').pop(), dirname: (p) => p.split('/').slice(0,-1).join('/'), extname: (p) => { const i = p.lastIndexOf('.'); return i >= 0 ? p.slice(i) : ''; }, normalize: (p) => p, relative: (a,b) => b, sep: '/' },
      'os': { platform: () => 'browser', hostname: () => 'localhost', tmpdir: () => '/tmp', homedir: () => '/', cpus: () => [], totalmem: () => 0, freemem: () => 0 },
      'node:os': { platform: () => 'browser', hostname: () => 'localhost', tmpdir: () => '/tmp', homedir: () => '/', cpus: () => [], totalmem: () => 0, freemem: () => 0 },
      'crypto': { randomBytes: (n) => new Uint8Array(n), createHash: (alg) => ({ update: function(d) { return this; }, digest: (enc) => 'mock_hash_' + Date.now() }), createHmac: () => ({ update: function() { return this; }, digest: () => 'mock_hmac' }), randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { const r = Math.random()*16|0; const v = c === 'x' ? r : (r&0x3|0x8); return v.toString(16); }) },
      'node:crypto': { randomBytes: (n) => new Uint8Array(n), createHash: () => ({ update: function() { return this; }, digest: () => 'mock_hash' }), randomUUID: () => 'mock-uuid-' + Date.now() },
      'stream': { Readable: function() { return { pipe: () => {} }; }, Writable: function() { return { write: () => {} }; }, Transform: function() { return {}; } },
      'buffer': { Buffer: { from: (data) => data, isBuffer: () => false, concat: (arr) => arr, alloc: (n) => new Uint8Array(n) } },
      'url': { parse: (u) => new URL(u), format: (u) => u.toString(), resolve: (base, rel) => new URL(rel, base).href },
      'node:url': { parse: (u) => new URL(u), format: (u) => u.toString(), resolve: (base, rel) => new URL(rel, base).href },
      'util': { inspect: (o) => String(o), promisify: (fn) => (...args) => Promise.resolve(fn(...args)), format: (...args) => args.join(' ') },
      'http': { get: () => {}, request: () => {}, createServer: () => ({ listen: () => {} }) },
      'https': { get: () => {}, request: () => {}, createServer: () => ({ listen: () => {} }) },
      'net': { createServer: () => ({ listen: () => {} }), connect: () => {} },
      'zlib': { gzipSync: (d) => d, gunzipSync: (d) => d, deflateSync: (d) => d, inflateSync: (d) => d },
      'child_process': { exec: () => {}, execSync: () => '', spawn: () => ({ on: () => {}, stdout: { on: () => {} } }) },
      'express': function() { return { get: () => this, post: () => this, use: () => this, listen: () => this }; },
      'pg': { Pool: function() { return { query: () => Promise.resolve({ rows: [] }), connect: () => Promise.resolve({ query: () => Promise.resolve({ rows: [] }) }) }; }, Client: function() { return { query: () => Promise.resolve({ rows: [] }), connect: () => Promise.resolve() }; } },
      'bcryptjs': { hash: (pw) => Promise.resolve('mock_hash_' + pw), compare: () => Promise.resolve(true), genSalt: () => Promise.resolve('mock_salt'), hashSync: (pw) => 'mock_hash_' + pw, compareSync: () => true },
      'jsonwebtoken': { sign: () => 'mock_jwt_token', verify: () => ({}), decode: () => ({}), sign: (payload) => 'mock_jwt_' + JSON.stringify(payload).length },
      'nodemailer': { createTransport: () => ({ sendMail: () => Promise.resolve({ messageId: 'mock' }) }) },
      '@neondatabase/serverless': { neon: () => async () => [], Pool: function() { return { query: () => Promise.resolve({ rows: [] }) }; } },
      '@vercel/blob': { put: () => Promise.resolve({ url: 'mock://blob' }), del: () => Promise.resolve(), list: () => Promise.resolve({ blobs: [] }), head: () => Promise.resolve() },
      '@prisma/client': { PrismaClient: function() { return {}; } },

      // --- Next.js modules ---
      'next': { default: function(props) { return null; } },
      'next/link': { default: function Link(props) { return React.createElement('a', Object.assign({}, props, { href: props.href || '#' }), props.children); } },
      'next/image': { default: function Image(props) { return React.createElement('img', Object.assign({}, props, { src: props.src || '' })); } },
      'next/font/google': new Proxy({}, { get: function() { return function() { return { className: '', variable: '' }; }; } }),
      'next/font': new Proxy({}, { get: function() { return function() { return { className: '', variable: '' }; }; } }),
      'next/navigation': { useRouter: function() { return { push: function(){}, replace: function(){}, back: function(){}, forward: function(){}, refresh: function(){}, prefetch: function(){}, pathname: '/', query: {} }; }, usePathname: function() { return '/'; }, useSearchParams: function() { return new URLSearchParams(); }, useSelectedLayoutSegment: function() { return null; }, redirect: function(){}, notFound: function(){} },
      'next/router': { useRouter: function() { return { push: function(){}, replace: function(){}, back: function(){}, pathname: '/', query: {} }; } },
      'next/server': { NextResponse: function(body, init) { this.body = body; this.status = init?.status || 200; this.json = function() { return Promise.resolve(body); }; }, NextRequest: function() {} },
      'next/headers': { cookies: function() { return { get: function() { return null; }, set: function() {} }; }, headers: function() { return { get: function() { return null; } }; } },
      'next/cookie': { cookies: function() { return { get: function() { return null; }, set: function() {} }; } },
      'next-themes': { useTheme: function() { return { theme: 'light', setTheme: function(){}, resolvedTheme: 'light', themes: ['light','dark'] }; }, ThemeProvider: function(props) { return props.children || null; } },
      'next-auth/react': { useSession: function() { return { data: { user: { name: 'Demo User', email: 'demo@example.com' } }, status: 'authenticated' }; }, signIn: function() { return Promise.resolve(); }, signOut: function() { return Promise.resolve(); }, SessionProvider: function(props) { return props.children || null; } },
      'next-auth': { default: function() { return {}; } },
      'next-auth/providers/credentials': { default: function() { return { id: 'credentials', name: 'Credentials' }; } },

      // --- Router libraries (mock to work in srcDoc iframe) ---
      'wouter': {
        Route: function(props) {
          // wouter's Route can take either:
          //   <Route path="/" component={Home} />  → render the component
          //   <Route path="/">{props => ...}</Route>  → render children as function
          // In srcDoc, we always match the first route.
          if (props.component) {
            return React.createElement(props.component, props.props || {});
          }
          if (typeof props.children === 'function') {
            return props.children({ path: '/', params: {} });
          }
          return props.children || null;
        },
        Switch: function(props) {
          // Render the first Route child — it always matches "/" in our mock.
          try {
            var children = React.Children.toArray(props.children);
            if (children.length > 0) {
              return children[0];
            }
          } catch(e) {}
          return null;
        },
        Link: function(props) { return React.createElement('a', Object.assign({}, props, { href: props.href || '#' }), props.children); },
        Redirect: function(props) { return null; },
        useLocation: function() { return ['/', function(){}]; },
        useRoute: function() { return [true, { path: '/' }]; },
        useParams: function() { return {}; },
        useRouter: function() { return { push: function(){}, replace: function(){}, back: function(){} }; },
        useSearch: function() { return ''; },
        useSearchParams: function() { return new URLSearchParams(); },
        matchRoute: function() { return { match: true, params: {} }; },
        __esModule: true,
      },
      'react-router-dom': {
        Routes: function(props) { return props.children || null; },
        Route: function(props) { return props.element || props.children || null; },
        Link: function(props) { return React.createElement('a', Object.assign({}, props, { href: props.to || '#' }), props.children); },
        Navigate: function(props) { return null; },
        useNavigate: function() { return function(){}; },
        useLocation: function() { return { pathname: '/', search: '', hash: '' }; },
        useParams: function() { return {}; },
        useSearchParams: function() { return [new URLSearchParams(), function(){}]; },
        Outlet: function() { return null; },
        BrowserRouter: function(props) { return props.children || null; },
        HashRouter: function(props) { return props.children || null; },
        __esModule: true,
      },
    };

    // Helper: check if a module path is mocked.
    window.__getMock = function(importPath) {
      // Try exact match.
      if (window.__MODULE_MOCKS__[importPath]) return window.__MODULE_MOCKS__[importPath];
      // Try with node: prefix stripped.
      var stripped = importPath.replace(/^node:/, '');
      if (window.__MODULE_MOCKS__[stripped]) return window.__MODULE_MOCKS__[stripped];
      // Try base module (e.g. "fs/promises" → "fs").
      var base = importPath.split('/')[0];
      if (window.__MODULE_MOCKS__[base]) return window.__MODULE_MOCKS__[base];
      return null;
    };
  </script>`;
}

// ---------------------------------------------------------------------------
// React (JSX / TSX) preview — handles React, Vite, AND Next.js projects
// ---------------------------------------------------------------------------

function buildReactPreview(
  files: ProjectFile[],
  fileMap: Map<string, ProjectFile>,
  mode: PreviewMode,
  envVars: EnvVar[],
  isTsx: boolean,
  mockBootstrap: string,
  isNextjs: boolean,
): string {
  const indexHtml =
    fileMap.get("index.html") ??
    fileMap.get("public/index.html") ??
    files.find((f) => f.path.endsWith("index.html"));

  // Extract only the body's static markup — we strip out user script tags
  // to avoid double-loading React/Babel and conflicting with our bootstrap.
  let bodyMarkup = '<div id="root"></div>';
  let headMarkup = "";
  if (indexHtml) {
    const bodyMatch = indexHtml.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      bodyMarkup = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "");
    }
    const headMatch = indexHtml.content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (headMatch) {
      headMarkup = headMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "");
    }
  }

  if (!/id=["']root["']/.test(bodyMarkup)) {
    bodyMarkup = `<div id="root"></div>${bodyMarkup}`;
  }

  // Collect all CSS files and inject them as <style> tags so the preview
  // has proper styling. This is especially important for Next.js projects
  // that use globals.css and Tailwind.
  const cssFiles = files.filter((f) => {
    const ext = getExtension(f.path);
    return ["css", "scss", "sass"].includes(ext) && !f.binary;
  });
  const cssStyles = cssFiles
    .map((f) => `<!-- ${f.path} -->\n<style data-src="${f.path}">\n${f.content}\n</style>`)
    .join("\n");
  headMarkup = headMarkup + "\n" + cssStyles;

  const sources = files.filter((f) => {
    const ext = getExtension(f.path);
    return ["jsx", "tsx", "js", "ts"].includes(ext);
  });

  // Find the entry file. For Next.js projects, look for app/page.tsx or
  // pages/index.tsx. For regular React, look for App.tsx/App.jsx.
  let entryFile: ProjectFile | undefined;
  if (isNextjs) {
    entryFile =
      fileMap.get("src/app/page.tsx") ??
      fileMap.get("src/app/page.jsx") ??
      fileMap.get("app/page.tsx") ??
      fileMap.get("app/page.jsx") ??
      fileMap.get("src/pages/index.tsx") ??
      fileMap.get("src/pages/index.jsx") ??
      fileMap.get("pages/index.tsx") ??
      fileMap.get("pages/index.jsx") ??
      sources.find((f) => /app\/page\.(jsx|tsx)$/i.test(f.path)) ??
      sources.find((f) => /pages\/index\.(jsx|tsx)$/i.test(f.path));
  } else {
    entryFile =
      fileMap.get("App.jsx") ??
      fileMap.get("App.tsx") ??
      fileMap.get("src/App.jsx") ??
      fileMap.get("src/App.tsx") ??
      sources.find((f) => /app\.(jsx|tsx)$/i.test(f.path));
  }

  if (!entryFile) {
    return wrapNoPreview(
      isNextjs ? "No Next.js page found" : "No React entry file found",
      isNextjs
        ? "Add a page.tsx or page.jsx in src/app/ (App Router) or pages/index.tsx (Pages Router) to enable the live preview."
        : "Add an App.jsx or App.tsx that exports a default React component to enable the live preview.",
    );
  }

  // Extract path aliases from vite.config.ts/js and tsconfig.json so we
  // can resolve @/, ~/, $lib/, etc. correctly for this specific project.
  const aliases = extractAllAliases(files);
  const aliasesJson = JSON.stringify(aliases);

  const moduleMap: Record<string, { code: string; isTsx: boolean; origPath: string }> = {};
  for (const f of sources) {
    const key = f.path.replace(/\.(jsx|tsx|js|ts)$/, "");
    // Resolve @/, ~/ aliases in import paths so Babel's require() calls
    // use paths that __resolvePath__ can find. Don't strip imports/exports —
    // let Babel's env preset (modules: commonjs) handle that natively.
    let resolvedCode = f.content;
    // Strip Next.js "use client" and "use server" directives — they're not
    // valid JavaScript and cause Babel to crash.
    resolvedCode = resolvedCode.replace(/^["']use client["'];?\s*\n?/m, "");
    resolvedCode = resolvedCode.replace(/^["']use server["'];?\s*\n?/m, "");
    // Strip "use strict" too (can cause issues in some contexts).
    resolvedCode = resolvedCode.replace(/^["']use strict["'];?\s*\n?/m, "");
    if (Object.keys(aliases).length > 0) {
      resolvedCode = resolvedCode.replace(
        /(from\s+['"])([@~$][^'"]*)(['"])/g,
        (_m: string, prefix: string, path: string, suffix: string) =>
          prefix + resolveAlias(path, aliases) + suffix,
      );
    }
    moduleMap[key] = {
      code: resolvedCode,
      isTsx: getExtension(f.path) === "tsx",
      // Keep the original file path (WITH extension) so the Babel source-
      // instrumentation plugin can write `data-lucian-source-file="src/Card.tsx"`
      // (not the extension-stripped "src/Card"). The inspector's
      // resolveSourceMapping() needs the full path to find the file in
      // the project's file list.
      origPath: f.path,
    };
  }

  // Always include the TypeScript preset — many projects use TS syntax
  // (type annotations, interfaces, etc.) even in .jsx files. We always
  // pass .tsx as the filename to Babel so the TypeScript preset activates.
  // Use modules: "commonjs" so Babel transforms ES module import/export
  // to require()/module.exports — our __require__ function handles resolution.
  const presets = [
    ["env", { modules: "commonjs" }],
    ["react", { runtime: "classic" }],
    ["typescript"],
  ];

  // Full standard plugin set for real-world TypeScript + React projects.
  // These cover the Stage 3+ proposals that Vite/Create-React-App/Next.js
  // enable by default. Without these, Babel rejects the syntax outright.
  //
  // IMPORTANT: Babel standalone uses different plugin names than @babel/core.
  // The "proposal-*" names were renamed to "transform-*" in Babel 7.18+.
  // The two that kept their "proposal-" prefix are decorators and
  // export-default-from. We list both variants and filter to only the ones
  // that actually exist in the current Babel standalone build, so the
  // preview doesn't crash if a plugin is renamed in a future Babel version.
  const pluginCandidates = [
    ["proposal-decorators", { version: "legacy" }],
    "transform-class-properties",
    "transform-class-static-block",
    "transform-private-property-in-object",
    "transform-private-methods",
    // These are already in the env preset, but we list them as fallbacks
    // in case env is configured with a target that doesn't include them.
    // They're safe to include — Babel deduplicates.
    "transform-optional-chaining",
    "transform-nullish-coalescing-operator",
    "transform-numeric-separator",
    "transform-logical-assignment-operators",
    "transform-object-rest-spread",
    "transform-async-generator-functions",
    "transform-export-namespace-from",
    "proposal-export-default-from",
    // Note: transform-dynamic-import is intentionally omitted — it requires
    // a modules transform which the env preset handles. Including it
    // separately causes a "depends on a modules transform" error.
    "transform-optional-catch-binding",
  ];

  // Phase 12 final integration pass: escape "</script>" inside JSON-encoded
  // source code so the iframe's HTML parser doesn't prematurely terminate
  // the outer <script> tag. Without this, a JSX file containing a literal
  // "</body>" or "</script>" string (e.g. Next.js layout.tsx with
  // `<html><body>{children}</body></html>`) breaks the preview.
  // We also escape "</body>" and "</html>" for the same reason.
  const escapeClosingTags = (s: string) =>
    s.replace(/<\/(script|body|html)>/gi, "<\\/$1>");
  const moduleMapJson = escapeClosingTags(JSON.stringify(moduleMap));
  const appPath = entryFile.path.replace(/\.(jsx|tsx|js|ts)$/, "");
  const presetsJson = JSON.stringify(presets);
  const pluginsJson = escapeClosingTags(JSON.stringify(pluginCandidates));

  // Extract all bare npm package imports and generate preload + mock code.
  const npmPackages = extractNpmPackages(files);
  const npmPreload = generateNpmPreload(npmPackages);
  const moduleMocks = generateModuleMocks();
  const hasNpmPackages = npmPackages.length > 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${headMarkup}
  ${mockBootstrap}
  ${moduleMocks}
</head>
<body>
  ${bodyMarkup}
  ${hasNpmPackages ? "" : `<script src="${REACT_CDN}" crossorigin="anonymous"></script>\n  <script src="${REACT_DOM_CDN}" crossorigin="anonymous"></script>`}
  <script src="${BABEL_CDN}" crossorigin="anonymous"></script>
  ${npmPreload}
  <script>
    // --- Preview bootstrap ---
    window.__PREVIEW_MODE__ = ${JSON.stringify(mode)};
    window.__ENV_VARS__ = ${JSON.stringify(envVars.reduce((acc, e) => ({ ...acc, [e.key]: e.value }), {}))};
    window.process = window.process || { env: window.__ENV_VARS__ };

    const __MODULES__ = ${moduleMapJson};
    const __CACHE__ = {};

    const __ALIASES__ = ${aliasesJson};
    const __FALLBACK_BASES__ = ['src', 'client/src', 'app/src', 'lib', 'client/lib'];

    const __BABEL_PRESETS__ = ${presetsJson};
    const __BABEL_PLUGINS__ = ${pluginsJson}.filter(function(p) {
      var name = Array.isArray(p) ? p[0] : p;
      return Babel.availablePlugins && Babel.availablePlugins[name] !== undefined;
    });

    function __transform__(code, filename, isTsx) {
      try {
        // Phase 12: source-injection plugin. Walks JSXOpeningElement nodes
        // and injects data-lucian-source-file + data-lucian-source-id
        // attributes based on the element's AST location. This lets the
        // visual editor map clicked DOM elements back to their exact
        // source JSX node — NOT via DOM-order heuristics.
        //
        // The source id is computed as el-{line}-{col}-{fileHash} to match
        // the computeSourceId() function in jsx-ast.ts. The fileHash is a
        // 4-char hex hash of the file path so ids are unique across files.
        var __sourcePlugin__ = function (_ref) {
          var types = _ref.types;
          function hashStr(s) {
            var h = 0;
            for (var i = 0; i < s.length; i++) {
              h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return ((h >>> 0).toString(16)).slice(-4).padStart(4, '0');
          }
          return {
            visitor: {
              JSXOpeningElement: function (path) {
                var node = path.node;
                if (!node.loc) return;
                var line = node.loc.start.line;
                var col = node.loc.start.column;
                var fileHash = hashStr(filename);
                var sourceId = 'el-' + line + '-' + col + '-' + fileHash;
                // Check if data-lucian-source-id is already present.
                var hasSourceId = false;
                for (var i = 0; i < node.attributes.length; i++) {
                  var attr = node.attributes[i];
                  if (attr.type === 'JSXAttribute' && attr.name.name === 'data-lucian-source-id') {
                    hasSourceId = true;
                    break;
                  }
                }
                if (!hasSourceId) {
                  node.attributes.push(
                    types.jsxAttribute(
                      types.jsxIdentifier('data-lucian-source-file'),
                      types.stringLiteral(filename)
                    )
                  );
                  node.attributes.push(
                    types.jsxAttribute(
                      types.jsxIdentifier('data-lucian-source-id'),
                      types.stringLiteral(sourceId)
                    )
                  );
                }
              }
            }
          };
        };
        return Babel.transform(code, {
          presets: __BABEL_PRESETS__,
          plugins: __BABEL_PLUGINS__.concat([__sourcePlugin__]),
          // Always use .tsx extension so the TypeScript preset activates
          // and strips type annotations from ALL files (even .jsx ones).
          // We strip any existing extension first and append .tsx — that
          // way "src/Card.tsx" stays "src/Card.tsx" (not "Card.tsx.tsx"),
          // and "App" (extension-stripped) becomes "App.tsx".
          filename: (filename.replace(/\.(jsx|tsx|js|ts)$/, '') || filename) + '.tsx',
        }).code;
      } catch (err) {
        var feature = 'unknown syntax';
        var msg = (err && err.message) || String(err);
        var featureMatch = msg.match(/syntax '([^']+)'/);
        if (featureMatch) {
          feature = featureMatch[1];
        } else {
          var tokenMatch = msg.match(/Unexpected token '([^']+)'/);
          if (tokenMatch) feature = tokenMatch[1];
        }
        var loc = err && err.loc ? ' (line ' + err.loc.line + ':' + err.loc.column + ')' : '';
        throw new Error(
          'Failed to parse ' + filename + loc + '\\n' +
          'Syntax feature: ' + feature + '\\n' +
          'Babel error: ' + msg.split('\\n')[0] + '\\n\\n' +
          'This file uses a syntax feature that the in-browser Babel transpiler does not support. ' +
          'You may need to simplify this file or remove the ' + feature + ' syntax to preview it here.'
        );
      }
    }

    function __resolvePath__(fromFile, importPath) {
      let p = importPath.replace(/^[.\\/]+/, '');
      var sortedAliases = Object.entries(__ALIASES__).sort(function(a, b) { return b[0].length - a[0].length; });
      for (var i = 0; i < sortedAliases.length; i++) {
        var aliasName = sortedAliases[i][0];
        var aliasTarget = sortedAliases[i][1];
        var prefix = aliasName + '/';
        if (p.startsWith(prefix)) {
          var rest = p.slice(prefix.length);
          var resolved = aliasTarget + '/' + rest;
          var found = tryResolve(resolved, fromFile);
          if (found) return found;
        }
      }
      if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
        var stripped = p.replace(/^[@~]\\//, '');
        for (var j = 0; j < __FALLBACK_BASES__.length; j++) {
          var candidate = __FALLBACK_BASES__[j] + '/' + stripped;
          var found2 = tryResolve(candidate, fromFile);
          if (found2) return found2;
        }
      }
      var found3 = tryResolve(p, fromFile);
      if (found3) return found3;
      return null;
    }

    function tryResolve(p, fromFile) {
      var candidates = [
        p,
        p + '.jsx', p + '.tsx', p + '.js', p + '.ts',
        p + '/index.jsx', p + '/index.tsx', p + '/index.js',
      ];
      var dir = fromFile.split('/').slice(0, -1).join('/');
      var base = dir ? dir + '/' : '';
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (__MODULES__[base + c]) return base + c;
        if (__MODULES__[c]) return c;
      }
      return null;
    }

    function __require__(fromFile, importPath) {
      // Expose for debugging.
      window.__require__ = __require__;
      // 1. React built-ins.
      if (importPath === 'react') return React;
      if (importPath === 'react-dom') return ReactDOM;
      if (importPath === 'react-dom/client') return { createRoot: (el) => ReactDOM.createRoot(el) };

      // 2. CSS/asset imports — return empty object (the actual CSS is
      //    inlined separately or not available).
      var ext = importPath.split('.').pop().toLowerCase();
      if (['css','scss','sass','less','styl','png','jpg','jpeg','gif','webp','bmp','ico','avif','svg','woff','woff2','ttf','otf','eot','mp3','mp4','webm','mov','avi','wav','ogg','pdf','zip','csv'].indexOf(ext) >= 0) {
        return {};
      }

      // 3. Server-only and Next.js modules — return mocks.
      var mock = window.__getMock ? window.__getMock(importPath) : null;
      if (mock) return mock;

      // 4. Bare npm packages — return from preloaded esm.sh cache.
      if (window.__NPM_PACKAGES__ && window.__NPM_PACKAGES__[importPath]) {
        var npmMod = window.__NPM_PACKAGES__[importPath];
        // Ensure __esModule is set for Babel interop.
        if (!npmMod.__esModule) npmMod.__esModule = true;
        return npmMod;
      }
      // Try the base package name (e.g. "lucide-react/icons/xyz" → "lucide-react")
      if (importPath.startsWith('@')) {
        var scopedName = importPath.split('/').slice(0, 2).join('/');
        if (window.__NPM_PACKAGES__ && window.__NPM_PACKAGES__[scopedName]) {
          var pkg = window.__NPM_PACKAGES__[scopedName];
          // Try to navigate to the subpath.
          var subpath = importPath.slice(scopedName.length + 1);
          if (subpath && pkg[subpath]) return pkg[subpath];
          return pkg;
        }
      } else if (importPath.indexOf('/') >= 0) {
        var baseName = importPath.split('/')[0];
        if (window.__NPM_PACKAGES__ && window.__NPM_PACKAGES__[baseName]) {
          var pkg2 = window.__NPM_PACKAGES__[baseName];
          var subpath2 = importPath.slice(baseName.length + 1);
          if (subpath2 && pkg2[subpath2]) return pkg2[subpath2];
          return pkg2;
        }
      }

      // 5. Local files — resolve against __MODULES__.
      const resolved = __resolvePath__(fromFile, importPath);
      if (!resolved) {
        // Last resort: return an empty object so the app doesn't crash
        // on a missing module. This is better than a blank preview.
        console.warn('Module not found, returning empty:', importPath);
        return { __esModule: true, default: {} };
      }
      if (__CACHE__[resolved]) return __CACHE__[resolved].exports;
      const mod = { exports: {} };
      __CACHE__[resolved] = mod;
      const def = __MODULES__[resolved];
      // Pass the ORIGINAL file path (with extension) to __transform__ so
      // the Babel source-instrumentation plugin writes
      // data-lucian-source-file="src/Card.tsx" (not the extension-
      // stripped "src/Card"). The inspector uses the full path to find
      // the file in the project's file list.
      const transformedCode = __transform__(def.code, def.origPath || resolved, def.isTsx);
      const wrappedFn = new Function('module', 'exports', 'require', 'React', '__dirname', transformedCode);
      wrappedFn(mod, mod.exports, (p) => __require__(resolved, p), React, resolved.split('/').slice(0, -1).join('/'));
      // Babel's CommonJS interop: if the module didn't set __esModule, wrap it.
      if (!mod.exports.__esModule) {
        mod.exports.__esModule = true;
        if (typeof mod.exports.default === 'undefined') {
          mod.exports.default = mod.exports;
        }
      }
      return mod.exports;
    }

    // --- App bootstrap ---
    // If npm packages need to be preloaded, wait for them before rendering.
    function bootApp() {
      if (window.__BOOTED__) return;
      window.__BOOTED__ = true;
      try {
        const entryRes = ${JSON.stringify(appPath)};
        const entryMod = __require__('', './' + entryRes);
        var App = entryMod.default || entryMod.App || entryMod;
        // If App is still an object with a default, unwrap it.
        if (App && typeof App === 'object' && App.default && typeof App.default === 'function') {
          App = App.default;
        }
        var rootEl = document.getElementById('root');

        // Error boundary that catches rendering errors and shows a fallback.
        // We try to render the app; if it crashes, we show the error but
        // also retry once (React 18 supports resetKey for boundaries).
        class ErrorBoundary extends React.Component {
          constructor(props) { super(props); this.state = { hasError: false, error: null, errorInfo: null }; }
          static getDerivedStateFromError(error) { return { hasError: true, error: error }; }
          componentDidCatch(error, info) {
            console.error('React render error:', error.message);
            if (info && info.componentStack) console.error('Component stack:', info.componentStack);
            this.setState({ errorInfo: info });
          }
          render() {
            if (this.state.hasError) {
              var err = this.state.error;
              var msg = (err && err.message) ? err.message : String(err);
              var stack = this.state.errorInfo && this.state.errorInfo.componentStack
                ? String(this.state.errorInfo.componentStack).trim().split('\\n')[0]
                : '';
              return React.createElement('div', {
                style: { fontFamily: 'system-ui,sans-serif', padding: '2rem', minHeight: '100vh', background: '#f8fafc', color: '#0f172a' }
              },
                React.createElement('div', {
                  style: { background: 'white', borderRadius: '12px', padding: '1.5rem', marginBottom: '1rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
                },
                  React.createElement('h2', { style: { fontSize: '1.1rem', fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem' } }, 'Preview partially loaded'),
                  React.createElement('p', { style: { fontSize: '0.875rem', color: '#64748b', marginBottom: '0.75rem' } },
                    'The app loaded but a component crashed: ' + msg),
                  stack ? React.createElement('p', { style: { fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' } }, 'In: ' + stack) : null,
                  React.createElement('p', { style: { fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.75rem' } },
                    'This is usually because a mock API response did not match exactly what the component expected. The rest of the app may still work.')
                )
              );
            }
            return this.props.children;
          }
        }

        if (rootEl && App) {
          ReactDOM.createRoot(rootEl).render(
            React.createElement(ErrorBoundary, null, React.createElement(App))
          );
        } else if (!rootEl) {
          document.body.innerHTML = '<div style="font-family:sans-serif;padding:2rem;color:#c53030;"><h2>Missing root element</h2><p>Add a &lt;div id="root"&gt;&lt;/div&gt; for React to mount.</p></div>';
        } else {
          document.body.innerHTML = '<div style="font-family:ui-monospace,monospace;padding:2rem;color:#c53030;background:#fff5f5;border:1px solid #feb2b2;border-radius:12px;margin:1rem;white-space:pre-wrap;font-size:13px;"><strong>Preview Error</strong>\\n\\nThe entry module did not export a valid React component.\\nEntry: ' + entryRes + '\\nExports: ' + Object.keys(entryMod).join(', ') + '\\nApp type: ' + typeof App + '</div>';
        }
      } catch (err) {
        console.error(err);
        var errMsg = (err && err.stack ? err.stack : String(err));
        var isParseError = /Failed to parse|Syntax feature|Babel error/i.test(errMsg);
        var title = isParseError ? 'Parse Error — file could not be transpiled' : 'Preview Error';
        var bg = isParseError ? '#fff8f0' : '#fff5f5';
        var border = isParseError ? '#fed7aa' : '#feb2b2';
        var color = isParseError ? '#9a3412' : '#c53030';
        document.body.innerHTML = '<div style="font-family:ui-monospace,monospace;padding:2rem;color:' + color + ';background:' + bg + ';border:1px solid ' + border + ';border-radius:12px;margin:1rem;white-space:pre-wrap;font-size:13px;line-height:1.6;"><strong>' + title + '</strong>\\n\\n' + errMsg + '</div>';
      }
    }

    ${hasNpmPackages ? `
    // Wait for npm packages to finish loading before booting the app.
    if (window.__NPM_LOADED__) {
      bootApp();
    } else {
      window.addEventListener('__npm_loaded__', bootApp, { once: true });
      // Safety timeout: boot after 10s even if some packages failed to load.
      setTimeout(function() {
        if (!window.__BOOTED__) { window.__BOOTED__ = true; bootApp(); }
      }, 10000);
    }
    ` : `
    bootApp();
    `}
  </script>
</body>
</html>`;

  return html;
}

// ---------------------------------------------------------------------------
// Vue preview
// ---------------------------------------------------------------------------

function buildVuePreview(
  files: ProjectFile[],
  fileMap: Map<string, ProjectFile>,
  mode: PreviewMode,
  envVars: EnvVar[],
  mockBootstrap: string,
): string {
  const indexHtml = fileMap.get("index.html") ?? files.find((f) => f.path.endsWith("index.html"));
  const appFile =
    fileMap.get("App.vue") ??
    fileMap.get("src/App.vue") ??
    files.find((f) => f.path.endsWith(".vue"));

  if (!appFile) {
    return wrapNoPreview(
      "No Vue entry file found",
      "Add an App.vue component to enable the Vue preview.",
    );
  }

  const bodyContent = indexHtml?.content ?? '<div id="app"></div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${mockBootstrap}
</head>
<body>
  ${bodyContent}
  <script src="${VUE_CDN}" crossorigin="anonymous"></script>
  <script>
    window.__PREVIEW_MODE__ = ${JSON.stringify(mode)};
    window.__ENV_VARS__ = ${JSON.stringify(envVars)};
    const { createApp } = Vue;
    try {
      const template = ${JSON.stringify(extractVueTemplate(appFile.content))};
      const setup = ${extractVueScriptBody(appFile.content)};
      createApp({ template, setup }).mount('#app');
    } catch (err) {
      console.error(err);
      document.body.innerHTML = '<pre style="color:#c53030;padding:2rem;font-family:monospace;">' + (err && err.stack ? err.stack : String(err)) + '</pre>';
    }
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveLocalPath(href: string, files: ProjectFile[]): string | null {
  // Strip query string and fragment first.
  const cleaned = href.split("?")[0].split("#")[0];
  if (!cleaned) return null;
  // Strip any leading "./" or "/" — we treat all local asset references as
  // project-root-relative. This handles:
  //   "./styles.css"   → "styles.css"
  //   "styles.css"     → "styles.css"
  //   "/styles.css"    → "styles.css"
  //   "/src/main.tsx"  → "src/main.tsx"
  const relative = cleaned.replace(/^[./]+/, "");
  if (!relative) return null;

  // 1. Try direct match against the relative path.
  if (files.some((f) => f.path === relative)) return relative;

  // 2. Try with "public/" prefix stripped (Vite convention: a file at
  //    public/favicon.ico is referenced as /favicon.ico).
  if (relative.startsWith("public/")) {
    const stripped = relative.slice(7);
    if (files.some((f) => f.path === stripped)) return stripped;
  }

  // 3. Try prefixing "public/" (HTML convention: /favicon.ico → public/favicon.ico).
  if (files.some((f) => f.path === `public/${relative}`)) return `public/${relative}`;

  // 4. Last resort: unique suffix match. This handles cases where the file
  //    is stored under a nested path (e.g. after stripping a wrapping folder)
  //    and the href references it by its tail. We only accept the match if
  //    exactly one file ends with the relative path — otherwise it's ambiguous.
  const suffixMatches = files.filter(
    (f) => f.path === relative || f.path.endsWith("/" + relative),
  );
  if (suffixMatches.length === 1) return suffixMatches[0].path;

  return null;
}

function injectEnvAndMode(html: string, mode: PreviewMode, envVars: EnvVar[], mockBootstrap: string): string {
  const envScript = `<script>
    window.__PREVIEW_MODE__ = ${JSON.stringify(mode)};
    window.__ENV_VARS__ = ${JSON.stringify(envVars.reduce((acc, e) => ({ ...acc, [e.key]: e.value }), {}))};
    window.process = window.process || { env: window.__ENV_VARS__ };
  </script>`;
  // The mock bootstrap MUST run before any user code, so we inject it
  // right after the env script, at the very top of <head>.
  const bootstrap = envScript + "\n" + mockBootstrap;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`);
  }
  return bootstrap + html;
}

function wrapNoPreview(title: string, message: string): string {
  return wrapInfo(title, message, true);
}

function wrapInfo(title: string, messageHtml: string, isWarning = false): string {
  const accentColor = isWarning ? "#c53030" : "#667eea";
  const bgTint = isWarning ? "#fff5f5" : "#f0f4ff";
  const borderColor = isWarning ? "#feb2b2" : "#c3dafe";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${bgTint}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2d3748; padding: 2rem; }
    .card { max-width: 560px; background: white; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.08); border: 1px solid ${borderColor}; border-left: 4px solid ${accentColor}; }
    .icon { width: 48px; height: 48px; margin: 0 0 1rem; background: ${bgTint}; border-radius: 12px; display: grid; place-items: center; color: ${accentColor}; font-size: 24px; font-weight: 700; }
    h2 { margin: 0 0 1rem; font-size: 1.3rem; color: #1a202c; }
    p { color: #4a5568; line-height: 1.6; margin: 0.5rem 0; font-size: 14px; }
    ul { color: #4a5568; line-height: 1.7; margin: 0.5rem 0; padding-left: 1.5rem; font-size: 14px; }
    code { background: #edf2f7; padding: 1px 5px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: #2d3748; }
    strong { color: #1a202c; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isWarning ? "⚠" : "i"}</div>
    <h2>${title}</h2>
    ${messageHtml}
  </div>
</body>
</html>`;
}

/** Strip import/export statements so the code can be wrapped in a function.
 *  We replace them with module.exports assignments and require() calls.
 *  The `aliases` map is used to rewrite @/, ~/, etc. to their real paths
 *  (extracted from vite.config / tsconfig.json). */
function stripImportExportForInline(code: string, aliases: AliasMap): string {
  let out = code;

  // Remove `export type { X }` and `export type { X } from "mod"` entirely
  // (TypeScript type-only exports — no runtime code needed).
  out = out.replace(/export\s+type\s+\{[^}]+\}(\s+from\s+['"][^'"]+['"])?\s*;?/g, "");

  // Remove `export * from "mod"` (re-export all — can't replicate in CommonJS
  // without Object.assign, and it's rarely needed for preview).
  out = out.replace(/export\s+\*\s+from\s+['"][^'"]+['"]\s*;?/g, "");

  // Handle `export { X, Y } from "mod"` (re-export from another module).
  out = out.replace(
    /export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/g,
    (_m, names, p) => {
      const cleaned = names.split(",").map((n: string) => n.trim().replace(/^type\s+/, "")).filter(Boolean).join(", ");
      if (!cleaned) return "";
      return `const { ${cleaned} } = require("${resolveAlias(p, aliases)}"); Object.assign(module.exports, { ${cleaned} });`;
    },
  );

  // Default export: `export default X;` -> `module.exports = X;`
  out = out.replace(/export\s+default\s+/g, "module.exports = ");
  // Named exports: `export { A, B };` or `export const X = ...`
  out = out.replace(/export\s+\{[^}]*\};?/g, (m) =>
    m.replace(/export\s+\{/, "/* export */ {").replace(/\};?$/, "}"),
  );
  out = out.replace(/export\s+(const|let|var|function|class|async\s+function)\s/g, "$1 ");

  // Final safety net: strip any remaining `export ` keyword that wasn't
  // caught by the patterns above. This prevents "Unexpected token 'export'"
  // crashes on edge-case syntax we haven't handled.
  out = out.replace(/^\s*export\s+/gm, "");
  // ES module imports -> CommonJS require.
  // IMPORTANT: we must wrap the module path in quotes, otherwise paths like
  // @/components/ui/sonner get interpreted as bare identifiers (and the @
  // gets parsed as a decorator once the decorators plugin is enabled).
  // Also resolve path aliases (@/ → ./client/src/) so the module resolver
  // can find them. The alias map comes from vite.config / tsconfig.json.
  //
  // For bare module (npm package) default imports, we use `.default || module`
  // because esm.sh exports components as `default` on the module object.
  // For local file imports, we use the module object directly (module.exports).
  //
  // Order matters: the combined form `import X, { Y } from '...'` must be
  // matched BEFORE the simple `import X from '...'` form, otherwise the
  // simple regex consumes only the default import and leaves `{ Y } from '...'`
  // dangling.
  out = out.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (_m, name, names, p) => {
      const resolved = resolveAlias(p, aliases);
      const isBare = isBareModule(p);
      const defaultAccess = isBare ? `(require("${resolved}").default || require("${resolved}"))` : `require("${resolved}")`;
      return `const ${name} = ${defaultAccess}; const { ${names} } = require("${resolved}");`;
    },
  );
  out = out.replace(
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_m, name, p) => {
      const resolved = resolveAlias(p, aliases);
      const isBare = isBareModule(p);
      const defaultAccess = isBare ? `(require("${resolved}").default || require("${resolved}"))` : `require("${resolved}")`;
      return `const ${name} = ${defaultAccess};`;
    },
  );
  out = out.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
    (_m, name, p) => `const ${name} = require("${resolveAlias(p, aliases)}");`,
  );
  // Strip inline `type` modifiers inside named imports BEFORE the named-import
  // regex runs. This handles TypeScript 4.5+ syntax like:
  //   import { Toaster, type ToasterProps } from "sonner"
  //   import { type Foo, Bar } from "mod"
  // We remove the `type ` keyword so the destructuring works at runtime.
  // Also convert `X as Y` to `X: Y` since destructuring uses : for renaming.
  out = out.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g,
    (m, names, p) => {
      const cleanedNames = names
        .split(",")
        .map((n: string) => n.trim())
        .filter((n: string) => n && !n.startsWith("type "))
        .map((n: string) => n.replace(/^type\s+/, ""))
        // Convert `X as Y` → `X: Y` for destructuring syntax.
        .map((n: string) => n.replace(/^(\w+)\s+as\s+(\w+)$/, "$1: $2"))
        .join(", ");
      if (!cleanedNames) return ""; // All imports were type-only — drop the statement.
      return `const { ${cleanedNames} } = require("${resolveAlias(p, aliases)}");`;
    },
  );
  // Also handle `import type { X } from '...'` (TypeScript type-only imports).
  out = out.replace(/import\s+type\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?/g, "");
  out = out.replace(/import\s+['"]([^'"]+)['"];?/g, (_m, p) => `require("${resolveAlias(p, aliases)}");`);

  return out;
}

// ---------------------------------------------------------------------------
// Path alias resolution (dynamic — reads vite.config / tsconfig.json)
// ---------------------------------------------------------------------------

/** Map from alias prefix (e.g. "@", "~", "$lib") to the target directory. */
type AliasMap = Record<string, string>;

/** Extract path aliases from a Vite config file (ts or js).
 *  Handles both the object form `alias: { "@": "..." }` and the array form
 *  `alias: [{ find: "@", replacement: "..." }]`, including path.resolve() calls. */
function extractAliasesFromViteConfig(content: string): AliasMap {
  const aliases: AliasMap = {};

  // Object form: alias: { "@": "...", "~": "..." }
  const aliasBlockMatch = content.match(/alias\s*:\s*\{([\s\S]*?)\}\s*,?\s*\}/);
  if (aliasBlockMatch) {
    const block = aliasBlockMatch[1];
    const pairRe = /['"]([@~$][^'"]*)['"]\s*:\s*([^,\n}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(block)) !== null) {
      const key = m[1];
      let val = m[2].trim();
      val = resolvePathResolveCall(val);
      val = val.replace(/^['"]|['"]$/g, "").replace(/^\.\//, "").trim();
      if (val) aliases[key] = val;
    }
  }

  // Array form: alias: [{ find: "@", replacement: "..." }]
  const arrayBlockMatch = content.match(/alias\s*:\s*\[([\s\S]*?)\]/);
  if (arrayBlockMatch) {
    const block = arrayBlockMatch[1];
    const entryRe = /\{\s*find\s*:\s*['"]([^'"]+)['"]\s*,\s*replacement\s*:\s*([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(block)) !== null) {
      const key = m[1];
      let val = m[2].trim();
      val = resolvePathResolveCall(val);
      val = val.replace(/^['"]|['"]$/g, "").replace(/^\.\//, "").trim();
      if (val) aliases[key] = val;
    }
  }

  return aliases;
}

/** Extract the path segments from a `path.resolve(__dirname, "a", "b")` call,
 *  returning just the string literal segments joined by "/". */
function resolvePathResolveCall(val: string): string {
  const resolveMatch = val.match(/path\.resolve\s*\(([^)]+)\)/);
  if (!resolveMatch) return val;
  const args = resolveMatch[1];
  const stringArgs = args.match(/['"]([^'"]+)['"]/g);
  if (!stringArgs) return val;
  const segments = stringArgs
    .map((s) => s.replace(/^['"]|['"]$/g, ""))
    .filter((s) => s !== "__dirname" && !s.includes("import.meta"));
  return segments.join("/");
}

/** Extract path aliases from tsconfig.json's compilerOptions.paths.
 *  e.g. { "@/*": ["./src/*"] } → { "@": "src" } */
function extractAliasesFromTsConfig(content: string): AliasMap {
  const aliases: AliasMap = {};
  try {
    const json = JSON.parse(content);
    const paths = json?.compilerOptions?.paths;
    if (paths && typeof paths === "object") {
      for (const [key, targets] of Object.entries(paths)) {
        const aliasName = key.replace(/\/\*$/, "");
        if (Array.isArray(targets) && targets.length > 0) {
          let target = targets[0] as string;
          // Strip leading "./" if present.
          target = target.replace(/^\.\//, "");
          // Strip trailing "/*" if present (the wildcard part of the path).
          // If the target is exactly "*" (i.e. paths was "./*"), the result
          // should be "" (project root), not "*".
          if (target === "*") {
            target = "";
          } else {
            target = target.replace(/\/\*$/, "");
          }
          // Strip any trailing slash.
          target = target.replace(/\/$/, "");
          aliases[aliasName] = target;
        }
      }
    }
  } catch {
    // JSON parse failed — ignore.
  }
  return aliases;
}

/** Extract all path aliases from a project's config files.
 *  Checks vite.config.ts/js first, then tsconfig.json (tsconfig overrides
 *  since it's the source of truth for TypeScript path resolution). */
function extractAllAliases(files: ProjectFile[]): AliasMap {
  let aliases: AliasMap = {};

  const viteFile = files.find((f) => f.path === "vite.config.ts" || f.path === "vite.config.js");
  if (viteFile) {
    aliases = { ...aliases, ...extractAliasesFromViteConfig(viteFile.content) };
  }

  const tsconfig = files.find((f) => f.path === "tsconfig.json");
  if (tsconfig) {
    aliases = { ...aliases, ...extractAliasesFromTsConfig(tsconfig.content) };
  }

  return aliases;
}

/** Rewrite an import path using the project's alias map.
 *  Called at build time (before Babel sees the code) to convert aliased
 *  imports like `@/components/Button` into relative paths like
 *  `./client/src/components/Button`.
 *
 *  If no alias matches, returns the path unchanged. Bare module names
 *  (react, lodash, etc.) are never touched. */
function resolveAlias(importPath: string, aliases: AliasMap): string {
  // Don't touch bare module names (no / prefix).
  if (!importPath.startsWith("@/") && !importPath.startsWith("~/") && !importPath.includes("/")) {
    return importPath;
  }
  // Try each alias prefix. Sort by length descending so longer aliases
  // (e.g. "$lib") match before shorter ones (e.g. "@").
  const sortedAliases = Object.entries(aliases).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, target] of sortedAliases) {
    const prefix = alias + "/";
    if (importPath.startsWith(prefix)) {
      const rest = importPath.slice(prefix.length);
      // When target is empty (paths "./*" → ""), the result should be
      // "./components/Hero" not "././/components/Hero".
      if (!target) return "./" + rest;
      return "./" + target + "/" + rest;
    }
    if (importPath === alias) {
      if (!target) return "./";
      return "./" + target;
    }
  }
  return importPath;
}

/** Resolve all path aliases in a source file's import/export statements.
 *  This runs BEFORE Babel sees the code, so Babel's require() calls use
 *  paths that __resolvePath__ can find. Only rewrites @/, ~/, etc. —
 *  bare module names (react, framer-motion) are left unchanged so they
 *  can be resolved via __NPM_PACKAGES__. */
function resolveAliasesInCode(code: string, aliases: AliasMap): string {
  if (Object.keys(aliases).length === 0) return code;
  // Rewrite import/export paths that use aliases.
  // Match: from "ALIAS/..." or from "ALIAS"
  return code.replace(
    /(from\s+['"])([@~$][^'"]*)(['"])/g,
    (_m, prefix, path, suffix) => prefix + resolveAlias(path, aliases) + suffix,
  );
}

/**
 * Append an auto-export shim that finds a likely default export when the
 * user didn't write `export default` explicitly. This makes the preview
 * forgiving for beginners who just write `function App() { ... }`.
 */
function addAutoExport(code: string): string {
  // Only add the shim if there's no explicit default export already.
  if (/\bmodule\.exports\s*=/.test(code) || /\bexport\s+default\b/.test(code)) {
    return code;
  }
  return (
    code +
    "\n;(__auto_export__ = function() {" +
    "  if (typeof App !== 'undefined') module.exports = App;" +
    "  else if (typeof App$1 !== 'undefined') module.exports = App$1;" +
    "  else if (typeof Component !== 'undefined') module.exports = Component;" +
    "  else { const keys = Object.keys(this); if (keys.length === 1) module.exports = this[keys[0]]; }" +
    "}).call({});\n"
  );
}

function extractVueTemplate(source: string): string {
  const m = source.match(/<template>([\s\S]*?)<\/template>/i);
  return m ? m[1].trim() : "<div>Missing template</div>";
}

function extractVueScriptBody(source: string): string {
  const m = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return "() => ({})";
  let body = m[1];
  // Strip export default and return the object/function literal.
  body = body.replace(/export\s+default\s+/, "");
  if (body.trim().startsWith("{")) {
    return `() => ${body.trim()}`;
  }
  return `() => ({})`;
}
