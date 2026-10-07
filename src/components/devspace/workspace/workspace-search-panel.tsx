"use client";

import { useMemo, useState } from "react";
import { CaseSensitive, FileSearch, Loader2, Replace, Search } from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface Match {
  path: string;
  line: number;
  preview: string;
}

function findMatches(
  files: Awaited<ReturnType<ReturnType<typeof useWorkspaceStore.getState>["getActiveProjectFiles"]>>,
  query: string,
  caseSensitive: boolean,
): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  for (const file of files) {
    if (file.binary) continue;
    for (const [index, sourceLine] of file.content.split("\n").entries()) {
      const line = caseSensitive ? sourceLine : sourceLine.toLowerCase();
      if (!line.includes(needle)) continue;
      matches.push({ path: file.path, line: index + 1, preview: sourceLine.trim().slice(0, 180) });
      if (matches.length >= 1_000) return matches;
    }
  }
  return matches;
}

export function WorkspaceSearchPanel({ onOpenCode }: { onOpenCode: () => void }) {
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const getActiveProjectFiles = useWorkspaceStore((state) => state.getActiveProjectFiles);
  const replaceAllText = useWorkspaceStore((state) => state.replaceAllText);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const filesWithMatches = useMemo(() => new Set(matches.map((match) => match.path)).size, [matches]);

  const runSearch = async () => {
    if (!query || !activeProject) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      setMatches(findMatches(await getActiveProjectFiles(), query, caseSensitive));
    } catch (error) {
      toast({ title: "Search failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSearching(false);
    }
  };

  const replaceAll = async () => {
    if (!query || !activeProject) return;
    if (!confirm(`Replace every match in ${filesWithMatches} file${filesWithMatches === 1 ? "" : "s"}? A recovery snapshot will be created first.`)) return;
    setReplacing(true);
    try {
      const result = await replaceAllText(query, replacement, caseSensitive);
      toast({
        title: "Replace complete",
        description: `${result.replacements} replacement${result.replacements === 1 ? "" : "s"} across ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"}.`,
      });
      await runSearch();
    } catch (error) {
      toast({ title: "Replace failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setReplacing(false);
    }
  };

  const openMatch = (match: Match) => {
    window.sessionStorage.setItem("lucian:workspace:reveal-line", JSON.stringify({ path: match.path, line: match.line }));
    openTab(match.path);
    onOpenCode();
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label="Project search and replace">
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void runSearch()}
              placeholder="Search all text files"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant={caseSensitive ? "default" : "outline"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setCaseSensitive((value) => !value)}
            title="Match case"
          >
            <CaseSensitive className="h-4 w-4" />
          </Button>
          <Button size="sm" className="h-8" onClick={() => void runSearch()} disabled={searching || !query}>
            {searching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
            Find
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="Replace with"
            className="h-8 min-w-0 flex-1 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void replaceAll()}
            disabled={replacing || !query || matches.length === 0}
          >
            {replacing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Replace className="mr-1.5 h-3.5 w-3.5" />}
            Replace all
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {matches.length ? `${matches.length}${matches.length === 1_000 ? "+" : ""} matching lines in ${filesWithMatches} files` : "Search skips binary files. Replace All creates a recovery snapshot."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!matches.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <FileSearch className="h-9 w-9 opacity-35" />
            <p className="text-sm">Find text across the entire project</p>
            <p className="text-xs">Monaco’s Ctrl/Cmd+F remains available for the current file.</p>
          </div>
        ) : matches.map((match, index) => (
          <button
            key={`${match.path}:${match.line}:${index}`}
            type="button"
            onClick={() => openMatch(match)}
            className="flex w-full flex-col gap-0.5 border-b border-border/40 px-3 py-2 text-left hover:bg-accent/50"
          >
            <span className="font-mono text-[11px] font-medium text-primary">{match.path}:{match.line}</span>
            <span className={cn("w-full truncate font-mono text-[11px] text-muted-foreground", !match.preview && "italic")}>{match.preview || "Empty matching line"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
