import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const root = resolve(import.meta.dirname, "..");
const sourceRoots = [resolve(root, "app"), resolve(root, "src")];
const sourceFiles: string[] = [];

function jsxName(node: unknown): string {
  if (!node || typeof node !== "object" || !("type" in node)) return "";
  const typed = node as { type: string; name?: string };
  return typed.type === "JSXIdentifier" ? typed.name ?? "" : "";
}

function walk(directory: string) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if ([".tsx", ".jsx"].includes(extname(path))) sourceFiles.push(path);
  }
}
for (const directory of sourceRoots) walk(directory);

const actionableAttributes = new Set([
  "onClick", "onPointerDown", "onMouseDown", "onKeyDown", "onSubmit",
  "formAction", "asChild",
]);
const buttonNames = new Set(["button", "Button", "IconButton"]);
const deadControls: string[] = [];
const unguardedAsyncControls: string[] = [];
const internalLinks: Array<{ file: string; href: string }> = [];
let controlCount = 0;
let explicitUnavailableCount = 0;

for (const file of sourceFiles) {
  const code = readFileSync(file, "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
  const dialogNamespaces = new Set(ast.program.body.flatMap(node =>
    node.type === "ImportDeclaration" && node.source.value === "@radix-ui/react-dialog"
      ? node.specifiers.filter(specifier => specifier.type === "ImportNamespaceSpecifier").map(specifier => specifier.local.name)
      : [],
  ));
  traverse(ast, {
    JSXOpeningElement(path) {
      const nameNode = path.node.name;
      const name = nameNode.type === "JSXIdentifier" ? nameNode.name : "";
      const attrs = path.node.attributes
        .filter((attribute) => attribute.type === "JSXAttribute")
        .map((attribute) => attribute.name.type === "JSXIdentifier" ? attribute.name.name : "");
      const line = path.node.loc?.start.line ?? 0;
      const rel = relative(root, file).replaceAll("\\", "/");

      if (buttonNames.has(name)) {
        controlCount += 1;
        const explicitUnavailable = attrs.includes("disabled") || attrs.includes("aria-disabled");
        if (explicitUnavailable) explicitUnavailableCount += 1;
        const inheritedAction = Boolean(path.findParent((parent) => {
          if (!parent.isJSXElement()) return false;
          const opening = parent.node.openingElement;
          const member = opening.name;
          const delegatedDialogAction = member.type === "JSXMemberExpression"
            && member.object.type === "JSXIdentifier" && dialogNamespaces.has(member.object.name)
            && ["Trigger", "Close"].includes(member.property.name)
            && opening.attributes.some(attribute => attribute.type === "JSXAttribute"
              && attribute.name.type === "JSXIdentifier" && attribute.name.name === "asChild"
              && (attribute.value === null || (attribute.value.type === "JSXExpressionContainer"
                && attribute.value.expression.type === "BooleanLiteral" && attribute.value.expression.value)));
          if (delegatedDialogAction) return true;
          const parentName = jsxName(opening.name);
          return parentName === "Link" || parentName.endsWith("Trigger");
        }));
        const hasSpreadProps = path.node.attributes.some((attribute) => attribute.type === "JSXSpreadAttribute");
        const action = attrs.some((attribute) => actionableAttributes.has(attribute)) || inheritedAction || hasSpreadProps;
        const typeAttribute = path.node.attributes.find((attribute) =>
          attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "type",
        );
        const submit = typeAttribute?.type === "JSXAttribute" && typeAttribute.value?.type === "StringLiteral" && ["submit", "reset"].includes(typeAttribute.value.value);
        if (!action && !submit && !explicitUnavailable) deadControls.push(`${rel}:${line} <${name}>`);

        const onClick = path.node.attributes.find((attribute) =>
          attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "onClick",
        );
        const expression = onClick?.type === "JSXAttribute" && onClick.value?.type === "JSXExpressionContainer"
          ? onClick.value.expression
          : null;
        const directlyAsync = expression?.type === "ArrowFunctionExpression" && expression.async;
        if (directlyAsync && !explicitUnavailable && !attrs.includes("data-allow-repeat")) {
          unguardedAsyncControls.push(`${rel}:${line} <${name}>`);
        }
      }

      if (name === "Link") {
        const href = path.node.attributes.find((attribute) =>
          attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "href",
        );
        if (href?.type === "JSXAttribute" && href.value?.type === "StringLiteral" && href.value.value.startsWith("/")) {
          internalLinks.push({ file: `${rel}:${line}`, href: href.value.value });
        }
      }
    },
  });
}

const appRouteRoots = new Set(["/"]);
for (const group of ["app/(app)", "app/(auth)"]) {
  for (const entry of readdirSync(resolve(root, group), { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(resolve(root, group, entry.name, "page.tsx"))) appRouteRoots.add(`/${entry.name}`);
  }
}
const brokenLinks = internalLinks.filter(({ href }) => {
  const route = `/${href.split("?")[0].split("/").filter(Boolean)[0] ?? ""}`;
  return !appRouteRoots.has(route);
});

console.log("\n=== PHASE 12 CONTROL AUDIT ===");
console.log(`Interactive controls inspected: ${controlCount}`);
console.log(`Explicitly unavailable controls: ${explicitUnavailableCount}`);
console.log(`Static internal links inspected: ${internalLinks.length}`);
console.log(`Unguarded direct async controls: ${unguardedAsyncControls.length}`);

if (deadControls.length) console.error(`\nControls without an action or unavailable state:\n${deadControls.join("\n")}`);
if (brokenLinks.length) console.error(`\nLinks without a matching app route:\n${brokenLinks.map((item) => `${item.file} -> ${item.href}`).join("\n")}`);
if (unguardedAsyncControls.length) console.error(`\nAsync controls without a disabled state:\n${unguardedAsyncControls.join("\n")}`);

assert.deepEqual(deadControls, [], "Every button must have an action or explicit unavailable state");
assert.deepEqual(brokenLinks, [], "Every static internal Link must resolve to an app route");
assert.deepEqual(unguardedAsyncControls, [], "Direct async button actions must expose a disabled guard");
console.log("Phase 12 control audit passed.");
