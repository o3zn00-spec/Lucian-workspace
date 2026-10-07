/**
 * Minimal TypeScript declaration for imagetracerjs (which ships without types).
 * Only declares the API surface LUCIAN's Vector Studio uses.
 */

declare module "imagetracerjs" {
  export interface ImageTracerColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export interface ImageTracerOptions {
    /** Tracing preset — overwrites individual fields. */
    preset?: string;
    /** Number of colors to detect (color quantization). 2-64 typical. */
    numberofcolors?: number;
    /** Color quantization cycles (1-3 typical). */
    colorquantcycles?: number;
    /** Path drawing: line threshold (lower = more detail). 0-5 typical. */
    ltres?: number;
    /** Path drawing: quad threshold (lower = smoother curves). 0-5 typical. */
    qtres?: number;
    /** Skip paths smaller than this many pixels (noise filter). */
    pathomit?: number;
    /** Background blur radius in pixels (smoothing). */
    blurradius?: number;
    /** Background blur delta. */
    blurdelta?: number;
    /** Output SVG round-to decimal places. */
    roundcoords?: number;
    /** Viewbox: 1 = use width/height, 0 = use viewBox. */
    viewbox?: number;
    /** Find exact color of each pixel (1) or use sampled palette (0). */
    colorsampling?: number;
    /** Pretty-print SVG output (1 = yes). */
    strokewidth?: number;
    /** Line filter: minimum line length to keep. */
    linefilter?: number;
    /** Scale output (1 = original). */
    scale?: number;
    /** Round SVG string output (1 = yes). */
    simplfydatapixels?: number;
    /** Format color attribute output. */
    lcpr?: number;
    qcpr?: number;
    /** Min path area to keep. */
    minpathpercent?: number;
    /** Suppress small shapes. */
    rightangleenhance?: boolean;
  }

  export interface ImageTracerLayer {
    color: ImageTracerColor;
    paths: number[][][];
  }

  export interface ImageTracerResult {
    layers: ImageTracerLayer[];
    palette: ImageTracerColor[];
    width: number;
    height: number;
    svg: string;
  }

  /** Trace a remote image URL → SVG string (async, callback). */
  export function imageToSVG(
    url: string,
    callback: (svg: string) => void,
    options?: ImageTracerOptions | string
  ): void;

  /** Trace an ImageData object → SVG string (sync). */
  export function imagedataToSVG(
    imgd: ImageData,
    options?: ImageTracerOptions | string
  ): string;

  /** Trace an ImageData object → tracedata structure (sync). */
  export function imagedataToTracedata(
    imgd: ImageData,
    options?: ImageTracerOptions | string
  ): ImageTracerResult;

  /** Get a list of available preset names. */
  export function optionpresets(): Record<string, ImageTracerOptions>;

  /** Check + normalize options against a preset. */
  export function checkoptions(
    options?: ImageTracerOptions | string
  ): ImageTracerOptions;

  const _default: {
    imageToSVG: typeof imageToSVG;
    imagedataToSVG: typeof imagedataToSVG;
    imagedataToTracedata: typeof imagedataToTracedata;
    optionpresets: typeof optionpresets;
    checkoptions: typeof checkoptions;
  };
  export default _default;
}
