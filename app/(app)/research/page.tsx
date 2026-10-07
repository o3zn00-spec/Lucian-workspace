"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bot, ExternalLink, FileSearch, Search } from "lucide-react";


import { RESEARCH_TYPE_LABELS, useEconomyHubStore } from "@/store/economy-hub";
import { useInvestingStore } from "@/store/investing";

export default function ResearchPage() {
  const economicResearch = useEconomyHubStore((state) => state.researchRecords);
  const investmentResearch = useInvestingStore((state) => state.research);
  const [query, setQuery] = useState("");

  const filteredEconomic = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return economicResearch;
    return economicResearch.filter((item) =>
      [item.title, item.summary, item.findings, item.sources].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [economicResearch, query]);

  const filteredInvestment = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return investmentResearch;
    return investmentResearch.filter((item) =>
      [item.title, item.type, item.source, item.symbol, item.notes].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [investmentResearch, query]);

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      <header className="shrink-0 border-b border-line-muted px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-fg">Research</h1>
            <p className="mt-0.5 text-[11px] text-fg-muted">One place for economic and investment evidence.</p>
          </div>
          
        </div>
        <div className="relative mt-3 max-w-xl">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all research..."
            className="w-full rounded-md border border-line bg-surface py-2 pl-8 pr-3 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2">
          <ResearchSection
            title="Economic research"
            description="Markets, opportunities, competitors, users and business models."
            empty="No economic research saved yet."
            actionHref="/economy-hub"
            actionLabel="Open Economy Hub"
          >
            {filteredEconomic.map((item) => (
              <article key={item.id} className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-fg">{item.title}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--accent)]">{RESEARCH_TYPE_LABELS[item.type]}</p>
                  </div>
                  
                </div>
                <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-fg-muted">{item.summary || item.findings || "No summary yet."}</p>
                <Link href={`/economy-hub?research=${encodeURIComponent(item.id)}`} className="mt-2 inline-flex text-[10px] text-[var(--accent)] hover:underline">Open record</Link>
              </article>
            ))}
          </ResearchSection>

          <ResearchSection
            title="Investment research"
            description="Saved sources, security notes and portfolio questions."
            empty="No investment research saved yet."
            actionHref="/investing"
            actionLabel="Open Investing"
          >
            {filteredInvestment.map((item) => (
              <article key={item.id} className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-fg">{item.title}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--accent)]">{item.symbol || item.type}</p>
                  </div>
                  
                </div>
                <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-fg-muted">{item.notes || "No notes yet."}</p>
                <div className="mt-2 flex items-center gap-3">
                  <Link href={`/investing?research=${encodeURIComponent(item.id)}`} className="text-[10px] text-[var(--accent)] hover:underline">Open record</Link>
                  {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg"><ExternalLink className="h-2.5 w-2.5" /> Source</a> : null}
                </div>
              </article>
            ))}
          </ResearchSection>
        </div>
      </main>
    </div>
  );
}

function ResearchSection({
  title,
  description,
  empty,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  description: string;
  empty: string;
  actionHref: string;
  actionLabel: string;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[12px] font-semibold text-fg">{title}</h2>
          <p className="mt-0.5 text-[10px] text-fg-faint">{description}</p>
        </div>
        <Link href={actionHref} className="shrink-0 text-[10px] font-medium text-[var(--accent)] hover:underline">{actionLabel}</Link>
      </div>
      {hasChildren ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{children}</div> : (
        <div className="rounded-md border border-dashed border-line p-8 text-center">
          <FileSearch className="mx-auto h-7 w-7 text-fg-faint" />
          <p className="mt-2 text-[11px] text-fg-muted">{empty}</p>
        </div>
      )}
    </section>
  );
}
