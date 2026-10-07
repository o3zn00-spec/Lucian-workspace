const EDITOR_ID = "data-lucian-vector-id";
const GRAPHIC_TAGS = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image"]);
const FORBIDDEN_TAGS = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video"]);

export interface SvgLayer {
  id: string;
  parentId: string | null;
  tag: string;
  depth: number;
  label: string;
  attributes: Record<string, string>;
}

export interface SvgPathNode {
  index: number;
  command: string;
  label: string;
  x?: number;
  y?: number;
  xToken?: number;
  yToken?: number;
}

function parse(svg: string): XMLDocument {
  if (typeof DOMParser === "undefined") throw new Error("SVG editing is available in the browser.");
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.tagName.toLowerCase() !== "svg") {
    throw new Error("The SVG source is not valid XML.");
  }
  return doc;
}

function serialize(doc: XMLDocument): string {
  return new XMLSerializer().serializeToString(doc.documentElement);
}

function safeUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("#") || normalized.startsWith("data:image/") || (!normalized.includes(":") && !normalized.startsWith("//"));
}

function sanitizeDocument(doc: XMLDocument) {
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    if (FORBIDDEN_TAGS.has(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") element.removeAttribute(attribute.name);
      if ((name === "href" || name.endsWith(":href")) && !safeUrl(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
}

function newElementId(tag: string, index: number) {
  return `${tag}_${Date.now().toString(36)}_${index}_${crypto.randomUUID().slice(0, 5)}`;
}

export function normalizeEditableSvg(svg: string): string {
  const doc = parse(svg);
  sanitizeDocument(doc);
  const root = doc.documentElement;
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  let index = 0;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (GRAPHIC_TAGS.has(tag) && !element.getAttribute(EDITOR_ID)) {
      element.setAttribute(EDITOR_ID, newElementId(tag, index++));
    }
  }
  return serialize(doc);
}

export function svgDimensions(svg: string): { width: number; height: number } {
  const root = parse(svg).documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute("width") ?? "") || (viewBox?.[2] ?? 1200);
  const height = Number.parseFloat(root.getAttribute("height") ?? "") || (viewBox?.[3] ?? 800);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

export function inspectSvgLayers(svg: string): SvgLayer[] {
  const doc = parse(svg);
  const layers: SvgLayer[] = [];
  const walk = (parent: Element, depth: number, parentId: string | null) => {
    for (const element of Array.from(parent.children)) {
      const tag = element.tagName.toLowerCase();
      if (!GRAPHIC_TAGS.has(tag)) {
        walk(element, depth, parentId);
        continue;
      }
      const id = element.getAttribute(EDITOR_ID);
      if (!id) continue;
      const attributes = Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]));
      const explicit = element.getAttribute("aria-label") || element.getAttribute("id");
      const text = tag === "text" ? element.textContent?.trim().slice(0, 28) : "";
      layers.push({ id, parentId, tag, depth, label: explicit || text || `${tag} ${layers.length + 1}`, attributes });
      walk(element, depth + 1, id);
    }
  };
  walk(doc.documentElement, 0, null);
  return layers;
}

function findLayer(doc: XMLDocument, id: string): Element {
  const element = Array.from(doc.querySelectorAll(`[${EDITOR_ID}]`)).find((candidate) => candidate.getAttribute(EDITOR_ID) === id);
  if (!element) throw new Error("The selected vector layer no longer exists.");
  return element;
}

