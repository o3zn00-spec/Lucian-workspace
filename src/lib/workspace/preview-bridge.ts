"use client";

export interface PreviewInspection {
  source: "live-runtime" | "instant-preview";
  url: string;
  title: string;
  selector: string;
  text: string;
  html: string;
  interactive: string[];
}

type Inspector = (selector?: string) => Promise<PreviewInspection>;

const inspectors = new Map<PreviewInspection["source"], Inspector>();

export function registerPreviewInspector(
  source: PreviewInspection["source"],
  inspector: Inspector,
): () => void {
  inspectors.set(source, inspector);
  return () => {
    if (inspectors.get(source) === inspector) inspectors.delete(source);
  };
}

/** Prefer the real running application, then fall back to instant preview. */
export async function inspectRenderedPreview(selector?: string): Promise<PreviewInspection> {
  const live = inspectors.get("live-runtime");
  const instant = inspectors.get("instant-preview");
  if (!live && !instant) throw new Error("No rendered preview is currently mounted. Open Preview or start the Live Runtime first.");
  if (live) {
    try {
      return await live(selector);
    } catch (liveError) {
      if (!instant) throw liveError;
    }
  }
  return instant!(selector);
}

export function inspectSameOriginDocument(
  document: Document,
  selector = "body",
): Omit<PreviewInspection, "source"> {
  let root: Element | null;
  try {
    root = document.querySelector(selector);
  } catch {
    throw new Error(`Invalid DOM selector: ${selector}`);
  }
  if (!root) throw new Error(`No rendered element matches ${selector}.`);
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll("script,style,link,meta,noscript").forEach((element) => element.remove());
  const interactive = [...root.querySelectorAll("a,button,input,select,textarea,[role]")]
    .slice(0, 80)
    .map((element) => {
      const label = (element.getAttribute("aria-label") || element.textContent || element.getAttribute("placeholder") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 100);
      const id = element.id ? `#${element.id}` : "";
      const classes = typeof element.className === "string"
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join("")
        : "";
      return `<${element.tagName.toLowerCase()}${id}${classes}>${label ? ` ${label}` : ""}`;
    });
  return {
    url: document.location?.href ?? "about:srcdoc",
    title: document.title,
    selector,
    text: (root.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 8_000),
    html: clone.outerHTML.slice(0, 16_000),
    interactive,
  };
}
