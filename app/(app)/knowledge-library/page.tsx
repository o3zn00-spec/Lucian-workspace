"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  BookOpen, ArrowLeft, Clock, CheckCircle2, Search, Plus,
  Highlighter, Bookmark, X, ChevronRight, FileText, Star,
  Loader2, AlertCircle, Upload, Trash2, StickyNote,
} from "lucide-react";
import { KNOWLEDGE_ITEMS, KNOWLEDGE_CATEGORIES, type KnowledgeItem, type KnowledgeProgress } from "@/lib/knowledge-data";
import {
  type KnowledgeMaterial,
  type KnowledgeHighlight,
  type KnowledgeNote,
  getAllMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  getHighlightsForMaterial,
  createHighlight,
  deleteHighlight,
  getAllHighlights,
  getNotesForMaterial,
  createNote,
  updateNote,
  deleteNote,
  getAllNotes,
} from "@/lib/knowledge/materials";
import { parseFile, toMaterialInput, ParseError } from "@/lib/knowledge/parsers";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";


const STORAGE_KEY = "lucian-knowledge-progress";

function loadProgress(): Record<string, KnowledgeProgress> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveProgress(p: Record<string, KnowledgeProgress>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

type View = "home" | "reading" | "highlights" | "notes" | "material-reading";

export default function KnowledgeLibraryPageWrapper() {
  return (
    <>
      <Suspense fallback={null}>
        <KnowledgeDeepLinkReceiver />
      </Suspense>
      <KnowledgeLibraryPage />
    </>
  );
}

function KnowledgeDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const itemId = searchParams.get("item");
    if (!itemId) return;
    if (consumedRef.current === itemId) return;
    consumedRef.current = itemId;

    // Phase 9: check built-in items first.
    const item = KNOWLEDGE_ITEMS.find((i) => i.id === itemId);
    if (item) {
      window.dispatchEvent(new CustomEvent("lucian:knowledge-deeplink", { detail: itemId }));
    } else {
      // Phase 14: also dispatch for imported materials (the page will
      // look up the material in IndexedDB).
      window.dispatchEvent(new CustomEvent("lucian:knowledge-material-deeplink", { detail: itemId }));
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("item");
    const qs = next.toString();
    router.replace(qs ? `/knowledge-library?${qs}` : "/knowledge-library");
  }, [searchParams, router]);

  return null;
}

