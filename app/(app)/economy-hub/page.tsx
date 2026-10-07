"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  X,
  ArrowLeft,
  Trash2,
  Check,
  FileText,
  Building2,
  FlaskConical,
  Activity as ActivityIcon,
  ExternalLink,
  Bot,
  LayoutGrid,
  ArrowRight,
  PenLine,
  FlaskConical as ResearchIcon,
} from "lucide-react";
import {
  useEconomyHubStore,
  PIPELINE_STATUSES,
  TERMINAL_STATUSES,
  ALL_STATUSES,
  STATUS_LABELS,
  BUSINESS_STATUS_LABELS,
  RESEARCH_TYPE_LABELS,
  type Opportunity,
  type Business,
  type ResearchRecord,
  type OpportunityStatus,
  type BusinessStatus,
  type ResearchType,
} from "@/store/economy-hub";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Textarea } from "@/components/ui-devspace/textarea";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  StatusBadge,
  BusinessStatusBadge,
  ScoreBadge,
  StatCard,
  PipelineStage,
  SectionTitle,
  EmptyState,
  formatTimeAgo,
} from "@/components/economy-hub/shared";

type Tab = "overview" | "opportunities" | "businesses" | "research";

export default function EconomyHubPageWrapper() {
  return (
    <>
      {/* Phase 9: deep-link receiver for /economy-hub?opportunity=<id> etc. */}
      <Suspense fallback={null}>
        <EconomyHubDeepLinkReceiver />
      </Suspense>
      <EconomyHubPage />
    </>
  );
}

/**
 * Phase 9: Economy Hub deep-link receiver.
 *
 * Reads one of `?opportunity=<id>`, `?business=<id>`, `?research=<id>`
 * on mount (or on URL change), validates the entity exists, dispatches
 * a CustomEvent so the inner page opens the right detail view, and
 * strips the param.
 *
 * If the entity no longer exists, the user lands on the corresponding tab
 * with no detail open — an honest LUCIAN state.
 */
function EconomyHubDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const opportunityId = searchParams.get("opportunity");
    const businessId = searchParams.get("business");
    const researchId = searchParams.get("research");

    const key = `${opportunityId ?? ""}|${businessId ?? ""}|${researchId ?? ""}`;
    if (!key.replace(/\|/g, "")) return;
    if (consumedRef.current === key) return;
    consumedRef.current = key;

    const store = useEconomyHubStore.getState();
    let detail: { type: "opportunity" | "business" | "research"; id: string } | null = null;
    if (opportunityId && store.opportunities.some((o) => o.id === opportunityId)) {
      detail = { type: "opportunity", id: opportunityId };
    } else if (businessId && store.businesses.some((b) => b.id === businessId)) {
      detail = { type: "business", id: businessId };
    } else if (researchId && store.researchRecords.some((r) => r.id === researchId)) {
      detail = { type: "research", id: researchId };
    }

    if (detail) {
      window.dispatchEvent(new CustomEvent("lucian:economy-deeplink", { detail }));
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("opportunity");
    next.delete("business");
    next.delete("research");
    const qs = next.toString();
    router.replace(qs ? `/economy-hub?${qs}` : "/economy-hub");
  }, [searchParams, router]);

  return null;
}

