"use client";

// Empty state shown when the user opens the Workspace tab without an
// active project. Prevents the Workspace panes (file explorer / editor /
// preview) from crashing on null project references.

import { FolderOpen } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui-devspace/button";

export function WorkspaceEmptyState() {
  const setView = useWorkspaceStore((s) => s.setView);
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center justify-center gap-4 p-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <FolderOpen className="h-8 w-8 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">No project loaded</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Open or import a project from Project Library to start working.
          </p>
        </div>
        <Button onClick={() => setView("library")}>
          <FolderOpen className="mr-2 h-4 w-4" /> Go to Project Library
        </Button>
      </div>
    </div>
  );
}
