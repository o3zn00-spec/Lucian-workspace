"use client";

/* LilithLayer — global Lilith wrapper mounted at the AppShell level.
 *
 * Renders the orb (via LilithMotion) and, when the panel is open, the
 * LilithChatPanel. This layer persists across all route changes because
 * it's a sibling of {children} in AppShell, not a child of any routed page.
 *
 * z-index hierarchy:
 *   - Lilith orb + panel: z-[100] / z-[101]
 *   - Settings modal + other dialogs: z-50 (higher than orb)
 *   - Normal page content: default
 *
 * This means Lilith floats above page content but dialogs/settings
 * still appear above Lilith — which is the correct stacking order.
 */

import { useEffect, useRef, useState } from "react";
import { useRestoredAssistantReady } from "@/components/assistant/restored-agent-bridge";
import { useLilithStore, getSizePx } from "@/store/lilith";
import { LilithMotion } from "./lilith-motion";
import { LilithOrbMounted } from "./lilith-orb";
import { LilithChatPanel } from "./lilith-chat-panel";

export function LilithLayer() {
  const assistantReady=useRestoredAssistantReady();
  const visible = useLilithStore((s) => s.settings.visible);
  const panelOpen = useLilithStore((s) => s.panelOpen);
  const setPanelOpen = useLilithStore((s) => s.setPanelOpen);
  const size = useLilithStore((s) => s.settings.size);
  const orbSize = getSizePx(size);

  // Track the orb's actual screen position so the chat panel can
  // position itself relative to it.
  const orbRef = useRef<HTMLDivElement>(null);
  const [orbPos, setOrbPos] = useState({ x: 0, y: 0 });

  // Update orb position whenever the panel opens or the orb moves.
  useEffect(() => {
    if (!panelOpen || !orbRef.current) return;
    const update = () => {
      if (!orbRef.current) return;
      const rect = orbRef.current.firstElementChild?.getBoundingClientRect();
      if (!rect) return;
      setOrbPos({ x: rect.left, y: rect.top });
    };
    update();
    // Re-check on resize.
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [panelOpen]);

  // Close panel on Escape.
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panelOpen, setPanelOpen]);

  if (!visible || !assistantReady) return null;

  return (
    <>
      {/* The orb itself (draggable) */}
      <div ref={orbRef}>
        <LilithMotion onClick={() => setPanelOpen(!panelOpen)}>
          <LilithOrbMounted />
        </LilithMotion>
      </div>

      {/* Chat panel (renders beside the orb when open) */}
      {panelOpen && (
        <LilithChatPanel
          orbX={orbPos.x}
          orbY={orbPos.y}
          orbSize={orbSize}
        />
      )}
    </>
  );
}
