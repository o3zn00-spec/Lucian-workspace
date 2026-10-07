// Vector Studio — real image-tracing engine wrapper around imagetracerjs.
//
// imagetracerjs is the industry-standard browser-side image tracer
// (https://github.com/jankovicsandros/imagetracerjs). It produces real
// SVG paths with curve/path generation, color quantization, layering,
// and path simplification. We do NOT use the old Lucian's simplistic
// pixel-rectangle engine — this is a real production-grade tracer.
//
// This wrapper:
//   1. Loads a File into an ImageData object via a canvas.
//   2. Maps Vector Studio presets to imagetracerjs options.
//   3. Calls imagetracerjs.imagedataToSVG() (synchronous).
//   4. Counts paths and detects colors in the result.
//   5. Returns structured metadata for the UI.

import type { ImageTracerOptions } from "imagetracerjs";

/** Visual mode — maps to a tunable preset of tracer parameters. */
export type TraceMode = "logo" | "icon" | "illustration" | "photo" | "lineart";

/** Result returned by the tracing engine. */
export interface TraceResult {
  /** SVG markup string. */
  svg: string;
  /** Pixel width of the source image. */
  width: number;
  /** Pixel height of the source image. */
  height: number;
  /** Number of <path> elements in the SVG (a quality indicator). */
  pathCount: number;
  /** Distinct colors used in the SVG (from <path fill="..."> attributes). */
  detectedColors: string[];
  /** Byte length of the SVG string (UTF-8). */
  svgSize: number;
  /** Time spent tracing, in milliseconds. */
  traceTimeMs: number;
  /** Options that were actually applied. */
  appliedOptions: ImageTracerOptions;
}

/**
 * Mode presets — each maps to a real imagetracerjs option set.
 *
 * Tuning philosophy:
 *   - logo: few colors, sharp edges (low qtres, low pathomit)
 *   - icon: very few colors, minimal paths, large pathomit
 *   - illustration: medium colors, balanced smoothing
 *   - photo: many colors, low line threshold (preserves detail)
 *   - lineart: 2 colors (B&W), heavy smoothing, no fills
 */
const MODE_PRESETS: Record<TraceMode, ImageTracerOptions> = {
  logo: {
    numberofcolors: 8,
    colorquantcycles: 3,
    ltres: 0.5,
    qtres: 0.5,
    pathomit: 8,
    blurradius: 0,
    blurdelta: 20,
    roundcoords: 1,
    viewbox: 1,
    colorsampling: 0,
    strokewidth: 1,
    linefilter: 0,
    scale: 1,
    simplfydatapixels: 0,
    lcpr: 0,
    qcpr: 0,
    rightangleenhance: true,
  },
  icon: {
    numberofcolors: 4,
    colorquantcycles: 3,
    ltres: 1,
    qtres: 1,
    pathomit: 12,
    blurradius: 1,
    blurdelta: 24,
    roundcoords: 1,
    viewbox: 1,
    colorsampling: 0,
    strokewidth: 1,
    linefilter: 0,
    scale: 1,
    simplfydatapixels: 0,
    lcpr: 0,
    qcpr: 0,
    rightangleenhance: true,
  },
  illustration: {
    numberofcolors: 16,
    colorquantcycles: 3,
    ltres: 0.5,
    qtres: 1,
    pathomit: 4,
    blurradius: 0,
    blurdelta: 20,
    roundcoords: 1,
    viewbox: 1,
    colorsampling: 1,
    strokewidth: 1,
    linefilter: 0,
    scale: 1,
    simplfydatapixels: 0,
    lcpr: 0,
    qcpr: 0,
    rightangleenhance: true,
  },
  photo: {
    numberofcolors: 32,
    colorquantcycles: 3,
    ltres: 0.1,
    qtres: 0.5,
    pathomit: 2,
    blurradius: 0,
    blurdelta: 20,
    roundcoords: 1,
    viewbox: 1,
    colorsampling: 1,
    strokewidth: 1,
    linefilter: 0,
    scale: 1,
    simplfydatapixels: 0,
    lcpr: 0,
    qcpr: 0,
    rightangleenhance: false,
  },
  lineart: {
    numberofcolors: 2,
    colorquantcycles: 1,
    ltres: 0.5,
    qtres: 1,
    pathomit: 8,
    blurradius: 1,
    blurdelta: 20,
    roundcoords: 1,
    viewbox: 1,
    colorsampling: 0,
    strokewidth: 1,
    linefilter: 0,
    scale: 1,
    simplfydatapixels: 0,
    lcpr: 0,
    qcpr: 0,
    rightangleenhance: true,
  },
};

