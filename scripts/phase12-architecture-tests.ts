import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
let passed = 0;

function check(name: string, test: () => void) {
  test();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("\n=== PHASE 12 PERFORMANCE AND INTERACTION ARCHITECTURE ===");
const feedback = read("src/components/layout/navigation-feedback.tsx");
const shell = read("src/components/layout/AppShell.tsx");
const nav = read("src/components/ui/NavList.tsx");
const css = read("app/globals.css");
const workspace = read("src/components/devspace/dev-workspace.tsx");
const preview = read("src/components/devspace/workspace/preview-pane.tsx");
const store = read("src/store/workspace.ts");

check("App shell mounts immediate navigation feedback", () => {
  assert.match(shell, /<NavigationFeedback\s*\/>/);
  assert.match(feedback, /role="status"/);
  assert.match(feedback, /aria-live="polite"/);
});
check("Repeated clicks on a pending destination are suppressed", () => {
  assert.match(feedback, /event\.preventDefault\(\)/);
  assert.match(feedback, /data-navigation-pending/);
});
check("Sidebar links use Next pending state and identify the destination", () => {
  assert.match(nav, /useLinkStatus/);
  assert.match(nav, /data-navigation-target=\{href\}/);
});
check("Every app route has a meaningful transition fallback", () => {
  const loading = "app/(app)/loading.tsx";
  assert.ok(existsSync(resolve(root, loading)));
  assert.match(read(loading), /Opening module/);
  assert.match(read(loading), /role="status"/);
});
check("Pressed, selected, busy and unavailable controls have global feedback", () => {
  for (const state of [":active", "aria-pressed", "aria-selected", "data-navigation-pending", ":disabled"]) {
    assert.match(css, new RegExp(state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
check("Heavy Workspace tools are split from the initial library bundle", () => {
  assert.match(workspace, /dynamic\([\s\S]*?import\("@\/components\/devspace\/workspace\/workspace-view"\)/);
  assert.match(workspace, /dynamic\([\s\S]*?import\("@\/components\/devspace\/visual-editor\/visual-editor-view"\)/);
  assert.match(workspace, /dynamic\([\s\S]*?import\("@\/components\/devspace\/vector-studio\/vector-studio-view"\)/);
});
check("Lazy Workspace panes explain what is loading", () => {
  assert.match(workspace, /Opening \{label\}/);
  assert.match(workspace, /role="status"/);
});
check("Preview file loading reads only missing content", () => {
  assert.match(store, /const missingPaths = paths\.filter/);
  assert.match(store, /!cache\.has\(path\)/);
});
check("Preview build consumes one complete cache snapshot", () => {
  assert.match(preview, /await loadAllFileContents\(activeProjectId\)/);
  assert.doesNotMatch(preview, /getManyFileContents/);
});
check("Preview rebuild dependency is keyed, not tied to the whole project object", () => {
  assert.match(preview, /activeProjectId, previewMode, previewKey/);
  assert.doesNotMatch(preview, /activeProject, previewMode, previewKey/);
});
check("Environment changes explicitly request a preview refresh", () => {
  assert.match(store, /updateProjectEnv:[\s\S]*?refreshPreview\(\)/);
});
check("A repository-wide AST control audit is present", () => {
  const audit = read("scripts/phase12-control-audit.ts");
  assert.match(audit, /Interactive controls inspected/);
  assert.match(audit, /Unguarded direct async controls/);
});

console.log(`\nPhase 12 architecture checks passed: ${passed}`);
