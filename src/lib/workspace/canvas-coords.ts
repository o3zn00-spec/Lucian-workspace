"use client";

/* Canvas coordinate helpers — Phase 12 final integration pass.
 *
 * One explicit coordinate conversion layer for the Visual Editor.
 *
 * Coordinate spaces (used consistently across the canvas):
 *
 *   1. CLIENT coordinates
 *      `e.clientX`, `e.clientY` from `pointermove` / `pointerdown`.
 *      Screen-viewport pixels — affected by browser scroll AND by the
 *      iframe's position on the page.
 *
 *   2. IFRAME-LOCAL coordinates
 *      Position inside the iframe's document, in the iframe's own
 *      viewport (BEFORE the CSS `transform: scale(zoom)` is applied).
 *      Computed as: `client - iframeRect.left` (and then NOT divided by
 *      zoom — the iframe's own viewport already sees pre-zoom CSS pixels).
 *      `element.getBoundingClientRect()` inside the iframe returns values
 *      in this space too — BUT the values the parent window receives via
 *      postMessage are pre-transform (i.e. the iframe's natural CSS pixels).
 *
 *   3. CANVAS coordinates
 *      Position inside the scaled wrapper div (the div that has
 *      `transform: scale(zoom)`). This is what the overlay layer lives in.
 *      Computed as: `iframeLocal / zoom` — because the wrapper visually
 *      shrinks the iframe by `1/zoom`, the overlay must use the same
 *      divisor to align with the rendered element.
 *
 *   4. CONTAINER coordinates
 *      Position inside the outer scroll container (`canvasContainerRef`).
 *      Used only for absolute positioning when the wrapper is scrolled
 *      inside the container. The overlay is INSIDE the wrapper, so it
 *      uses CANVAS coordinates — NOT container coordinates.
 *
 * Common bug we're fixing:
 *   The previous code subtracted `containerRect.left` from a
 *   `getBoundingClientRect()` value that was already in the parent
 *   viewport's coordinate space, then divided by `zoom`. That double-
 *   subtracted the container's offset AND the wrapper's offset.
 *
 *   The correct flow is:
 *     iframe's `getBoundingClientRect()` (in CLIENT space, already
 *     affected by the CSS transform) → subtract wrapper's
 *     `getBoundingClientRect()` (also in CLIENT space, matches what the
 *     user sees) → divide by `zoom` to land in CANVAS space.
 *
 *   Or, equivalently, for elements INSIDE the iframe:
 *     `el.getBoundingClientRect()` (in IFRAME-LOCAL pre-transform space,
 *     as reported by the iframe's own script) → divide by `zoom` to land
 *     in CANVAS space, then add the wrapper's scroll offset if any.
 *
 *   We use the second form because the iframe's inspection script
 *     already returns rects in pre-transform space.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/**
 * Convert a CLIENT-space point (e.clientX, e.clientY) to CANVAS-space
 * coordinates inside the scaled wrapper.
 *
 * @param clientX       `e.clientX` from a pointer event.
 * @param clientY       `e.clientY` from a pointer event.
 * @param wrapperRect   `getBoundingClientRect()` of the wrapper div that
 *                      carries `transform: scale(zoom)`. In CLIENT space.
 * @param zoom          The current zoom factor (1 = 100%).
 */
export function clientPointToCanvasPoint(
  clientX: number,
  clientY: number,
  wrapperRect: Rect,
  zoom: number,
): Point {
  if (zoom <= 0) return { x: 0, y: 0 };
  // Distance from the wrapper's top-left in CLIENT space, then divided
  // by zoom to land in CANVAS (pre-transform) space.
  return {
    x: (clientX - wrapperRect.left) / zoom,
    y: (clientY - wrapperRect.top) / zoom,
  };
}

/**
 * Convert a pointer delta in CLIENT space (e.g. `e.clientX - startX`)
 * to a CANVAS-space delta. This is the workhorse for drag + resize.
 *
 * A 100px pointer movement on a 50% zoom canvas should produce a
 * 200px canvas-space delta — because the user perceives the element
 * moving 100px on screen, but the underlying CSS pixels are 2x larger.
 *
 * For resize, this means: a 100px pointer drag on a 50% canvas adds
 * 200px to the element's source-defined width — which is what the user
 * sees as 100px on screen. Without this conversion, the previous code
 * would add only 100px to the source, which would visually appear as
 * 50px on screen — a 2× mismatch.
 */