export function updateSvgLayer(svg: string, id: string, patch: Record<string, string | null>): string {
  const doc = parse(svg);
  const element = findLayer(doc, id);
  for (const [name, value] of Object.entries(patch)) {
    if (name.toLowerCase().startsWith("on") || name === EDITOR_ID) continue;
    if (value === null || value === "") element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  sanitizeDocument(doc);
  return serialize(doc);
}

export function updateSvgText(svg: string, id: string, text: string): string {
  const doc = parse(svg);
  const element = findLayer(doc, id);
  if (element.tagName.toLowerCase() !== "text") throw new Error("Only text layers have editable text content.");
  element.textContent = text;
  return serialize(doc);
}

export type SvgShapeKind = "rect" | "circle" | "ellipse" | "line" | "path" | "text" | "group";

export function addSvgShape(svg: string, kind: SvgShapeKind): { svg: string; id: string } {
  const doc = parse(svg);
  const root = doc.documentElement;
  const id = newElementId(kind, root.querySelectorAll(`[${EDITOR_ID}]`).length);
  const element = doc.createElementNS("http://www.w3.org/2000/svg", kind === "group" ? "g" : kind);
  element.setAttribute(EDITOR_ID, id);
  const defaults: Record<SvgShapeKind, Record<string, string>> = {
    rect: { x: "80", y: "80", width: "320", height: "200", rx: "20", fill: "#7c3aed" },
    circle: { cx: "240", cy: "240", r: "120", fill: "#06b6d4" },
    ellipse: { cx: "280", cy: "220", rx: "180", ry: "100", fill: "#f59e0b" },
    line: { x1: "80", y1: "80", x2: "440", y2: "280", stroke: "#18181b", "stroke-width": "8" },
    path: { d: "M 100 300 C 220 80 420 80 540 300", fill: "none", stroke: "#ec4899", "stroke-width": "12", "stroke-linecap": "round" },
    text: { x: "100", y: "200", fill: "#18181b", "font-size": "64", "font-family": "Inter, sans-serif" },
    group: {},
  };
  for (const [name, value] of Object.entries(defaults[kind])) element.setAttribute(name, value);
  if (kind === "text") element.textContent = "Vector text";
  root.appendChild(element);
  return { svg: serialize(doc), id };
}

export function duplicateSvgLayer(svg: string, id: string): { svg: string; id: string } {
  const doc = parse(svg);
  const element = findLayer(doc, id);
  if (!element.parentElement) throw new Error("The layer cannot be duplicated.");
  const clone = element.cloneNode(true) as Element;
  let index = 0;
  for (const child of [clone, ...Array.from(clone.querySelectorAll(`[${EDITOR_ID}]`))]) {
    child.setAttribute(EDITOR_ID, newElementId(child.tagName.toLowerCase(), index++));
  }
  const cloneId = clone.getAttribute(EDITOR_ID)!;
  element.insertAdjacentElement("afterend", clone);
  return { svg: serialize(doc), id: cloneId };
}

export function deleteSvgLayer(svg: string, id: string): string {
  const doc = parse(svg);
  findLayer(doc, id).remove();
  return serialize(doc);
}

export function moveSvgLayer(svg: string, id: string, direction: "up" | "down"): string {
  const doc = parse(svg);
  const element = findLayer(doc, id);
  if (!element.parentElement) throw new Error("The layer cannot be moved.");
  if (direction === "up") {
    const previous = element.previousElementSibling;
    if (!previous) return svg;
    element.parentElement.insertBefore(element, previous);
  } else {
    const next = element.nextElementSibling;
    if (!next) return svg;
    next.insertAdjacentElement("afterend", element);
  }
  return serialize(doc);
}

const PARAM_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

export function inspectPathNodes(pathData: string): SvgPathNode[] {
  const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const nodes: SvgPathNode[] = [];
  let command = "";
  let cursor = 0;
  while (cursor < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[cursor]!)) command = tokens[cursor++]!;
    if (!command) break;
    const count = PARAM_COUNTS[command.toUpperCase()];
    if (count === undefined || count === 0) continue;
    while (cursor < tokens.length && !/^[a-zA-Z]$/.test(tokens[cursor]!)) {
      if (cursor + count > tokens.length) break;
      const start = cursor;
      const upper = command.toUpperCase();
      const node: SvgPathNode = { index: nodes.length, command, label: `${command}${nodes.length + 1}` };
      if (upper === "H") {
        node.x = Number(tokens[start]); node.xToken = start;
      } else if (upper === "V") {
        node.y = Number(tokens[start]); node.yToken = start;
      } else {
        node.x = Number(tokens[start + count - 2]); node.y = Number(tokens[start + count - 1]);
        node.xToken = start + count - 2; node.yToken = start + count - 1;
      }
      nodes.push(node);
      cursor += count;
      if (cursor >= tokens.length || /^[a-zA-Z]$/.test(tokens[cursor]!)) break;
    }
  }
  return nodes;
}

export function updatePathNode(pathData: string, node: SvgPathNode, axis: "x" | "y", value: number): string {
  const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?/g) ?? [];
  const tokenIndex = axis === "x" ? node.xToken : node.yToken;
  if (tokenIndex === undefined || !Number.isFinite(value)) return pathData;
  tokens[tokenIndex] = String(value);
  return tokens.join(" ");
}

export function parseTransform(value = ""): { x: number; y: number; rotate: number; scaleX: number; scaleY: number } {
  const translate = value.match(/translate\(\s*([-+\d.]+)(?:[ ,]+([-+\d.]+))?/i);
  const rotate = value.match(/rotate\(\s*([-+\d.]+)/i);
  const scale = value.match(/scale\(\s*([-+\d.]+)(?:[ ,]+([-+\d.]+))?/i);
  return {
    x: Number(translate?.[1] ?? 0), y: Number(translate?.[2] ?? 0),
    rotate: Number(rotate?.[1] ?? 0),
    scaleX: Number(scale?.[1] ?? 1), scaleY: Number(scale?.[2] ?? scale?.[1] ?? 1),
  };
}

export function composeTransform(transform: { x: number; y: number; rotate: number; scaleX: number; scaleY: number }): string {
  return `translate(${transform.x} ${transform.y}) rotate(${transform.rotate}) scale(${transform.scaleX} ${transform.scaleY})`;
}

export function previewSvg(svg: string, selectedId?: string | null): string {
  const doc = parse(normalizeEditableSvg(svg));
  if (selectedId) {
    const selected = Array.from(doc.querySelectorAll(`[${EDITOR_ID}]`)).find((element) => element.getAttribute(EDITOR_ID) === selectedId);
    selected?.setAttribute("data-lucian-vector-selected", "true");
  }
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `[data-lucian-vector-selected="true"]{filter:drop-shadow(0 0 5px #2563eb);}`;
  doc.documentElement.insertBefore(style, doc.documentElement.firstChild);
  return serialize(doc);
}

export function cleanSvgForExport(svg: string): string {
  const doc = parse(svg);
  sanitizeDocument(doc);
  for (const element of Array.from(doc.querySelectorAll(`[${EDITOR_ID}]`))) element.removeAttribute(EDITOR_ID);
  for (const element of Array.from(doc.querySelectorAll("[data-lucian-vector-selected]"))) element.removeAttribute("data-lucian-vector-selected");
  return serialize(doc);
}
