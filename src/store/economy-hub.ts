"use client";

/* LUCIAN Economy Hub — state management.
 *
 * Manages: opportunities, businesses, research records, and economic
 * activity. All data persists to localStorage via zustand persist.
 *
 * Pipeline: Discovered → Researching → Shortlisted → Testing →
 *   Approved → Building → Launched → Operating
 * Terminal: Profitable / Failed / Paused / Rejected
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type OpportunityStatus =
  | "discovered" | "researching" | "shortlisted" | "testing"
  | "approved" | "building" | "launched" | "operating"
  | "profitable" | "failed" | "paused" | "rejected";

export const PIPELINE_STATUSES: OpportunityStatus[] = [
  "discovered", "researching", "shortlisted", "testing",
  "approved", "building", "launched", "operating",
];

export const TERMINAL_STATUSES: OpportunityStatus[] = [
  "profitable", "failed", "paused", "rejected",
];

export const ALL_STATUSES: OpportunityStatus[] = [
  ...PIPELINE_STATUSES, ...TERMINAL_STATUSES,
];

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  discovered: "Discovered",
  researching: "Researching",
  shortlisted: "Shortlisted",
  testing: "Testing",
  approved: "Approved",
  building: "Building",
  launched: "Launched",
  operating: "Operating",
  profitable: "Profitable",
  failed: "Failed",
  paused: "Paused",
  rejected: "Rejected",
};

export interface Opportunity {
  id: string;
  name: string;
  description: string;
  category: string;
  status: OpportunityStatus;
  score: number;
  demand: "low" | "medium" | "high";
  competition: "low" | "medium" | "high";
  startupCostMin: number;
  startupCostMax: number;
  technicalDifficulty: "low" | "medium" | "high";
  estimatedBuildTime: string;
  revenueModel: string;
  potentialCustomers: string;
  whyOpportunityExists: string;
  marketNeed: string;
  risks: string;
  recommendedExperiment: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  sourceResearchIds: string[];
  relatedBusinessId: string | null;
  relatedProjectId: string | null;
  rejectionReason: string | null;
}

export type BusinessStatus = "planning" | "building" | "launching" | "operating" | "paused" | "closed";

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  planning: "Planning",
  building: "Building",
  launching: "Launching",
  operating: "Operating",
  paused: "Paused",
  closed: "Closed",
};

export interface Business {
  id: string;
  name: string;
  status: BusinessStatus;
  sourceOpportunityId: string | null;
  projectId: string | null;
  website: string;
  revenue: number;
  expenses: number;
  profit: number;
  createdAt: number;
  updatedAt: number;
}

export type ResearchType = "market-research" | "opportunity-discovery" | "competitor-analysis" | "user-research" | "financial-analysis";

export const RESEARCH_TYPE_LABELS: Record<ResearchType, string> = {
  "market-research": "Market Research",
  "opportunity-discovery": "Opportunity Discovery",
  "competitor-analysis": "Competitor Analysis",
  "user-research": "User Research",
  "financial-analysis": "Financial Analysis",
};

export interface ResearchRecord {
  id: string;
  title: string;
  type: ResearchType;
  summary: string;
  findings: string;
  sources: string;
  relatedOpportunityIds: string[];
  relatedBusinessIds: string[];
  relatedProjectIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type ActivityType =
  | "opportunity-created" | "opportunity-status-changed" | "opportunity-rejected"
  | "business-created" | "business-updated"
  | "research-created" | "research-linked";

export interface EconomicActivity {
  id: string;
  type: ActivityType;
  entityType: "opportunity" | "business" | "research";
  entityId: string;
  entityName: string;
  message: string;
  createdAt: number;
}

interface EconomyHubState {
  opportunities: Opportunity[];
  businesses: Business[];
  researchRecords: ResearchRecord[];
  activities: EconomicActivity[];

  // Opportunity actions
  createOpportunity: (data: Partial<Opportunity>) => string;
  updateOpportunity: (id: string, patch: Partial<Opportunity>) => void;
  setOpportunityStatus: (id: string, status: OpportunityStatus, reason?: string) => void;
  rejectOpportunity: (id: string, reason: string) => void;
  deleteOpportunity: (id: string) => void;
  linkResearchToOpportunity: (oppId: string, researchId: string) => void;

  // Business actions
  createBusiness: (data: Partial<Business>) => string;
  updateBusiness: (id: string, patch: Partial<Business>) => void;
  deleteBusiness: (id: string) => void;

  // Research actions
  createResearch: (data: Partial<ResearchRecord>) => string;
  updateResearch: (id: string, patch: Partial<ResearchRecord>) => void;
  deleteResearch: (id: string) => void;

  // Derived helpers
  getOpportunitiesByStatus: (status: OpportunityStatus) => Opportunity[];
  getOpportunitiesCount: () => number;
  getResearchingCount: () => number;
  getShortlistedCount: () => number;
  getBusinessesCount: () => number;
  getNeedsReviewCount: () => number;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function addActivity(
  set: (fn: (s: EconomyHubState) => Partial<EconomyHubState>) => void,
  type: ActivityType,
  entityType: "opportunity" | "business" | "research",
  entityId: string,
  entityName: string,
  message: string,
) {
  set((s) => ({
    activities: [
      {
        id: genId("act"),
        type,
        entityType,
        entityId,
        entityName,
        message,
        createdAt: Date.now(),
      },
      ...s.activities,
    ].slice(0, 50),
  }));
}

export const useEconomyHubStore = create<EconomyHubState>()(
  persist(
    (set, get) => ({
      opportunities: [],
      businesses: [],
      researchRecords: [],
      activities: [],

      createOpportunity: (data) => {
        const id = genId("opp");
        const now = Date.now();
        const opp: Opportunity = {
          id,
          name: data.name || "Untitled Opportunity",
          description: data.description || "",
          category: data.category || "General",
          status: data.status || "discovered",
          score: data.score ?? 50,
          demand: data.demand || "medium",
          competition: data.competition || "medium",
          startupCostMin: data.startupCostMin ?? 0,
          startupCostMax: data.startupCostMax ?? 0,
          technicalDifficulty: data.technicalDifficulty || "medium",
          estimatedBuildTime: data.estimatedBuildTime || "",
          revenueModel: data.revenueModel || "",
          potentialCustomers: data.potentialCustomers || "",
          whyOpportunityExists: data.whyOpportunityExists || "",
          marketNeed: data.marketNeed || "",
          risks: data.risks || "",
          recommendedExperiment: data.recommendedExperiment || "",
          notes: data.notes || "",
          createdAt: now,
          updatedAt: now,
          sourceResearchIds: data.sourceResearchIds || [],
          relatedBusinessId: data.relatedBusinessId || null,
          relatedProjectId: data.relatedProjectId || null,
          rejectionReason: data.rejectionReason || null,
        };
        set((s) => ({ opportunities: [opp, ...s.opportunities] }));
        addActivity(set, "opportunity-created", "opportunity", id, opp.name, `Opportunity created: ${opp.name}`);
        return id;
      },

      updateOpportunity: (id, patch) => {
        set((s) => ({
          opportunities: s.opportunities.map((o) =>
            o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o,
          ),
        }));
      },

      setOpportunityStatus: (id, status, reason) => {
        set((s) => ({
          opportunities: s.opportunities.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status,
                  updatedAt: Date.now(),
                  rejectionReason: status === "rejected" ? (reason || o.rejectionReason) : o.rejectionReason,
                }
              : o,
          ),
        }));
        const opp = get().opportunities.find((o) => o.id === id);
        if (opp) {
          addActivity(
            set,
            "opportunity-status-changed",
            "opportunity",
            id,
            opp.name,
            `Status changed: ${opp.name} → ${STATUS_LABELS[status]}`,
          );
        }
      },

      rejectOpportunity: (id, reason) => {
        get().setOpportunityStatus(id, "rejected", reason);
        const opp = get().opportunities.find((o) => o.id === id);
        if (opp) {
          addActivity(set, "opportunity-rejected", "opportunity", id, opp.name, `Opportunity rejected: ${opp.name}`);
        }
      },

      deleteOpportunity: (id) => {
        set((s) => ({
          opportunities: s.opportunities.filter((o) => o.id !== id),
        }));
      },

      linkResearchToOpportunity: (oppId, researchId) => {
        set((s) => ({
          opportunities: s.opportunities.map((o) =>
            o.id === oppId && !o.sourceResearchIds.includes(researchId)
              ? { ...o, sourceResearchIds: [...o.sourceResearchIds, researchId], updatedAt: Date.now() }
              : o,
          ),
          researchRecords: s.researchRecords.map((r) =>
            r.id === researchId && !r.relatedOpportunityIds.includes(oppId)
              ? { ...r, relatedOpportunityIds: [...r.relatedOpportunityIds, oppId], updatedAt: Date.now() }
              : r,
          ),
        }));
      },

      createBusiness: (data) => {
        const id = genId("biz");
        const now = Date.now();
        const biz: Business = {
          id,
          name: data.name || "Untitled Business",
          status: data.status || "planning",
          sourceOpportunityId: data.sourceOpportunityId || null,
          projectId: data.projectId || null,
          website: data.website || "",
          revenue: data.revenue ?? 0,
          expenses: data.expenses ?? 0,
          profit: data.profit ?? 0,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          businesses: [biz, ...s.businesses],
          // If linked to an opportunity, set relatedBusinessId.
          opportunities: biz.sourceOpportunityId
            ? s.opportunities.map((o) =>
                o.id === biz.sourceOpportunityId
                  ? { ...o, relatedBusinessId: id, status: o.status === "approved" ? "building" : o.status }
                  : o,
              )
            : s.opportunities,
        }));
        addActivity(set, "business-created", "business", id, biz.name, `Business created: ${biz.name}`);
        return id;
      },

      updateBusiness: (id, patch) => {
        set((s) => ({
          businesses: s.businesses.map((b) =>
            b.id === id
              ? {
                  ...b,
                  ...patch,
                  profit: (patch.revenue ?? b.revenue) - (patch.expenses ?? b.expenses),
                  updatedAt: Date.now(),
                }
              : b,
          ),
        }));
        const biz = get().businesses.find((b) => b.id === id);
        if (biz) {
          addActivity(set, "business-updated", "business", id, biz.name, `Business updated: ${biz.name}`);
        }
      },

      deleteBusiness: (id) => {
        set((s) => ({
          businesses: s.businesses.filter((b) => b.id !== id),
          opportunities: s.opportunities.map((o) =>
            o.relatedBusinessId === id ? { ...o, relatedBusinessId: null } : o,
          ),
        }));
      },

      createResearch: (data) => {
        const id = genId("res");
        const now = Date.now();
        const rec: ResearchRecord = {
          id,
          title: data.title || "Untitled Research",
          type: data.type || "market-research",
          summary: data.summary || "",
          findings: data.findings || "",
          sources: data.sources || "",
          relatedOpportunityIds: data.relatedOpportunityIds || [],
          relatedBusinessIds: data.relatedBusinessIds || [],
          relatedProjectIds: data.relatedProjectIds || [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ researchRecords: [rec, ...s.researchRecords] }));
        addActivity(set, "research-created", "research", id, rec.title, `Research created: ${rec.title}`);
        return id;
      },

      updateResearch: (id, patch) => {
        set((s) => ({
          researchRecords: s.researchRecords.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r,
          ),
        }));
      },

      deleteResearch: (id) => {
        set((s) => ({
          researchRecords: s.researchRecords.filter((r) => r.id !== id),
          opportunities: s.opportunities.map((o) => ({
            ...o,
            sourceResearchIds: o.sourceResearchIds.filter((rid) => rid !== id),
          })),
        }));
      },

      getOpportunitiesByStatus: (status) =>
        get().opportunities.filter((o) => o.status === status),

      getOpportunitiesCount: () => get().opportunities.length,

      getResearchingCount: () =>
        get().opportunities.filter((o) => o.status === "researching").length,

      getShortlistedCount: () =>
        get().opportunities.filter((o) => o.status === "shortlisted").length,

      getBusinessesCount: () => get().businesses.length,

      getNeedsReviewCount: () =>
        get().opportunities.filter((o) =>
          o.status === "discovered" || o.status === "testing",
        ).length,
    }),
    {
      name: "lucian-economy-hub",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);
