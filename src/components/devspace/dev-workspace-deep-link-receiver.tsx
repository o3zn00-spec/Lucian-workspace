"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspace";
import { getProject } from "@/lib/workspace/db";

/**
 * DevWorkspace deep-link receiver — Phase 9.
 *
 * Supports:
 *   /dev-workspace?project=<projectId>
 *     → load the project from IndexedDB, switch the workspace view to
 *       "workspace", and select the project as active.
 *
 *   /dev-workspace?project=<projectId>&file=<path>
 *     → same as above, AND open the file in the editor (as a tab + active).
 *
 * Because IndexedDB access is asynchronous, the receiver waits for the
 * project load to complete before opening the file. It will retry on
 * every render that observes the param being still present, but only
 * actually loads each unique project id ONCE (guarded by `appliedRef`).
 *
 * If the project or file no longer exists, the receiver:
 *   - strips the param from the URL (so a refresh doesn't re-trigger)
 *   - does NOT crash
 *   - shows an honest LUCIAN state (the project list view if no project,
 *     the workspace with no open file if the file is missing).
 *
 * The Phase 8 handoff receiver (?handoff=<id>) lives in
 * `app/(app)/dev-workspace/page.tsx` and is independent of this one.
 *
 * Must be rendered inside a <Suspense> boundary because it uses
 * useSearchParams().
 */
export function DevWorkspaceDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const appliedProjectRef = useRef<string | null>(null);
  const appliedFileRef = useRef<string | null>(null);

  useEffect(() => {
    const projectId = searchParams.get("project");
    const filePath = searchParams.get("file");

    if (!projectId) return;

    // ── Step 1: load + select the project ──
    if (appliedProjectRef.current !== projectId) {
      // Kick off the async load. We can't await inside the effect body
      // directly, but we can use a self-invoking async function.
      void (async () => {
        let project;
        try {
          project = await getProject(projectId);
        } catch {
          // IndexedDB error — leave the user in the library view.
          project = undefined;
        }
        if (!project) {
          // Project doesn't exist. Strip the params and bail — do NOT
          // fabricate a project.
          const next = new URLSearchParams(searchParams.toString());
          next.delete("project");
          next.delete("file");
          const qs = next.toString();
          router.replace(qs ? `${pathname}?${qs}` : pathname);
          appliedProjectRef.current = projectId;
          return;
        }

        // Ensure the workspace store's projects array contains this
        // project (the store refreshes its list on mount, but the user
        // might have followed a deep link before that completed). Merge
        // only if missing — we never replace the store's array blindly.
        const store = useWorkspaceStore.getState();
        if (!store.projects.some((p) => p.id === projectId)) {
          store.refreshProjects();
        }
        // Open the project: this switches the view to "workspace" and
        // sets activeProjectId / activeProject.
        await store.openProject(projectId);
        appliedProjectRef.current = projectId;

        // If a file was requested too, open it now (the project must
        // be active first).
        if (filePath && appliedFileRef.current !== `${projectId}:${filePath}`) {
          const activeProject = useWorkspaceStore.getState().activeProject;
          // Only open the file if it actually exists in the project's
          // file index. Otherwise the user gets the project workspace
          // with no file open (an honest state).
          if (activeProject && activeProject.files.some((f) => f.path === filePath)) {
            useWorkspaceStore.getState().openTab(filePath);
          }
          appliedFileRef.current = `${projectId}:${filePath}`;
        }

        // Strip both params AFTER everything is applied.
        const next = new URLSearchParams(searchParams.toString());
        next.delete("project");
        next.delete("file");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      })();
    } else if (filePath && appliedFileRef.current !== `${projectId}:${filePath}`) {
      // Project already applied (e.g. on a re-render). Just open the file.
      void (async () => {
        const activeProject = useWorkspaceStore.getState().activeProject;
        if (activeProject && activeProject.files.some((f) => f.path === filePath)) {
          useWorkspaceStore.getState().openTab(filePath);
        }
        appliedFileRef.current = `${projectId}:${filePath}`;
        const next = new URLSearchParams(searchParams.toString());
        next.delete("project");
        next.delete("file");
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      })();
    }
  }, [searchParams, router, pathname]);

  return null;
}
