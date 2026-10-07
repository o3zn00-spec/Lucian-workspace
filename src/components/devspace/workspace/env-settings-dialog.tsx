"use client";

import { useState } from "react";
import { Plus, Trash2, KeyRound, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { useWorkspaceStore } from "@/store/workspace";
import { toast } from "@/hooks/use-toast";
import type { EnvVar } from "@/types/workspace";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function EnvSettingsDialog({ open, onOpenChange }: Props) {
  const { activeProject, updateProjectEnv } = useWorkspaceStore();
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [lastOpen, setLastOpen] = useState(false);

  // Sync the local form state when the dialog opens. We track the previous
  // open state to avoid clobbering edits while the dialog is still open.
  // This is the "adjusting state when prop changes" pattern from the React docs.
  if (open && !lastOpen && activeProject) {
    setVars([...activeProject.envVars]);
    setLastOpen(true);
  }
  if (!open && lastOpen) {
    setLastOpen(false);
  }

  if (!activeProject) return null;

  const addVar = () => setVars((v) => [...v, { key: "", value: "" }]);
  const removeVar = (idx: number) => setVars((v) => v.filter((_, i) => i !== idx));
  const updateVar = (idx: number, field: keyof EnvVar, value: string) =>
    setVars((v) => v.map((x, i) => (i === idx ? { ...x, [field]: value } : x)));

  const handleSave = async () => {
    const filtered = vars.filter((v) => v.key.trim());
    await updateProjectEnv(activeProject.id, filtered);
    toast({
      title: "Environment variables saved",
      description: `${filtered.length} variable${filtered.length !== 1 ? "s" : ""} set`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Environment Variables
          </DialogTitle>
          <DialogDescription>
            These are injected into the preview as <code>window.__ENV_VARS__</code> and
            <code> process.env</code> when the project runs in <strong>Real</strong> mode.
            Use this for API keys like <code>SUPABASE_URL</code> or
            <code> FIREBASE_API_KEY</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {vars.length === 0 && (
            <div className="rounded-md border border-dashed border-muted/40 p-6 text-center text-sm text-muted-foreground">
              No variables yet. Click &quot;Add Variable&quot; below.
            </div>
          )}
          {vars.map((v, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                placeholder="KEY"
                value={v.key}
                onChange={(e) => updateVar(idx, "key", e.target.value.toUpperCase())}
                className="font-mono text-sm"
              />
              <Input
                placeholder="value"
                value={v.value}
                onChange={(e) => updateVar(idx, "value", e.target.value)}
                className="font-mono text-sm"
                type="password"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeVar(idx)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium text-foreground">Security note</p>
            <p className="mt-1">
              Variables are stored in your browser&apos;s IndexedDB. They are only injected into
              the sandboxed preview iframe — never sent to a server. Use Real mode only when you
              trust the imported project.
            </p>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <Button variant="outline" onClick={addVar}>
            <Plus className="mr-1 h-4 w-4" /> Add Variable
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Unused import shim so `Label` doesn't get tree-shaken before we wire it in.
void Label;