/** Default per-mode starting color counts (user can override). */
export const DEFAULT_COLORS_FOR_MODE: Record<TraceMode, number> = {
  logo: 8,
  icon: 4,
  illustration: 16,
  photo: 32,
  lineart: 2,
};

export interface TraceSettings {
  mode: TraceMode;
  /** Override the mode's default color count. */
  numberOfColors: number;
  /** Smoothness: 0-100 scale. Higher = more curve smoothing (lower qtres). */
  smoothing: number;
  /** Detail: 0-100 scale. Higher = preserve more detail (lower ltres + pathomit). */
  detail: number;
  /** Drop tiny paths (noise filter) — pixel area threshold. */
  minPathSize: number;
  /** Optional blur before tracing (helps noisy JPEGs). 0 = none. */
  blurRadius: number;
  /** Output scale (1 = original size). */
  scale: number;
}

export function defaultSettingsForMode(mode: TraceMode): TraceSettings {
  const preset = MODE_PRESETS[mode];
  return {
    mode,
    numberOfColors: preset.numberofcolors ?? DEFAULT_COLORS_FOR_MODE[mode],
    smoothing: 50,
    detail: 50,
    minPathSize: preset.pathomit ?? 8,
    blurRadius: preset.blurradius ?? 0,
    scale: 1,
  };
}

/**
 * Convert a TraceSettings into the imagetracerjs options object.
 *
 * Mapping (every control genuinely affects output — verified end-to-end):
 *
 *   - smoothing (0-100) → qtres (0 → 5):
 *       smoothing=0  → qtres=0  → no curve threshold → EVERY segment becomes a curve (max detail, jagged)
 *       smoothing=100 → qtres=5 → high curve threshold → fewer, smoother curves
 *
 *     In imagetracerjs, higher qtres = MORE aggressive quad-path simplification
 *     = FEWER curve segments = SMOOTHER result. So our "smoothing" slider
 *     matches intuition: higher = smoother.
 *
 *   - detail (0-100) → ltres (5 → 0.1):
 *       detail=0   → ltres=5 → simplify fine edges
 *       detail=100 → ltres=0.1 → preserve fine edges
 *
 *   - minPathSize maps directly to pathomit, independently of detail.
 */
function settingsToOptions(settings: TraceSettings): ImageTracerOptions {
  const base = { ...MODE_PRESETS[settings.mode] };
  // smoothing: 0 → qtres=0 (jagged, every segment a curve), 100 → qtres=5 (smooth)
  base.qtres = (settings.smoothing / 100) * 5;
  // detail: 0 → ltres=5 (lose detail), 100 → ltres=0.1 (max detail)
  base.ltres = 5 - (settings.detail / 100) * 4.9;
  // Keep the explicit noise-filter control independent from edge detail.
  base.pathomit = Math.max(0, Math.round(settings.minPathSize));
  base.numberofcolors = settings.numberOfColors;
  base.blurradius = settings.blurRadius;
  base.scale = settings.scale;
  return base;
}

/**
 * Load a File into an ImageData object.
 *
 * Uses a canvas to read the decoded pixel data. Throws on unsupported
 * formats or read failures.
 */
export async function fileToImageData(file: File): Promise<ImageData> {
  if (typeof document === "undefined") {
    throw new Error("fileToImageData can only run in the browser.");
  }
  // Read the file as a data URL.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the file as a data URL."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed."));
    reader.readAsDataURL(file);
  });

  // Load it into an <img> element.
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode the image. Format may be unsupported."));
    el.src = dataUrl;
  });

  // Cap the source dimensions — very large images freeze the tracer.
  const MAX_DIM = 1024;
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > MAX_DIM || h > MAX_DIM) {
    const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
    w = Math.max(1, Math.round(w * ratio));
    h = Math.max(1, Math.round(h * ratio));
  }

  // Draw to canvas, then read back ImageData.
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Run the imagetracerjs tracer on an ImageData and return structured
 * metadata.
 */
