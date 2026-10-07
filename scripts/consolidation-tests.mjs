// Source-only regression gates. No accounts, database connection or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('non-AI product modules, migrations, web and desktop source are preserved', () => {
  for (const path of [
    'app/(app)/notes/page.tsx', 'app/(app)/chess-academy/page.tsx',
    'app/(app)/research/page.tsx', 'app/(app)/investing/page.tsx',
    'app/(app)/economy-hub/page.tsx', 'app/(app)/browser/page.tsx',
    'src/components/devspace/workspace/code-editor-pane.tsx',
    'src/components/devspace/workspace/preview-pane.tsx',
    'src/components/devspace/workspace/history-dialog.tsx',
    'src/components/devspace/vector-studio/vector-studio-view.tsx',
    'src/components/devspace/converter/code-converter-view.tsx',
    'src/components/devspace/visual-editor/style-inspector.tsx',
    'src/lib/workspace/jsx-ast.ts', 'src/lib/workspace/webcontainer.ts',
    'src/lib/chess/engine-service.ts', 'src/lib/auth/owner.ts',
    'src/components/vault/vault-dashboard.tsx', 'prisma/schema.prisma',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/src/main.rs',
    'src-tauri/src/runtime.rs', 'desktop/host.mjs', 'desktop/launch.mjs',
    'public/auth/guardian-entrance.mp4', 'public/auth/guardian-hold.webp',
    'public/branding/lucian-guardian.svg',
  ]) assert(existsSync(join(root, path)), `Missing preserved source: ${path}`);
  assert.match(read('prisma/schema.prisma'), /provider = "postgresql"/);
  assert.match(read('next.config.ts'), /Cross-Origin-Embedder-Policy/);
  for (const entry of readdirSync(join(root, 'prisma/migrations'), {withFileTypes:true})) {
    if (entry.isDirectory()) assert(existsSync(join(root, 'prisma/migrations', entry.name, 'migration.sql')));
  }
});

test('legacy assistant source, routes, providers, prompts and desktop services are absent', () => {
  for (const path of ['src/components/lilith', 'src/lib/agent', 'src/lib/chat',
    'src/store/lilith.ts', 'src/store/economic-agent.ts', 'app/api/ai',
    'app/api/lilith', 'app/api/economic-agent', 'app/(app)/economic-agent',
    'app/api/user/agent-memory', 'app/api/user/chats', 'desktop/lilthe_service.py',
    'desktop/package-lilthe.mjs', 'desktop/package-python.mjs']) {
    assert(!existsSync(join(root, path)), `Legacy path remains: ${path}`);
  }
  for (const directory of ['app', 'src', 'desktop']) {
    for (const file of files(join(root, directory)).filter(path => /\.(tsx?|mjs|html|css)$/.test(path))) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /lilith|lilthe/i, relative(root, file));
    }
  }
  assert.doesNotMatch(read('desktop/host.mjs'), /spawn\(|python|backendToken|backendUrl/);
  assert.doesNotMatch(read('.env.example'), /GEMINI|OPENAI|ANTHROPIC|AI_TRADING|LILTHE|LILITH/);
});

test('every remaining alias import resolves to source', () => {
  const missing = [];
  for (const directory of ['app', 'src']) {
    for (const file of files(join(root, directory)).filter(path => /\.(ts|tsx)$/.test(path))) {
      const ast = parse(readFileSync(file, 'utf8'), {sourceType:'module', plugins:['typescript','jsx']});
      const visit = node => {
        if (!node || typeof node !== 'object') return;
        const source = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ? node.source?.value :
          node.type === 'CallExpression' && (node.callee.type === 'Import' || node.callee.name === 'require') ? node.arguments[0]?.value : null;
        if (typeof source === 'string' && source.startsWith('@/')) {
          const target = join(root, 'src', source.slice(2));
          if (!['', '.ts', '.tsx', '.d.ts', '.mjs', '/index.ts', '/index.tsx'].some(suffix => existsSync(target + suffix))) {
            missing.push(`${relative(root,file)}: ${source}`);
          }
        }
        for (const [key,value] of Object.entries(node)) {
          if (['loc','comments','tokens'].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') visit(value);
        }
      };
      visit(ast);
    }
  }
  assert.deepEqual(missing, []);
});

test('historical data is archival-only; manual trading retains confirmed-owner path', () => {
  const schema = read('prisma/schema.prisma');
  for (const table of ['ChatConversation', 'ChatMessage', 'AgentMemory']) {
    assert(schema.includes(`@@map("${table}")`), `Existing physical table mapping lost: ${table}`);
  }
  const orders = read('app/api/trading/orders/route.ts');
  assert.match(orders, /executeTerminalOrder/);
  assert.doesNotMatch(orders, /executeLiveTrade|previewLiveTrade/);
  const terminal = read('src/lib/bybit/terminal.ts');
  assert.match(terminal, /intent\.initiatedBy !== "user"/);
  assert.match(terminal, /CONFIRM BYBIT LIVE ORDER/);
  assert.match(terminal, /verifyPassword/);
  assert.match(terminal, /emergencyStop/);
});

test('preserved assets are connected and release packaging stays private/unapproved', () => {
  const auth = read('src/components/auth/cinematic-auth-layout.tsx');
  assert.match(auth, /guardian-entrance\.mp4/);
  assert.match(auth, /CLEAN_ENTRANCE_SECONDS = 3\.33/);
  assert.match(auth, /prefers-reduced-motion/);
  assert.match(auth, /onError=\{finish\}/);
  assert.match(read('src/components/branding/BrandMark.tsx'), /lucian-guardian\.svg/);
  assert.match(read('app/(app)/layout.tsx'), /IsolationBoundary/);
  assert.match(read('proxy.ts'), /auth\/guardian-entrance\.mp4/);
  assert.match(read('proxy.ts'), /auth\/guardian-hold\.webp/);
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(config.bundle.active, false);
  assert.equal(JSON.parse(read('package.json')).private, true);
  assert.match(read('desktop/assemble-runtime.mjs'), /releaseReady:false/);
  const serviceWorker = read('public/sw.js');
  assert.doesNotMatch(serviceWorker, /economic-agent|AI provider/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(request, copy\)[\s\S]*return res[\s\S]*caches\.match\("\/"\)/);
});