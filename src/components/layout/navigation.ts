import {
  BookOpen,
  Bot,
  Code2,
  Compass,
  FileSearch,
  FileText,
  Globe,
  Home,
  LayoutGrid,
  LineChart,
  Newspaper,
  PieChart,
  Settings,
  Vault as VaultIcon,
} from "lucide-react";
import type { NavSection } from "@/components/ui/NavList";

/**
 * Canonical owner navigation. Sidebar, breadcrumbs and module links should
 * use this map so Lucian presents one predictable information architecture.
 */
export const NAV_SECTIONS: NavSection[] = [
  { heading: "Home", items: [{ id: "home", href: "/", label: "Home", icon: Home }] },
  {
    heading: "Build",
    items: [
      { id: "dev-workspace", href: "/dev-workspace", label: "DevWorkspace", icon: Code2 },
      { id: "browser", href: "/browser", label: "Browser", icon: Globe },
    ],
  },
  {
    heading: "Finance",
    items: [
      { id: "markets", href: "/markets", label: "Markets", icon: LineChart },
      { id: "investing", href: "/investing", label: "Investing", icon: PieChart },
      { id: "vault", href: "/vault", label: "Vault", icon: VaultIcon },
    ],
  },
  {
    heading: "Intelligence",
    items: [
      { id: "economy-hub", href: "/economy-hub", label: "Economy Hub", icon: LayoutGrid },
      { id: "news-feed", href: "/news-feed", label: "News", icon: Newspaper },
      { id: "research", href: "/research", label: "Research", icon: FileSearch },
    ],
  },
  {
    heading: "Learning",
    items: [
      { id: "mindset-library", href: "/mindset-library", label: "Mindset Library", icon: BookOpen, aliases: ["/knowledge-library"] },
      { id: "chess-academy", href: "/chess-academy", label: "Chess", icon: Compass },
    ],
  },
  { heading: "Personal", items: [{ id: "notes", href: "/notes", label: "Notes", icon: FileText }] },
  { heading: "Settings", items: [{ id: "settings", href: "/settings", label: "Settings", icon: Settings }] },
];

const ROUTE_LABELS = new Map(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.href, item.label] as const)),
);
ROUTE_LABELS.set("/knowledge-library", "Mindset Library");

export function navigationLabelForPath(pathname: string): string {
  if (!pathname || pathname === "/") return "Home";
  const direct = ROUTE_LABELS.get(pathname);
  if (direct) return direct;
  const parent = [...ROUTE_LABELS.entries()].find(([path]) => path !== "/" && pathname.startsWith(`${path}/`));
  if (parent) return parent[1];
  const first = pathname.split("/").filter(Boolean)[0] ?? "home";
  return first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ");
}