export function canvasDeltaFromPointerDelta(
  pointerDeltaX: number,
  pointerDeltaY: number,
  zoom: number,
): Point {
  if (zoom <= 0) return { x: 0, y: 0 };
  return {
    x: pointerDeltaX / zoom,
    y: pointerDeltaY / zoom,
  };
}

/**
 * Convert an IFRAME-LOCAL rect (returned by `el.getBoundingClientRect()`
 * inside the iframe, which is in pre-transform CSS pixels) to a CANVAS-
 * space rect for the overlay layer.
 *
 * @param iframeRect   The rect as reported by the iframe (pre-transform
 *                     CSS pixels, e.g. `{ left: 100, top: 50, width: 200,
 *                     height: 80 }`).
 * @param wrapperRect  The wrapper div's `getBoundingClientRect()` in
 *                     CLIENT space (so we can subtract its origin).
 * @param iframeOriginRect
 *                     The iframe element's own `getBoundingClientRect()`
 *                     in CLIENT space — used to translate from the
 *                     iframe's local space to the wrapper's local space.
 *                     In practice, when the iframe fills the wrapper
 *                     (no padding), `iframeOriginRect` equals `wrapperRect`.
 *                     We accept both for clarity.
 * @param zoom         The current zoom factor.
 */
export function iframeRectToCanvasRect(
  iframeRect: Rect,
  wrapperRect: Rect,
  iframeOriginRect: Rect,
  zoom: number,
): Rect {
  if (zoom <= 0) {
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  }
  // The iframe's rect is in the iframe's own pre-transform space.
  // Translate to wrapper-local CLIENT space by adding the iframe's
  // origin (where the iframe sits in the parent document).
  const clientLeft = iframeOriginRect.left + iframeRect.left;
  const clientTop = iframeOriginRect.top + iframeRect.top;
  // Now subtract the wrapper's origin and divide by zoom to land in
  // CANVAS space.
  const canvasLeft = (clientLeft - wrapperRect.left) / zoom;
  const canvasTop = (clientTop - wrapperRect.top) / zoom;
  const canvasW = iframeRect.width / zoom;
  const canvasH = iframeRect.height / zoom;
  return {
    left: canvasLeft,
    top: canvasTop,
    width: canvasW,
    height: canvasH,
    right: canvasLeft + canvasW,
    bottom: canvasTop + canvasH,
  };
}

/**
 * Convert an IFRAME-LOCAL rect directly to overlay coordinates assuming
 * the overlay is a sibling of the iframe INSIDE the same scaled wrapper.
 *
 * This is the simpler case: when the overlay is inside the wrapper (so
 * it's affected by the same `transform: scale(zoom)`), we just divide
 * the iframe rect by `zoom`. No origin subtraction needed — both the
 * iframe and the overlay share the same origin inside the wrapper.
 *
 * This is the form used by the current VisualCanvas overlay layer.
 */
export function iframeRectToOverlayRect(iframeRect: Rect, zoom: number): Rect {
  if (zoom <= 0) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  return {
    left: iframeRect.left / zoom,
    top: iframeRect.top / zoom,
    width: iframeRect.width / zoom,
    height: iframeRect.height / zoom,
    right: iframeRect.right / zoom,
    bottom: iframeRect.bottom / zoom,
  };
}

/**
 * Convert a CLIENT-space pointer event into an IFRAME-LOCAL point.
 *
 * Used by the drag/drop hit-test: we send the iframe's inspection
 * script the localX/localY so `document.elementFromPoint(localX, localY)`
 * returns the right element.
 *
 * `iframeRect` is the iframe element's `getBoundingClientRect()` in
 * CLIENT space (i.e. where the iframe sits on the parent page).
 *
 * Note: this does NOT divide by zoom. The iframe's own viewport is
 * pre-transform, but `elementFromPoint` interprets its arguments in
 * the iframe's own viewport coordinates — which ARE pre-transform.
 * So a pointer at CLIENT (200, 100) over a 50%-zoom iframe whose
 * CLIENT rect starts at (50, 50) is at iframe-local (150, 50) — and
 * that's the position `elementFromPoint` should look at.
 */
export function clientPointToIframeLocalPoint(
  clientX: number,
  clientY: number,
  iframeRect: Rect,
): Point {
  return {
    x: clientX - iframeRect.left,
    y: clientY - iframeRect.top,
  };
}