export function KnowledgeLibraryPage() {
  const [category, setCategory] = useState<string>("all");
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<KnowledgeMaterial | null>(null);
  const [view, setView] = useState<View>("home");
  const [search, setSearch] = useState("");
  const [materials, setMaterials] = useState<KnowledgeMaterial[]>([]);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);

  // Phase 14: progress is loaded lazily via useState initializer (no
  // setState-in-effect). The old code used a separate effect — we keep
  // the same behavior by initializing directly.
  const [progress, setProgress] = useState<Record<string, KnowledgeProgress>>(() => loadProgress());

  // Phase 14: load imported materials from IndexedDB.
  const refreshMaterials = useCallback(async () => {
    const mats = await getAllMaterials();
    setMaterials(mats);
  }, []);

  useEffect(() => {
    const item = selectedItem;
    const material = selectedMaterial;
    try {
      if (item) {
        sessionStorage.setItem("lucian-current-learning-context", [
          `Title: ${item.title}`,
          `Author: ${item.author}`,
          `Category: ${item.category}`,
          `Summary: ${item.summary}`,
          `Key ideas: ${item.keyIdeas.join("; ")}`,
          `Content: ${item.content.slice(0, 6000)}`,
        ].join("\n"));
      } else if (material) {
        sessionStorage.setItem("lucian-current-learning-context", [
          `Title: ${material.title}`,
          `Author: ${material.author || "unknown"}`,
          `Source: ${material.source || material.fileName || material.type}`,
          `Content: ${(material.textContent || "No extractable text.").slice(0, 6000)}`,
        ].join("\n"));
      }
    } catch { /* page context remains optional */ }
  }, [selectedItem, selectedMaterial]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshMaterials();
      if (!cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [refreshMaterials]);

  // Phase 9: listen for deep-link events.
  useEffect(() => {
    const handler = (e: Event) => {
      const itemId = (e as CustomEvent<string>).detail;
      if (!itemId) return;
      const item = KNOWLEDGE_ITEMS.find((i) => i.id === itemId);
      if (item) {
        setSelectedItem(item);
        setView("reading");
      }
    };
    const materialHandler = async (e: Event) => {
      const materialId = (e as CustomEvent<string>).detail;
      if (!materialId) return;
      const mat = await getMaterial(materialId);
      if (mat) {
        setSelectedMaterial(mat);
        setView("material-reading");
      }
    };
    window.addEventListener("lucian:knowledge-deeplink", handler as EventListener);
    window.addEventListener("lucian:knowledge-material-deeplink", materialHandler as EventListener);
    return () => {
      window.removeEventListener("lucian:knowledge-deeplink", handler as EventListener);
      window.removeEventListener("lucian:knowledge-material-deeplink", materialHandler as EventListener);
    };
  }, []);

  const updateProgress = useCallback((id: string, patch: Partial<KnowledgeProgress>) => {
    setProgress(prev => {
      const existing = prev[id] ?? { status: "reading" as const, progress: 0, notes: "", highlights: "", quotes: "" };
      const next = { ...prev, [id]: { ...existing, ...patch } };
      saveProgress(next);
      return next;
    });
  }, []);

  const openItem = (item: KnowledgeItem) => {
    try {
      sessionStorage.setItem("lucian-current-learning-context", [
        `Title: ${item.title}`,
        `Author: ${item.author}`,
        `Category: ${item.category}`,
        `Summary: ${item.summary}`,
        `Key ideas: ${item.keyIdeas.join("; ")}`,
        `Content: ${item.content.slice(0, 6000)}`,
      ].join("\n"));
    } catch { /* the reader still opens if storage is unavailable */ }
    setSelectedItem(item);
    setView("reading");
  };

  const openMaterial = (mat: KnowledgeMaterial) => {
    try {
      sessionStorage.setItem("lucian-current-learning-context", [
        `Title: ${mat.title}`,
        `Author: ${mat.author || "unknown"}`,
        `Source: ${mat.source || mat.fileName || mat.type}`,
        `Reading progress: ${mat.readingProgress ?? 0}%`,
        `Content: ${(mat.textContent || "No extractable text.").slice(0, 6000)}`,
      ].join("\n"));
    } catch { /* the reader still opens if storage is unavailable */ }
    setSelectedMaterial(mat);
    setView("material-reading");
  };

  const backToLibrary = () => {
    try { sessionStorage.removeItem("lucian-current-learning-context"); } catch { /* no-op */ }
    setSelectedItem(null);
    setSelectedMaterial(null);
    setView("home");
    void refreshMaterials();
  };

  const filteredItems = useMemo(() => {
    let list = KNOWLEDGE_ITEMS;
    if (category !== "all") list = list.filter(i => i.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q));
    }
    return list;
  }, [category, search]);

  const filteredMaterials = useMemo(() => {
    if (!search.trim()) return materials;
    const q = search.toLowerCase();
    return materials.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.textContent ?? "").toLowerCase().includes(q),
    );
  }, [materials, search]);

  const continueReading = useMemo(() =>
    KNOWLEDGE_ITEMS.filter(i => progress[i.id]?.status === "reading" && (progress[i.id]?.progress ?? 0) > 0)
      .sort((a, b) => (progress[b.id]?.progress ?? 0) - (progress[a.id]?.progress ?? 0)).slice(0, 4),
  [progress]);

  if (view === "highlights") {
    return <HighlightsView onBack={backToLibrary} onOpenMaterial={openMaterial} />;
  }

  if (view === "notes") {
    return <NotesView onBack={backToLibrary} onOpenMaterial={openMaterial} />;
  }

  if (view === "reading" && selectedItem) {
    return <ReadingView item={selectedItem} progress={progress[selectedItem.id]} onProgress={updateProgress} onBack={backToLibrary} />;
  }

  if (view === "material-reading" && selectedMaterial) {
    return <MaterialReadingView material={selectedMaterial} onBack={backToLibrary} />;
  }

  return (
    <div className="themed flex h-full min-h-0 bg-canvas text-fg">
      <aside className="hidden w-[200px] shrink-0 flex-col border-r border-line-muted bg-surface-2/40 lg:flex">
        <div className="shrink-0 px-3 py-3">
          <h2 className="text-[12px] font-semibold text-fg">Mindset Library</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <SidebarItem label="Home" icon={BookOpen} active={view === "home" && category === "all"} onClick={() => { setView("home"); setCategory("all"); }} />
          <SidebarItem label="All Library" icon={FileText} active={view === "home" && category === "all"} onClick={() => { setView("home"); setCategory("all"); }} />
          <div className="my-1 h-px bg-line-muted/60" />
          {KNOWLEDGE_CATEGORIES.map(cat => (
            <SidebarItem key={cat.id} label={cat.label} icon={BookOpen} active={view === "home" && category === cat.id} onClick={() => { setView("home"); setCategory(cat.id); }} />
          ))}
          <div className="my-1 h-px bg-line-muted/60" />
          <SidebarItem label="Highlights" icon={Highlighter} active={false} onClick={() => setView("highlights")} />
          <SidebarItem label="Notes" icon={StickyNote} active={false} onClick={() => setView("notes")} />
        </div>
        <div className="shrink-0 border-t border-line-muted p-2">
          <button onClick={() => setAddMaterialOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-fg-muted hover:bg-hover hover:text-fg">
            <Plus className="h-3.5 w-3.5" /> Add Material
          </button>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-[16px] font-semibold text-fg">Mindset Library</h1>
              <p className="mt-0.5 text-[11px] text-fg-muted">Learning, reflection and personal knowledge</p>
            </div>
            <div className="flex items-center gap-2">
              
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
                  className="rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
              </div>
            </div>
          </div>

          {/* Imported Materials (Phase 14) */}
          {filteredMaterials.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Imported Materials</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMaterials.map(mat => (
                  <button key={mat.id} onClick={() => openMaterial(mat)}
                    className="rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-fg">{mat.title}</p>
                        <p className="truncate text-[9px] text-fg-faint">{mat.author ?? mat.fileName ?? mat.type.toUpperCase()}</p>
                      </div>
                      <span className="shrink-0 rounded bg-surface-2 px-1 py-0.5 text-[8px] font-bold uppercase text-fg-faint">{mat.type}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] text-fg-muted">{(mat.textContent ?? "").slice(0, 100)}...</p>
                    {mat.readingProgress !== undefined && mat.readingProgress > 0 && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full bg-[var(--accent)]" style={{ width: `${mat.readingProgress}%` }} />
                        </div>
                        <span className="text-[9px] text-fg-faint">{mat.readingProgress}%</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Continue Reading */}
          {continueReading.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Continue Reading</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {continueReading.map(item => (
                  <button key={item.id} onClick={() => openItem(item)}
                    className="rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint">
                    <p className="truncate text-[12px] font-medium text-fg">{item.title}</p>
                    <p className="mt-0.5 truncate text-[9px] text-fg-faint">{item.author}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full bg-[var(--accent)]" style={{ width: `${progress[item.id]?.progress ?? 0}%` }} />
                      </div>
                      <span className="text-[9px] text-fg-faint">{progress[item.id]?.progress ?? 0}%</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category items */}
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            {category === "all" ? "All Library" : KNOWLEDGE_CATEGORIES.find(c => c.id === category)?.label}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map(item => {
              const p = progress[item.id];
              const isRead = p?.status === "read";
              return (
                <button key={item.id} onClick={() => openItem(item)}
                  className="rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-fg">{item.title}</p>
                      <p className="truncate text-[9px] text-fg-faint">{item.author}</p>
                    </div>
                    {isRead && <CheckCircle2 className="h-3 w-3 shrink-0 text-green-400" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] text-fg-muted">{item.summary}</p>
                  <div className="mt-2 flex items-center gap-2 text-[9px] text-fg-faint">
                    <span className="capitalize">{item.category}</span>
                    <span>·</span>
                    <span>{item.estimatedMinutes} min</span>
                    {p && p.progress > 0 && <><span>·</span><span>{p.progress}%</span></>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {addMaterialOpen && (
        <AddMaterialDialog
          onClose={() => setAddMaterialOpen(false)}
          onAdded={() => { void refreshMaterials(); setAddMaterialOpen(false); }}
        />
      )}
    </div>
  );
}

/* ═══ Add Material Dialog (Phase 14) ═══ */

function AddMaterialDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseFile(file);
      const materialInput = toMaterialInput(parsed);
      await createMaterial(materialInput);
      toast({ title: "Material imported", description: parsed.title });
      onAdded();
    } catch (err) {
      if (err instanceof ParseError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="themed w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line-muted px-4 py-3">
          <h2 className="text-[13px] font-semibold text-fg">Add Material</h2>
          <button type="button" aria-label="Close add material dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4">
          <p className="mb-3 text-[11px] text-fg-muted">
            Import a PDF, TXT, or EPUB file. Text is extracted locally — files never leave your browser.
          </p>
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center transition-colors",
              dragOver ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-line-muted hover:border-fg-faint",
            )}
          >
            {parsing ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                <p className="mt-2 text-[12px] text-fg-muted">Parsing file...</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-fg-faint" />
                <p className="mt-2 text-[12px] font-medium text-fg">Drop a file or click to browse</p>
                <p className="mt-1 text-[10px] text-fg-faint">PDF · TXT · EPUB (max 50MB)</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.text,.epub,application/pdf,text/plain,application/epub+zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ Highlights View (Phase 14) ═══ */

function HighlightsView({ onBack, onOpenMaterial }: { onBack: () => void; onOpenMaterial: (m: KnowledgeMaterial) => void }) {
  const [highlights, setHighlights] = useState<Array<KnowledgeHighlight & { material?: KnowledgeMaterial }>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const hls = await getAllHighlights();
      setHighlights(hls);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hls = await getAllHighlights();
        if (!cancelled) setHighlights(hls);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const handleDelete = async (id: string) => {
    await deleteHighlight(id);
    void refresh();
    toast({ title: "Highlight deleted" });
  };

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      <div className="shrink-0 flex items-center justify-between border-b border-line-muted px-4 py-2">
        <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </button>
        <h2 className="text-[12px] font-semibold text-fg">Highlights</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-fg-faint" />
          </div>
        ) : highlights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Highlighter className="h-10 w-10 text-fg-faint opacity-30" />
            <p className="mt-2 text-[12px] font-medium text-fg-muted">No highlights yet</p>
            <p className="mt-1 text-[11px] text-fg-faint">Open a material and select text to create a highlight.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {highlights.map(hl => (
              <div key={hl.id} className="rounded-md border border-line bg-surface p-3">
                <p className="text-[12px] text-fg" style={{ backgroundColor: hl.color ? `${hl.color}20` : undefined, padding: hl.color ? "2px 4px" : undefined, borderRadius: hl.color ? "2px" : undefined }}>
                  &ldquo;{hl.text}&rdquo;
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => hl.material && onOpenMaterial(hl.material)}
                    className="truncate text-[10px] text-[var(--accent)] hover:underline"
                  >
                    {hl.material?.title ?? "Unknown material"}
                  </button>
                  <button type="button" aria-label="Delete highlight" onClick={() => void handleDelete(hl.id)} className="text-fg-faint hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Notes View (Phase 14) ═══ */

function NotesView({ onBack, onOpenMaterial }: { onBack: () => void; onOpenMaterial: (m: KnowledgeMaterial) => void }) {
  const [notes, setNotes] = useState<Array<KnowledgeNote & { material?: KnowledgeMaterial }>>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const ns = await getAllNotes();
      setNotes(ns);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ns = await getAllNotes();
        if (!cancelled) setNotes(ns);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const handleDelete = async (id: string) => {
    await deleteNote(id);
    void refresh();
    toast({ title: "Note deleted" });
  };

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      <div className="shrink-0 flex items-center justify-between border-b border-line-muted px-4 py-2">
        <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Library
        </button>
        <h2 className="text-[12px] font-semibold text-fg">Notes</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-fg-faint" />
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <StickyNote className="h-10 w-10 text-fg-faint opacity-30" />
            <p className="mt-2 text-[12px] font-medium text-fg-muted">No notes yet</p>
            <p className="mt-1 text-[11px] text-fg-faint">Open a material and write notes to see them here.</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {notes.map(note => (
              <div key={note.id} className="rounded-md border border-line bg-surface p-3">
                <p className="text-[12px] text-fg">{note.text}</p>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => note.material && onOpenMaterial(note.material)}
                    className="truncate text-[10px] text-[var(--accent)] hover:underline"
                  >
                    {note.material?.title ?? "Unknown material"}
                  </button>
                  <button type="button" aria-label="Delete note" onClick={() => void handleDelete(note.id)} className="text-fg-faint hover:text-red-400">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ Material Reading View (Phase 14) ═══ */

function MaterialReadingView({ material, onBack }: { material: KnowledgeMaterial; onBack: () => void }) {
  const [fontSize, setFontSize] = useState(14);
  const [scrollProgress, setScrollProgress] = useState(material.readingProgress ?? 0);
  const [highlights, setHighlights] = useState<KnowledgeHighlight[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshHighlights = useCallback(async () => {
    const hls = await getHighlightsForMaterial(material.id);
    setHighlights(hls);
  }, [material.id]);

  const refreshNotes = useCallback(async () => {
    const ns = await getNotesForMaterial(material.id);
    setNotes(ns);
  }, [material.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hls = await getHighlightsForMaterial(material.id);
        const ns = await getNotesForMaterial(material.id);
        if (!cancelled) {
          setHighlights(hls);
          setNotes(ns);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [material.id, refreshHighlights, refreshNotes]);

  const handleScroll = useCallback(async () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.round((el.scrollTop / max) * 100) : 0;
    setScrollProgress(pct);
    await updateMaterial(material.id, { readingProgress: pct, status: pct >= 95 ? "read" : "reading" });
  }, [material.id]);

  const handleSelection = useCallback(async () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const text = selection.toString().trim();
    if (!text || text.length < 2) return;

    // Compute the character offset of the selection within the text content.
    // We use a simple heuristic: find the selected text in the material's
    // textContent. This works for most cases — for highly repetitive text
    // the offset may be approximate, but the highlight is still useful.
    const fullText = material.textContent ?? "";
    const startOffset = fullText.indexOf(text);
    if (startOffset < 0) return;
    const endOffset = startOffset + text.length;

    const hl = await createHighlight({
      materialId: material.id,
      text,
      startOffset,
      endOffset,
      color: "yellow",
    });
    setHighlights(prev => [...prev, hl].sort((a, b) => a.startOffset - b.startOffset));
    selection.removeAllRanges();
    toast({ title: "Highlight saved" });
  }, [material]);

  const handleAddNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text) return;
    const note = await createNote({
      materialId: material.id,
      text,
    });
    setNotes(prev => [...prev, note]);
    setNoteText("");
    toast({ title: "Note saved" });
  }, [material.id, noteText]);

  const handleDeleteHighlight = async (id: string) => {
    await deleteHighlight(id);
    void refreshHighlights();
  };

  const handleDeleteNote = async (id: string) => {
    await deleteNote(id);
    void refreshNotes();
  };

  // Render the text content with highlights applied.
  // We build an array of text segments — highlighted segments get a
  // yellow background.
  const renderContent = () => {
    const text = material.textContent ?? "";
    if (highlights.length === 0) return text;
    // Sort highlights by start offset.
    const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);
    const segments: { text: string; highlighted: boolean; hl?: KnowledgeHighlight }[] = [];
    let pos = 0;
    for (const hl of sorted) {
      if (hl.startOffset > pos) {
        segments.push({ text: text.slice(pos, hl.startOffset), highlighted: false });
      }
      segments.push({ text: text.slice(hl.startOffset, hl.endOffset), highlighted: true, hl });
      pos = hl.endOffset;
    }
    if (pos < text.length) {
      segments.push({ text: text.slice(pos), highlighted: false });
    }
    return segments.map((seg, i) =>
      seg.highlighted && seg.hl ? (
        <mark
          key={i}
          className="bg-yellow-200 dark:bg-yellow-900/40 cursor-pointer"
          title={`Click to delete: "${seg.hl.text.slice(0, 50)}..."`}
          onClick={() => void handleDeleteHighlight(seg.hl!.id)}
        >
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    );
  };

  return (
    <div className="themed flex h-full min-h-0 bg-canvas text-fg">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 flex items-center justify-between border-b border-line-muted px-4 py-2">
          <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> Library
          </button>
          <div className="flex items-center gap-2">
            
            <button onClick={() => setFontSize(f => Math.max(12, f - 1))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">A−</button>
            <span className="text-[10px] text-fg-faint">{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(20, f + 1))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">A+</button>
            <div className="h-3 w-px bg-line-muted" />
            <button onClick={() => void handleSelection()} className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-[var(--accent)] hover:bg-[var(--accent)]/10" title="Highlight selected text">
              <Highlighter className="h-3 w-3" /> Highlight
            </button>
            <div className="h-3 w-px bg-line-muted" />
            <span className="text-[10px] text-fg-faint">{scrollProgress}%</span>
          </div>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            <h1 className="text-[20px] font-bold text-fg">{material.title}</h1>
            {material.author && <p className="mt-1 text-[12px] text-fg-muted">By {material.author}</p>}
            {material.chapters && material.chapters.length > 0 && (
              <div className="mt-2 text-[10px] text-fg-faint">{material.chapters.length} chapters/pages</div>
            )}
            <div
              className="mt-4 whitespace-pre-wrap text-fg"
              style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}
            >
              {renderContent()}
            </div>
          </div>
        </div>
      </div>
      <aside className="hidden w-[220px] shrink-0 flex-col border-l border-line-muted bg-surface-2/40 lg:flex">
        <div className="shrink-0 border-b border-line-muted px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Notebook</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <label className="text-[10px] font-medium text-fg-muted">Add Note</label>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleAddNote(); }}
              placeholder="Write a note... (Cmd+Enter to save)" rows={3}
              className="mt-1 w-full resize-none rounded border border-line bg-surface p-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
            <button onClick={() => void handleAddNote()} disabled={!noteText.trim()}
              className="mt-1 flex items-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-medium text-[var(--accent-fg)] disabled:opacity-40">
              <Plus className="h-3 w-3" /> Save Note
            </button>
          </div>
          {notes.length > 0 && (
            <div>
              <label className="text-[10px] font-medium text-fg-muted">Notes ({notes.length})</label>
              <div className="mt-1 space-y-1">
                {notes.map(n => (
                  <div key={n.id} className="rounded border border-line bg-surface p-2">
                    <p className="text-[11px] text-fg">{n.text}</p>
                    <button onClick={() => void handleDeleteNote(n.id)} className="mt-1 text-[9px] text-fg-faint hover:text-red-400">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {highlights.length > 0 && (
            <div>
              <label className="text-[10px] font-medium text-fg-muted">Highlights ({highlights.length})</label>
              <div className="mt-1 space-y-1">
                {highlights.map(hl => (
                  <div key={hl.id} className="rounded border border-line bg-yellow-100/50 dark:bg-yellow-900/20 p-2">
                    <p className="text-[10px] text-fg">&ldquo;{hl.text.slice(0, 60)}{hl.text.length > 60 ? "..." : ""}&rdquo;</p>
                    <button onClick={() => void handleDeleteHighlight(hl.id)} className="mt-1 text-[9px] text-fg-faint hover:text-red-400">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ═══ Built-in Reading View (existing — preserved) ═══ */

function SidebarItem({ label, icon: Icon, active, onClick }: { label: string; icon: typeof BookOpen; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
        active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function ReadingView({ item, progress, onProgress, onBack }: {
  item: KnowledgeItem;
  progress?: KnowledgeProgress;
  onProgress: (id: string, patch: Partial<KnowledgeProgress>) => void;
  onBack: () => void;
}) {
  const [scrollProgress, setScrollProgress] = useState(progress?.progress ?? 0);
  const [fontSize, setFontSize] = useState(14);
  const [notes, setNotes] = useState(progress?.notes ?? "");
  const [highlights, setHighlights] = useState(progress?.highlights ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const max = el.scrollHeight - el.clientHeight;
    const pct = max > 0 ? Math.round((el.scrollTop / max) * 100) : 0;
    setScrollProgress(pct);
    const status = pct >= 95 ? "read" as const : "reading" as const;
    onProgress(item.id, { progress: pct, status, notes, highlights });
  }, [item.id, notes, highlights, onProgress]);

  return (
    <div className="themed flex h-full min-h-0 bg-canvas text-fg">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 flex items-center justify-between border-b border-line-muted px-4 py-2">
          <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> Library
          </button>
          <div className="flex items-center gap-2">
            
            <button onClick={() => setFontSize(f => Math.max(12, f - 1))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">A−</button>
            <span className="text-[10px] text-fg-faint">{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(20, f + 1))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">A+</button>
            <div className="h-3 w-px bg-line-muted" />
            <span className="text-[10px] text-fg-faint">{scrollProgress}%</span>
          </div>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-8">
            <h1 className="text-[20px] font-bold text-fg">{item.title}</h1>
            <p className="mt-1 text-[12px] text-fg-muted">By {item.author}</p>
            <div className="mt-4 whitespace-pre-wrap text-fg" style={{ fontSize: `${fontSize}px`, lineHeight: 1.7 }}>{item.content}</div>
            <div className="mt-8 rounded-md border border-line bg-surface p-4">
              <h3 className="mb-2 text-[12px] font-semibold text-fg">Key Ideas</h3>
              <ul className="space-y-1">
                {item.keyIdeas.map((idea, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-fg-muted">
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--accent)]" /> {idea}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <aside className="hidden w-[200px] shrink-0 flex-col border-l border-line-muted bg-surface-2/40 lg:flex">
        <div className="shrink-0 border-b border-line-muted px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Notebook</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
          <div>
            <label className="text-[10px] font-medium text-fg-muted">Notes</label>
            <textarea value={notes} onChange={e => { setNotes(e.target.value); onProgress(item.id, { notes: e.target.value }); }}
              placeholder="Write notes..." rows={4}
              className="mt-1 w-full resize-none rounded border border-line bg-surface p-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
          </div>
          <div>
            <label className="text-[10px] font-medium text-fg-muted">Highlights</label>
            <textarea value={highlights} onChange={e => { setHighlights(e.target.value); onProgress(item.id, { highlights: e.target.value }); }}
              placeholder="Save important passages..." rows={4}
              className="mt-1 w-full resize-none rounded border border-line bg-surface p-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
          </div>
        </div>
      </aside>
    </div>
  );
}
