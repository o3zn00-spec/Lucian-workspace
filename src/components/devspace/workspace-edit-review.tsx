"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import type { WorkspaceEdit } from "@/lib/assistant/workspace-edits";
import { getProject, getFileContent } from "@/lib/workspace/db";
import { useWorkspaceStore } from "@/store/workspace";

export function WorkspaceEditReview() {
  const params = useSearchParams(), router = useRouter();
  const id = params.get("editProposal");
  const [proposal, setProposal] = useState<WorkspaceEdit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetch(`/api/assistant/workspace-edit?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { const result = await r.json(); if (!r.ok) throw new Error(result.error ?? "Review unavailable."); return result.proposal as WorkspaceEdit; })
      .then(p => { if (!controller.signal.aborted) { setProposal(p); setConfirmed(false); setError(""); } })
      .catch(e => { if (!controller.signal.aborted) { setProposal(null); setError(e instanceof Error ? e.message : "Review unavailable."); } });
    return () => controller.abort();
  }, [id]);
  const close = () => { const next = new URLSearchParams(params.toString()); next.delete("editProposal"); router.replace(`/dev-workspace${next.size ? `?${next}` : ""}`); };
  const apply = async () => {
    if (!proposal || proposal.id !== id || busy || !confirmed) return;
    setBusy(true); setError("");
    try {
      const state = useWorkspaceStore.getState();
      if (state.activeProjectId === proposal.projectId && state.openTabs.some(t => t.dirty)) throw new Error("Save your open editor changes before applying this proposal.");
      const local = await getProject(proposal.projectId);
      const localText = local ? await getFileContent(proposal.projectId, proposal.path) : undefined;
      if (local && (local.updatedAt > proposal.projectUpdatedAt || (localText !== undefined && localText !== proposal.before))) throw new Error("This browser has newer local edits. Sync and request a fresh proposal; local work has been preserved.");
      const response = await fetch("/api/assistant/workspace-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, confirmed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Apply unavailable.");
      setProposal(result.proposal); setConfirmed(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to apply the proposal."); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open={Boolean(id)} onOpenChange={open => { if (!open && !busy) close(); }}>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60" />
      <Dialog.Content className="themed fixed inset-x-3 top-[5vh] z-[151] mx-auto flex max-h-[90vh] max-w-5xl flex-col gap-3 rounded-xl border border-line bg-surface p-5 text-fg shadow-pop">
        <Dialog.Title className="text-lg font-semibold">Review Lilthe’s file change</Dialog.Title>
        <Dialog.Description className="text-sm text-fg-muted">One synced text file. Applying saves the cloud copy; it does not run code, commit or publish.</Dialog.Description>
        {proposal?.id === id && <>
          <p className="break-all text-sm">{proposal.projectName} · {proposal.path} · revision {proposal.revision}</p>
          <p className="text-sm text-fg-muted">{proposal.reason}</p>
          <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-2">
            {[{ label: "Before", text: proposal.before }, { label: "Proposed", text: proposal.after }].map(p => <section key={p.label} className="min-w-0 rounded border border-line p-3"><h3 className="mb-2 font-medium">{p.label}</h3><pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-all text-xs">{p.text}</pre></section>)}
          </div>
          {proposal.status === "applied" ? <p role="status" className="text-sm">Applied to cloud revision {proposal.appliedRevision}. Reopen the synced project to load the change. Local editor drafts remain separate.</p> :
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />I reviewed the complete change and want to save this cloud file.</label>}
        </>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!proposal && !error && <p role="status">Loading proposal…</p>}
        <div className="flex justify-end gap-3">
          <Dialog.Close asChild><button type="button" disabled={busy} className="rounded border border-line px-4 py-2">Close</button></Dialog.Close>
          <button type="button" onClick={() => void apply()} disabled={busy || !confirmed || proposal?.id !== id || proposal?.status !== "pending"} aria-busy={busy} className="rounded bg-[var(--accent)] px-4 py-2 text-black disabled:opacity-40">{busy ? "Saving…" : "Apply reviewed change"}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