export async function traceImageData(
  imgd: ImageData,
  settings: TraceSettings,
): Promise<TraceResult> {
  if (typeof window === "undefined") {
    throw new Error("traceImageData can only run in the browser.");
  }
  // Lazy-load imagetracerjs — it's ~47KB but doesn't need to be in the
  // initial bundle for users who never open Vector Studio.
  const ImageTracer = (await import("imagetracerjs")).default;
  const appliedOptions = settingsToOptions(settings);

  const start = performance.now();
  // imagedataToSVG is synchronous — yields the SVG string.
  const svg = ImageTracer.imagedataToSVG(imgd, appliedOptions);
  const traceTimeMs = Math.round(performance.now() - start);

  const pathCount = countPaths(svg);
  const detectedColors = extractColors(svg);
  const svgSize = new TextEncoder().encode(svg).length;

  return {
    svg,
    width: imgd.width,
    height: imgd.height,
    pathCount,
    detectedColors,
    svgSize,
    traceTimeMs,
    appliedOptions,
  };
}

/** Count <path .../> occurrences in the SVG. */
function countPaths(svg: string): number {
  const matches = svg.match(/<path\b/g);
  return matches ? matches.length : 0;
}

/** Extract distinct fill colors used in the SVG (preserves order). */
function extractColors(svg: string): string[] {
  const colors = new Set<string>();
  // Match fill="rgb(r,g,b)" or fill="#hex" or fill="rgba(...)".
  const fillMatches = svg.matchAll(/fill="([^"]+)"/g);
  for (const m of fillMatches) {
    if (m[1] && m[1] !== "none") colors.add(m[1]);
  }
  return Array.from(colors).slice(0, 64);
}

/**
 * Optimize an SVG string by removing comments, collapsing whitespace,
 * and dropping empty groups/defs. Lossless — the rendered output is
 * identical, but the file size shrinks.
 */
export function optimizeSvg(svg: string): string {
  return svg
    // Remove XML comments
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove XML processing instructions
    .replace(/<\?xml[^?]*\?>/g, "")
    // Collapse whitespace between tags
    .replace(/>\s+</g, "><")
    // Collapse runs of whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Convert an SVG string into a PNG data URL by rasterizing it through
 * a canvas. Returns a Blob URL that the caller can download or preview.
 */
export async function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("svgToPngBlob can only run in the browser.");
  }
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not load the SVG for rasterization."));
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob returned null."))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Generate a PDF that embeds the SVG as a high-resolution PNG.
 *
 * jsPDF 4.x dropped the native `.svg()` method, so we rasterize the SVG
 * to a PNG at 3× scale and embed that as a full-page image. The PDF is
 * pixel-based (not vector), but it's reliable across all browsers and
 * the resolution is high enough for printing at small sizes.
 *
 * A future iteration could integrate a true vector PDF library (pdfkit
 * with SVG support) — out of scope for this phase.
 */
export async function svgToPdfBlob(svg: string, width: number, height: number): Promise<Blob> {
  if (typeof window === "undefined") {
    throw new Error("svgToPdfBlob can only run in the browser.");
  }
  const { jsPDF } = await import("jspdf");
  // Rasterize the SVG to a high-res PNG first.
  const pngBlob = await svgToPngBlob(svg, width, height, 3);
  const pngDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not encode PNG for PDF."));
    reader.readAsDataURL(pngBlob);
  });

  const orientation: "portrait" | "landscape" = width >= height ? "landscape" : "portrait";
  const doc = new jsPDF({
    orientation,
    unit: "pt",
    format: [width, height],
  });
  doc.addImage(pngDataUrl, "PNG", 0, 0, width, height);
  return doc.output("blob");
}