export function EconomyHubPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedOpp, setSelectedOpp] = useState<string | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<string | null>(null);
  const [selectedResearch, setSelectedResearch] = useState<string | null>(null);
  const [newOppOpen, setNewOppOpen] = useState(false);
  const [newBizOpen, setNewBizOpen] = useState(false);
  const [newResearchOpen, setNewResearchOpen] = useState(false);

  // Phase 9: listen for deep-link events from the outer receiver.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: "opportunity" | "business" | "research"; id: string }>).detail;
      if (!detail) return;
      if (detail.type === "opportunity") {
        setTab("opportunities");
        setSelectedOpp(detail.id);
        setSelectedBiz(null);
        setSelectedResearch(null);
      } else if (detail.type === "business") {
        setTab("businesses");
        setSelectedBiz(detail.id);
        setSelectedOpp(null);
        setSelectedResearch(null);
      } else if (detail.type === "research") {
        setTab("research");
        setSelectedResearch(detail.id);
        setSelectedOpp(null);
        setSelectedBiz(null);
      }
    };
    window.addEventListener("lucian:economy-deeplink", handler as EventListener);
    return () => window.removeEventListener("lucian:economy-deeplink", handler as EventListener);
  }, []);

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Header */}
      <div className="shrink-0 border-b border-line-muted px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-fg">Economy Hub</h1>
            <p className="mt-0.5 text-[12px] text-fg-muted">
              Discover, research, validate and operate economic opportunities.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tab === "businesses" && (
              <Button size="sm" variant="outline" onClick={() => setNewBizOpen(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add Business
              </Button>
            )}
            {tab === "research" && (
              <Button size="sm" variant="outline" onClick={() => setNewResearchOpen(true)}>
                <Plus className="mr-1 h-3 w-3" /> Add Research
              </Button>
            )}
            <Button size="sm" onClick={() => setNewOppOpen(true)}>
              <Plus className="mr-1 h-3 w-3" /> New Opportunity
            </Button>
          </div>
        </div>
        {/* Tabs */}
        <div className="mt-2 flex gap-1">
          {([
            ["overview", "Overview"],
            ["opportunities", "Opportunities"],
            ["businesses", "Businesses"],
            ["research", "Research"],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setSelectedOpp(null); setSelectedBiz(null); setSelectedResearch(null); }}
              className={cn(
                "border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors",
                tab === id
                  ? "border-[var(--accent)] text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Detail views override tabs */}
        {selectedOpp && tab === "opportunities" ? (
          <OpportunityDetail id={selectedOpp} onBack={() => setSelectedOpp(null)} />
        ) : selectedBiz && tab === "businesses" ? (
          <BusinessDetail id={selectedBiz} onBack={() => setSelectedBiz(null)} onSwitchTab={setTab} onSelectResearch={setSelectedResearch} />
        ) : selectedResearch && tab === "research" ? (
          <ResearchDetail id={selectedResearch} onBack={() => setSelectedResearch(null)} />
        ) : tab === "overview" ? (
          <OverviewTab
            onOpportunityClick={(id) => { setTab("opportunities"); setSelectedOpp(id); }}
            onBusinessClick={(id) => { setTab("businesses"); setSelectedBiz(id); }}
          />
        ) : tab === "opportunities" ? (
          <OpportunitiesTab onOpen={(id) => setSelectedOpp(id)} onNew={() => setNewOppOpen(true)} />
        ) : tab === "businesses" ? (
          <BusinessesTab onOpen={(id) => setSelectedBiz(id)} onNew={() => setNewBizOpen(true)} />
        ) : tab === "research" ? (
          <ResearchTab onOpen={(id) => setSelectedResearch(id)} onNew={() => setNewResearchOpen(true)} />
        ) : null}
      </div>

      {/* Dialogs */}
      {newOppOpen && <NewOppDialog onClose={() => setNewOppOpen(false)} onSwitchTab={setTab} />}
      {newBizOpen && <NewBizDialog onClose={() => setNewBizOpen(false)} />}
      {newResearchOpen && <NewResearchDialog onClose={() => setNewResearchOpen(false)} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Overview tab                                                      */
/* ════════════════════════════════════════════════════════════════ */

function OverviewTab({
  onOpportunityClick,
  onBusinessClick,
}: {
  onOpportunityClick: (id: string) => void;
  onBusinessClick: (id: string) => void;
}) {
  const store = useEconomyHubStore();
  const opportunities = useEconomyHubStore((s) => s.opportunities);
  const businesses = useEconomyHubStore((s) => s.businesses);
  const activities = useEconomyHubStore((s) => s.activities);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of ALL_STATUSES) c[s] = 0;
    for (const o of opportunities) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [opportunities]);

  const topOpps = useMemo(
    () => [...opportunities].filter(o => o.status !== "rejected" && o.status !== "failed").sort((a, b) => b.score - a.score).slice(0, 3),
    [opportunities],
  );

  const activeBiz = useMemo(
    () => businesses.filter(b => b.status === "operating" || b.status === "launching" || b.status === "building"),
    [businesses],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Stats */}
      <div>
        <SectionTitle>Economic Overview</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard label="Opportunities" value={opportunities.length} />
          <StatCard label="Researching" value={counts.researching ?? 0} />
          <StatCard label="Shortlisted" value={counts.shortlisted ?? 0} />
          <StatCard label="Businesses" value={businesses.length} />
          <StatCard label="Review" value={store.getNeedsReviewCount()} />
        </div>
      </div>

      {/* Pipeline */}
      <div>
        <SectionTitle>Opportunity Pipeline</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {PIPELINE_STATUSES.slice(0, 4).map((s) => (
            <PipelineStage key={s} label={STATUS_LABELS[s]} count={counts[s] ?? 0} />
          ))}
        </div>
        <div className="mt-1 flex items-center justify-center text-fg-faint">
          <ArrowRight className="h-3 w-3" />
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {PIPELINE_STATUSES.slice(4).map((s) => (
            <PipelineStage key={s} label={STATUS_LABELS[s]} count={counts[s] ?? 0} />
          ))}
        </div>
      </div>

      {/* Top opportunities */}
      <div>
        <SectionTitle>Top Opportunities</SectionTitle>
        {topOpps.length === 0 ? (
          <EmptyState title="No opportunities yet" description="Start with an idea and record your research." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {topOpps.map((opp) => (
              <OppCard key={opp.id} opp={opp} onClick={() => onOpportunityClick(opp.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Active businesses */}
      <div>
        <SectionTitle>Active Businesses</SectionTitle>
        {activeBiz.length === 0 ? (
          <EmptyState title="No active businesses" description="Approved opportunities can become businesses once they reach the building/launch stage." />
        ) : (
          <div className="space-y-2">
            {activeBiz.map((biz) => (
              <BizCard key={biz.id} biz={biz} onClick={() => onBusinessClick(biz.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <SectionTitle>Recent Economic Activity</SectionTitle>
        {activities.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-fg-faint">No activity yet.</p>
        ) : (
          <div className="divide-y divide-line-muted/60 rounded-md border border-line bg-surface">
            {activities.slice(0, 8).map((act) => (
              <div key={act.id} className="flex items-center gap-2 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-fg">{act.message}</p>
                </div>
                <span className="shrink-0 text-[9px] text-fg-faint">{formatTimeAgo(act.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OppCard({ opp, onClick }: { opp: Opportunity; onClick: () => void }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 transition-colors hover:border-fg-faint">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[12px] font-medium text-fg hover:text-[var(--accent)]">{opp.name}</p>
        </button>
        <StatusBadge status={opp.status} />
      </div>
      <div className="mt-2 space-y-0.5 text-[10px]">
        <Row label="Score"><ScoreBadge score={opp.score} /></Row>
        <Row label="Demand"><span className="capitalize text-fg-muted">{opp.demand}</span></Row>
        <Row label="Competition"><span className="capitalize text-fg-muted">{opp.competition}</span></Row>
        {opp.startupCostMax > 0 && (
          <Row label="Startup Cost">
            <span className="font-mono text-fg-muted">${opp.startupCostMin}–{opp.startupCostMax}</span>
          </Row>
        )}
        <Row label="Difficulty"><span className="capitalize text-fg-muted">{opp.technicalDifficulty}</span></Row>
      </div>
      <div className="mt-2 flex gap-1">
        <button onClick={onClick} className="rounded border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted hover:text-fg">Open</button>
        
      </div>
    </div>
  );
}

function BizCard({ biz, onClick }: { biz: Business; onClick: () => void }) {
  return (
    <div className="rounded-md border border-line bg-surface p-3 transition-colors hover:border-fg-faint">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[12px] font-medium text-fg hover:text-[var(--accent)]">{biz.name}</p>
        </button>
        <BusinessStatusBadge status={biz.status} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
        <div><span className="text-fg-faint">Revenue</span><div className="font-mono text-green-400">${biz.revenue}</div></div>
        <div><span className="text-fg-faint">Expenses</span><div className="font-mono text-red-400">${biz.expenses}</div></div>
        <div><span className="text-fg-faint">Profit</span><div className="font-mono text-fg">${biz.profit}</div></div>
      </div>
      <div className="mt-2 flex gap-1">
        <button onClick={onClick} className="rounded border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted hover:text-fg">Open</button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-faint">{label}</span>
      {children}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════ */
/* Opportunities tab                                                 */
/* ════════════════════════════════════════════════════════════════ */

function OpportunitiesTab({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const opportunities = useEconomyHubStore((s) => s.opportunities);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("newest");

  const filtered = useMemo(() => {
    let list = opportunities;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        o.notes.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter(o => o.status === statusFilter);
    }
    const sorted = [...list];
    if (sort === "newest") sorted.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "oldest") sorted.sort((a, b) => a.createdAt - b.createdAt);
    else if (sort === "score-high") sorted.sort((a, b) => b.score - a.score);
    else if (sort === "score-low") sorted.sort((a, b) => a.score - b.score);
    else if (sort === "updated") sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [opportunities, search, statusFilter, sort]);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Search + filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search opportunities..."
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <DropdownSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ value: "all", label: "All Status" }, ...ALL_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))]}
        />
        <DropdownSelect
          value={sort}
          onChange={setSort}
          options={[
            { value: "newest", label: "Newest" },
            { value: "oldest", label: "Oldest" },
            { value: "score-high", label: "Highest Score" },
            { value: "score-low", label: "Lowest Score" },
            { value: "updated", label: "Recently Updated" },
            { value: "name", label: "Name" },
          ]}
        />
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No opportunities found"
          description={search || statusFilter !== "all" ? "Try adjusting your filters." : "Start with an idea and record your research."}
          action={<Button size="sm" onClick={onNew}><Plus className="mr-1 h-3 w-3" /> New Opportunity</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          {/* Header row */}
          <div className="hidden grid-cols-[2fr_1fr_0.5fr_0.5fr_1fr_0.5fr] gap-2 border-b border-line-muted px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-fg-faint sm:grid">
            <span>Opportunity</span>
            <span>Status</span>
            <span>Score</span>
            <span>Demand</span>
            <span>Cost</span>
            <span>Updated</span>
          </div>
          {filtered.map((opp) => (
            <button
              key={opp.id}
              type="button"
              onClick={() => onOpen(opp.id)}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-line-muted/60 px-3 py-2 text-left transition-colors last:border-0 hover:bg-hover sm:grid-cols-[2fr_1fr_0.5fr_0.5fr_1fr_0.5fr]"
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-fg">{opp.name}</p>
                <p className="truncate text-[10px] text-fg-faint">{opp.category}</p>
              </div>
              <div className="hidden sm:block"><StatusBadge status={opp.status} /></div>
              <div className="hidden sm:block"><ScoreBadge score={opp.score} /></div>
              <div className="hidden text-[10px] capitalize text-fg-muted sm:block">{opp.demand}</div>
              <div className="hidden font-mono text-[10px] text-fg-muted sm:block">
                {opp.startupCostMax > 0 ? `$${opp.startupCostMin}–${opp.startupCostMax}` : "—"}
              </div>
              <div className="hidden text-[10px] text-fg-faint sm:block">{formatTimeAgo(opp.updatedAt)}</div>
              {/* Mobile: status + score inline */}
              <div className="flex items-center gap-2 sm:hidden">
                <StatusBadge status={opp.status} />
                <ScoreBadge score={opp.score} />
                <ChevronRight className="h-3 w-3 text-fg-faint" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Opportunity detail                                                */
/* ════════════════════════════════════════════════════════════════ */

function OpportunityDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const opp = useEconomyHubStore((s) => s.opportunities.find(o => o.id === id));
  const setOpportunityStatus = useEconomyHubStore((s) => s.setOpportunityStatus);
  const rejectOpportunity = useEconomyHubStore((s) => s.rejectOpportunity);
  const deleteOpportunity = useEconomyHubStore((s) => s.deleteOpportunity);
  const updateOpportunity = useEconomyHubStore((s) => s.updateOpportunity);
  const researchRecords = useEconomyHubStore((s) => s.researchRecords);
  const linkResearchToOpportunity = useEconomyHubStore((s) => s.linkResearchToOpportunity);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);

  if (!opp) return <EmptyState title="Opportunity not found" />;

  const linkedResearch = researchRecords.filter(r => opp.sourceResearchIds.includes(r.id));
  const unlinkedResearch = researchRecords.filter(r => !opp.sourceResearchIds.includes(r.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Back + title */}
      <div>
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3 w-3" /> Opportunities
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-fg">{opp.name}</h2>
          <StatusBadge status={opp.status} />
        </div>
      </div>

      {/* Score + attributes */}
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-fg">Opportunity Score</h3>
          <ScoreBadge score={opp.score} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-3">
          <DetailRow label="Demand" value={opp.demand} />
          <DetailRow label="Competition" value={opp.competition} />
          <DetailRow label="Startup Cost" value={opp.startupCostMax > 0 ? `$${opp.startupCostMin} – $${opp.startupCostMax}` : "—"} />
          <DetailRow label="Difficulty" value={opp.technicalDifficulty} />
          <DetailRow label="Build Time" value={opp.estimatedBuildTime || "—"} />
          <DetailRow label="Revenue Model" value={opp.revenueModel || "—"} />
          <DetailRow label="Customers" value={opp.potentialCustomers || "—"} />
        </div>
      </div>

      {/* Status changer */}
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-3">
        <span className="text-[11px] font-medium text-fg-muted">Status:</span>
        <DropdownSelect
          value={opp.status}
          onChange={(v) => setOpportunityStatus(id, v as OpportunityStatus)}
          options={ALL_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))}
        />
        <div className="flex-1" />
        <button
          onClick={() => setRejectOpen(true)}
          className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-500/10"
        >
          Reject
        </button>
      </div>

      {/* Description sections */}
      {opp.description && (
        <DetailSection title="Description">{opp.description}</DetailSection>
      )}
      {opp.whyOpportunityExists && (
        <DetailSection title="Why This Opportunity Exists">{opp.whyOpportunityExists}</DetailSection>
      )}
      {opp.marketNeed && (
        <DetailSection title="Market / Customer Need">{opp.marketNeed}</DetailSection>
      )}
      {opp.risks && (
        <DetailSection title="Main Risks">{opp.risks}</DetailSection>
      )}
      {opp.recommendedExperiment && (
        <DetailSection title="Recommended First Experiment">{opp.recommendedExperiment}</DetailSection>
      )}

      {/* Linked research */}
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-fg">Research</h3>
          {unlinkedResearch.length > 0 && (
            <button onClick={() => setAttachOpen(!attachOpen)} className="text-[10px] text-[var(--accent)] hover:underline">
              + Attach Research
            </button>
          )}
        </div>
        {linkedResearch.length === 0 ? (
          <p className="text-[11px] text-fg-faint">No research linked yet.</p>
        ) : (
          <div className="space-y-1">
            {linkedResearch.map(r => (
              <div key={r.id} className="flex items-center gap-2 rounded border border-line-muted bg-surface-2 px-2 py-1.5 text-[11px]">
                <FlaskConical className="h-3 w-3 text-fg-faint" />
                <span className="flex-1 truncate text-fg">{r.title}</span>
                <span className="text-[9px] text-fg-faint">{RESEARCH_TYPE_LABELS[r.type]}</span>
              </div>
            ))}
          </div>
        )}
        {attachOpen && (
          <div className="mt-2 space-y-1 border-t border-line-muted pt-2">
            {unlinkedResearch.map(r => (
              <button
                key={r.id}
                onClick={() => { linkResearchToOpportunity(id, r.id); setAttachOpen(false); toast({ title: "Research linked" }); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Plus className="h-3 w-3" />
                {r.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Agent recommendation */}
      

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        
        <button onClick={() => setOpportunityStatus(id, "shortlisted")} className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg">Shortlist</button>
        <button onClick={() => setOpportunityStatus(id, "testing")} className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg">Test</button>
        <button onClick={() => setOpportunityStatus(id, "approved")} className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10">Approve</button>
        <button onClick={() => {
          // Phase 8: real handoff to DevWorkspace with prototype brief.
          const { openInDevWorkspace } = require("@/lib/cross-module-bridge");
          openInDevWorkspace({
            prompt: `Prototype brief for: ${opp.name}`,
            staticContext: [{
              module: "economy-hub" as const,
              label: opp.name,
              content: [
                `PROTOTYPE BRIEF`,
                `Project: ${opp.name}`,
                `Problem: ${opp.marketNeed ?? opp.description ?? "—"}`,
                `Proposed solution: ${opp.revenueModel ?? "—"}`,
                `Target user: ${opp.potentialCustomers ?? "—"}`,
                `Startup cost: $${opp.startupCostMin ?? 0} - $${opp.startupCostMax ?? 0}`,
                `Risks: ${opp.risks ?? "—"}`,
                `Notes: ${opp.notes ?? "—"}`,
                `Recommended experiment: ${opp.recommendedExperiment ?? "—"}`,
              ].join("\n"),
            }],
            metadata: { opportunityId: opp.id, opportunityName: opp.name },
          });
        }} className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg">Build Prototype</button>
        <button type="button" aria-label="Delete opportunity" onClick={() => { deleteOpportunity(id); onBack(); }} className="ml-auto rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[var(--accent)] text-red-400 hover:bg-red-500/10">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Reject dialog */}
      {rejectOpen && (
        <Dialog open onOpenChange={() => setRejectOpen(false)}>
          <DialogContent showCloseButton={false} className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-[13px]">Reject Opportunity?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 p-4">
              <div>
                <Label className="text-[11px] text-fg-muted">Optional reason</Label>
                <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="mt-1 text-[12px]" rows={3} placeholder="Why is this being rejected?" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setRejectOpen(false)}>Cancel</Button>
                <Button size="sm" variant="destructive" onClick={() => { rejectOpportunity(id, rejectReason); setRejectOpen(false); toast({ title: "Opportunity rejected" }); }}>Reject</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="capitalize text-fg">{value}</span>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
      <div className="text-[12px] leading-relaxed text-fg">{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Businesses tab                                                    */
/* ════════════════════════════════════════════════════════════════ */

function BusinessesTab({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const businesses = useEconomyHubStore((s) => s.businesses);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = businesses;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b => b.name.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") list = list.filter(b => b.status === statusFilter);
    return list;
  }, [businesses, search, statusFilter]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search businesses..."
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <DropdownSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All Status" },
            ...Object.entries(BUSINESS_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No businesses yet"
          description="Approved opportunities can become businesses once they reach the building/launch stage."
          action={<Button size="sm" onClick={onNew}><Plus className="mr-1 h-3 w-3" /> Add Business</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map(biz => (
            <BizCard key={biz.id} biz={biz} onClick={() => onOpen(biz.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessDetail({ id, onBack, onSwitchTab, onSelectResearch }: { id: string; onBack: () => void; onSwitchTab: (tab: Tab) => void; onSelectResearch: (id: string) => void }) {
  const biz = useEconomyHubStore((s) => s.businesses.find(b => b.id === id));
  const updateBusiness = useEconomyHubStore((s) => s.updateBusiness);
  const opportunities = useEconomyHubStore((s) => s.opportunities);
  const researchRecords = useEconomyHubStore((s) => s.researchRecords);

  if (!biz) return <EmptyState title="Business not found" />;

  const sourceOpp = biz.sourceOpportunityId ? opportunities.find(o => o.id === biz.sourceOpportunityId) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3 w-3" /> Businesses
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-[16px] font-semibold text-fg">{biz.name}</h2>
          <BusinessStatusBadge status={biz.status} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase tracking-wide text-fg-faint">Revenue</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-green-400">${biz.revenue}</div>
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase tracking-wide text-fg-faint">Expenses</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-red-400">${biz.expenses}</div>
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase tracking-wide text-fg-faint">Profit</div>
          <div className="mt-1 font-mono text-[16px] font-bold text-fg">${biz.profit}</div>
        </div>
      </div>

      <div className="rounded-md border border-line bg-surface p-4 space-y-2 text-[11px]">
        <DetailRow label="Website" value={biz.website || "Not connected"} />
        <DetailRow label="LUCIAN Project" value={biz.projectId ? "Connected" : "Not connected"} />
        {sourceOpp && <DetailRow label="Source Opportunity" value={sourceOpp.name} />}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            // Phase 8: real navigation to DevWorkspace.
            const { openInDevWorkspace } = require("@/lib/cross-module-bridge");
            openInDevWorkspace({
              prompt: biz.projectId ? `Open project for business: ${biz.name}` : `Start a new project for business: ${biz.name}`,
              staticContext: [{
                module: "economy-hub" as const,
                label: biz.name,
                content: `Business: ${biz.name}\nStatus: ${biz.status}\nRevenue: $${biz.revenue ?? 0}\nExpenses: $${biz.expenses ?? 0}\nProfit: $${biz.profit ?? 0}`,
              }],
              metadata: { businessId: biz.id, businessName: biz.name, projectId: biz.projectId },
            });
          }}
          className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg"
        >
          Open DevWorkspace
        </button>
        {sourceOpp && (() => {
          // Phase 8: View Research — find actual linked research records.
          const linkedResearch = researchRecords.filter((r) =>
            r.relatedOpportunityIds?.includes(sourceOpp.id),
          );
          if (linkedResearch.length === 0) {
            return (
              <span className="rounded border border-dashed border-line-muted px-3 py-1.5 text-[11px] text-fg-faint">
                No linked research
              </span>
            );
          }
          return (
            <button
              onClick={() => {
                // Phase 8: switch to Research tab + select the first linked record.
                onSwitchTab("research");
                onSelectResearch(linkedResearch[0].id);
              }}
              className="rounded border border-line bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg"
            >
              View Research ({linkedResearch.length})
            </button>
          );
        })()}
        
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Research tab                                                      */
/* ════════════════════════════════════════════════════════════════ */

function ResearchTab({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const researchRecords = useEconomyHubStore((s) => s.researchRecords);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = useMemo(() => {
    let list = researchRecords;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => r.title.toLowerCase().includes(q) || r.summary.toLowerCase().includes(q));
    }
    if (typeFilter !== "all") list = list.filter(r => r.type === typeFilter);
    return list;
  }, [researchRecords, search, typeFilter]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search research..."
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <DropdownSelect
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "all", label: "All Types" },
            ...Object.entries(RESEARCH_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No saved research yet"
          description="Your saved research and manual entries will appear here."
          action={<Button size="sm" onClick={onNew}><Plus className="mr-1 h-3 w-3" /> Add Research</Button>}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map(rec => (
            <div key={rec.id} className="rounded-md border border-line bg-surface p-3 transition-colors hover:border-fg-faint">
              <button onClick={() => onOpen(rec.id)} className="w-full text-left">
                <p className="truncate text-[12px] font-medium text-fg hover:text-[var(--accent)]">{rec.title}</p>
                <p className="mt-0.5 text-[10px] text-[var(--accent)]">{RESEARCH_TYPE_LABELS[rec.type]}</p>
              </button>
              {rec.summary && <p className="mt-1 line-clamp-2 text-[10px] text-fg-muted">{rec.summary}</p>}
              <div className="mt-2 flex items-center justify-between text-[9px] text-fg-faint">
                <span>{rec.relatedOpportunityIds.length} opportunity links</span>
                <span>{formatTimeAgo(rec.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResearchDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const rec = useEconomyHubStore((s) => s.researchRecords.find(r => r.id === id));
  const opportunities = useEconomyHubStore((s) => s.opportunities);
  const businesses = useEconomyHubStore((s) => s.businesses);
  const deleteResearch = useEconomyHubStore((s) => s.deleteResearch);

  if (!rec) return <EmptyState title="Research not found" />;

  const linkedOpps = opportunities.filter(o => rec.relatedOpportunityIds.includes(o.id));
  const linkedBiz = businesses.filter(b => rec.relatedBusinessIds.includes(b.id));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <button onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
          <ArrowLeft className="h-3 w-3" /> Research
        </button>
        <h2 className="text-[16px] font-semibold text-fg">{rec.title}</h2>
        <p className="mt-0.5 text-[11px] text-[var(--accent)]">{RESEARCH_TYPE_LABELS[rec.type]}</p>
      </div>

      {rec.summary && <DetailSection title="Summary">{rec.summary}</DetailSection>}
      {rec.findings && <DetailSection title="Key Findings">{rec.findings}</DetailSection>}
      {rec.sources && <DetailSection title="Sources">{rec.sources}</DetailSection>}

      {linkedOpps.length > 0 && (
        <div className="rounded-md border border-line bg-surface p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Related Opportunities</h3>
          <div className="space-y-1">
            {linkedOpps.map(o => (
              <div key={o.id} className="flex items-center gap-2 text-[11px] text-fg">
                <ChevronRight className="h-3 w-3 text-fg-faint" />
                {o.name}
                <StatusBadge status={o.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {linkedBiz.length > 0 && (
        <div className="rounded-md border border-line bg-surface p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Related Businesses</h3>
          <div className="space-y-1">
            {linkedBiz.map(b => (
              <div key={b.id} className="flex items-center gap-2 text-[11px] text-fg">
                <ChevronRight className="h-3 w-3 text-fg-faint" />
                {b.name}
                <BusinessStatusBadge status={b.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => { deleteResearch(id); onBack(); toast({ title: "Research deleted" }); }}
        className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10"
      >
        <Trash2 className="mr-1 inline h-3 w-3" /> Delete Research
      </button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Dialogs                                                           */
/* ════════════════════════════════════════════════════════════════ */

function NewOppDialog({ onClose, onSwitchTab }: { onClose: () => void; onSwitchTab: (tab: Tab) => void }) {
  const createOpportunity = useEconomyHubStore((s) => s.createOpportunity);
  const [mode, setMode] = useState<"choose" | "manual">("choose");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [category, setCategory] = useState("General");
  const [status, setStatus] = useState<OpportunityStatus>("discovered");
  const [notes, setNotes] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createOpportunity({ name, description: desc, category, status, notes });
    toast({ title: "Opportunity created", description: name });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">New Opportunity</DialogTitle>
          <button type="button" aria-label="Close new opportunity dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </DialogHeader>
        <div className="p-4">
          {mode === "choose" ? (
            <div className="space-y-2">
              <p className="text-[12px] text-fg-muted">How would you like to create it?</p>
              <button
                onClick={() => setMode("manual")}
                className="flex w-full items-start gap-2 rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint"
              >
                <Plus className="mt-0.5 h-4 w-4 text-[var(--accent)]" />
                <div>
                  <p className="text-[12px] font-medium text-fg">Create Manually</p>
                  <p className="text-[10px] text-fg-faint">I already have an idea.</p>
                </div>
              </button>
              
              <button
                onClick={() => { onSwitchTab("research"); onClose(); }}
                className="flex w-full items-start gap-2 rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-fg-faint"
              >
                <FlaskConical className="mt-0.5 h-4 w-4 text-[var(--accent)]" />
                <div>
                  <p className="text-[12px] font-medium text-fg">Add From Existing Research</p>
                  <p className="text-[10px] text-fg-faint">Go to Research tab to convert research into an opportunity.</p>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-[11px] text-fg-muted">Opportunity name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 text-[12px]" placeholder="e.g. AI Interview Platform" autoFocus />
              </div>
              <div>
                <Label className="text-[11px] text-fg-muted">Short description</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} className="mt-1 text-[12px]" rows={2} placeholder="What is this opportunity?" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-fg-muted">Category</Label>
                  <Input value={category} onChange={e => setCategory(e.target.value)} className="mt-1 text-[12px]" />
                </div>
                <div>
                  <Label className="text-[11px] text-fg-muted">Status</Label>
                  <DropdownSelect value={status} onChange={v => setStatus(v as OpportunityStatus)} options={ALL_STATUSES.map(s => ({ value: s, label: STATUS_LABELS[s] }))} />
                </div>
              </div>
              <div>
                <Label className="text-[11px] text-fg-muted">Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 text-[12px]" rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setMode("choose")}>Back</Button>
                <Button size="sm" disabled={!name.trim()} onClick={handleCreate}>Create Opportunity</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewBizDialog({ onClose }: { onClose: () => void }) {
  const createBusiness = useEconomyHubStore((s) => s.createBusiness);
  const opportunities = useEconomyHubStore((s) => s.opportunities);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<BusinessStatus>("planning");
  const [sourceOppId, setSourceOppId] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    createBusiness({ name, status, sourceOpportunityId: sourceOppId || null });
    toast({ title: "Business created", description: name });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">New Business</DialogTitle>
          <button type="button" aria-label="Close new business dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div>
            <Label className="text-[11px] text-fg-muted">Business name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1 text-[12px]" autoFocus />
          </div>
          <div>
            <Label className="text-[11px] text-fg-muted">Status</Label>
            <div className="mt-1">
              <DropdownSelect value={status} onChange={v => setStatus(v as BusinessStatus)} options={Object.entries(BUSINESS_STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-fg-muted">Source opportunity (optional)</Label>
            <div className="mt-1">
              <DropdownSelect
                value={sourceOppId}
                onChange={setSourceOppId}
                options={[
                  { value: "", label: "None" },
                  ...opportunities.map(o => ({ value: o.id, label: o.name })),
                ]}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!name.trim()} onClick={handleCreate}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewResearchDialog({ onClose }: { onClose: () => void }) {
  const createResearch = useEconomyHubStore((s) => s.createResearch);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ResearchType>("market-research");
  const [summary, setSummary] = useState("");
  const [findings, setFindings] = useState("");

  const handleCreate = () => {
    if (!title.trim()) return;
    createResearch({ title, type, summary, findings });
    toast({ title: "Research created", description: title });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">New Research</DialogTitle>
          <button type="button" aria-label="Close new research dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div>
            <Label className="text-[11px] text-fg-muted">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 text-[12px]" autoFocus />
          </div>
          <div>
            <Label className="text-[11px] text-fg-muted">Type</Label>
            <div className="mt-1">
              <DropdownSelect value={type} onChange={v => setType(v as ResearchType)} options={Object.entries(RESEARCH_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-fg-muted">Summary</Label>
            <Textarea value={summary} onChange={e => setSummary(e.target.value)} className="mt-1 text-[12px]" rows={2} />
          </div>
          <div>
            <Label className="text-[11px] text-fg-muted">Key Findings</Label>
            <Textarea value={findings} onChange={e => setFindings(e.target.value)} className="mt-1 text-[12px]" rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!title.trim()} onClick={handleCreate}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════ */
/* Shared dropdown                                                   */
/* ════════════════════════════════════════════════════════════════ */

function DropdownSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-fg-muted hover:text-fg"
      >
        {selected?.label ?? "Select..."}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-[240px] overflow-y-auto rounded-md border border-line bg-overlay shadow-pop">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] transition-colors",
                opt.value === value
                  ? "bg-active text-fg"
                  : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {opt.label}
              {opt.value === value && <Check className="h-3 w-3 text-[var(--accent)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
