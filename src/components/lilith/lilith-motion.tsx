"use client";

/* LilithMotion — draggable wrapper for the Lilith orb.
 *
 * Handles:
 *   - pointer-based dragging (mouse + touch via Pointer Events)
 *   - click-vs-drag detection (movement threshold)
 *   - edge clamping on viewport resize
 *   - position persistence via the Lilith store
 *   - preventing text selection / page scroll during drag
 *   - lock-position setting (drag disabled when locked)
 *
 * The orb itself is rendered as children so the motion layer is
 * reusable and decoupled from the visual.
 */

import { useCallback, useEffect, useRef } from "react";
import { useLilithStore, getSizePx } from "@/store/lilith";

interface Props {
  children: React.ReactNode;
  /** Called when the orb is clicked (not dragged). */
  onClick: () => void;
}

/** Movement threshold (px) below which a pointer-up is a click, not a drag. */
const DRAG_THRESHOLD = 5;

/** Padding from viewport edges (px) so the orb is never fully hidden. */
const EDGE_PADDING = 8;

export function LilithMotion({ children, onClick }: Props) {
  const settings = useLilithStore((s) => s.settings);
  const position = useLilithStore((s) => s.position);
  const setPosition = useLilithStore((s) => s.setPosition);
  const setDragging = useLilithStore((s) => s.setDragging);
  const setPanelOpen = useLilithStore((s) => s.setPanelOpen);
  const panelOpen = useLilithStore((s) => s.panelOpen);

  const orbSize = getSizePx(settings.size);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    pointerId: -1,
  });

  /** Resolve the actual pixel position from the stored value.
      { x: -1, y: -1 } means "use default bottom-right". */
  const resolvePosition = useCallback(() => {
    if (position.x < 0 || position.y < 0) {
      // Default: bottom-right with EDGE_PADDING.
      const x = window.innerWidth - orbSize - EDGE_PADDING - 24;
      const y = window.innerHeight - orbSize - EDGE_PADDING - 24;
      return { x, y };
    }
    return position;
  }, [position, orbSize]);

  /** Clamp a position so the orb stays at least partially visible. */
  const clampPosition = useCallback(
    (x: number, y: number) => {
      const maxX = window.innerWidth - orbSize * 0.4;
      const minX = -orbSize * 0.6;
      const maxY = window.innerHeight - orbSize * 0.4;
      const minY = -orbSize * 0.6;
      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },
    [orbSize],
  );

  // Apply position on mount + when position changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const pos = resolvePosition();
    const clamped = clampPosition(pos.x, pos.y);
    containerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
    // Persist clamped position if it changed.
    if (clamped.x !== position.x || clamped.y !== position.y) {
      if (settings.rememberPosition) setPosition(clamped.x, clamped.y);
    }
  }, [position, resolvePosition, clampPosition, setPosition, settings.rememberPosition]);

  // Re-clamp on viewport resize.
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const pos = resolvePosition();
      const clamped = clampPosition(pos.x, pos.y);
      containerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
      if (settings.rememberPosition) setPosition(clamped.x, clamped.y);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [resolvePosition, clampPosition, setPosition, settings.rememberPosition]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!settings.allowDragging || settings.lockPosition) return;
      // Only start drag on primary button (left click or touch).
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const pos = resolvePosition();
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
        moved: false,
        pointerId: e.pointerId,
      };

      // Capture pointer so we keep getting move events even if the cursor
      // leaves the orb.
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);

      // Prevent text selection while dragging.
      e.preventDefault();
    },
    [settings.allowDragging, settings.lockPosition, resolvePosition, setDragging],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragState.current.pointerId !== e.pointerId) return;
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragState.current.moved = true;
      }
      if (!dragState.current.moved) return;

      const newX = dragState.current.originX + dx;
      const newY = dragState.current.originY + dy;
      const clamped = clampPosition(newX, newY);

      if (containerRef.current) {
        containerRef.current.style.transform = `translate(${clamped.x}px, ${clamped.y}px)`;
      }
      if (settings.rememberPosition) setPosition(clamped.x, clamped.y);
    },
    [clampPosition, setPosition, settings.rememberPosition],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragState.current.pointerId !== e.pointerId) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      setDragging(false);
      // If the pointer didn't move beyond the threshold, treat as click.
      if (!dragState.current.moved) {
        onClick();
      }
      dragState.current.pointerId = -1;
    },
    [onClick, setDragging],
  );

  return (
    <div
      ref={containerRef}
      className="lilith-motion fixed left-0 top-0 z-[100] touch-none select-none"
      style={{ width: orbSize, height: orbSize }}
      onClick={() => { if (!settings.allowDragging || settings.lockPosition) onClick(); }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="button"
      tabIndex={0}
      aria-label={`${settings.name} — floating assistant`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setPanelOpen(!panelOpen);
        }
      }}
    >
      {children}
    </div>
  );
}
