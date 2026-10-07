"use client";

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  sendToLilith,
  type ContextRef,
  type StaticContext,
} from "@/lib/cross-module-bridge";
import { cn } from "@/lib/utils";

interface ModuleLilithButtonProps {
  prompt: string;
  label?: string;
  staticContext?: StaticContext[];
  contextRefs?: ContextRef[];
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

/** One consistent, non-destructive entry point into the global Lilith panel. */
export function ModuleLilithButton({
  prompt,
  label = "Ask Lilthe",
  staticContext,
  contextRefs,
  className,
  variant = "secondary",
  size = "sm",
}: ModuleLilithButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn("shrink-0", className)}
      onClick={() => sendToLilith({ prompt, staticContext, contextRefs, autoSend: false })}
    >
      <Bot className="mr-1.5 h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
