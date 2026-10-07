"use client";

/* LUCIAN Markets — Instrument identity icon.
 *
 * Renders a recognizable brand/currency/commodity identity for each
 * instrument, sized to fit inside the standard 24px row-icon circle.
 *
 * Identity sources:
 *  - Crypto    → cryptocurrency-icons CDN (real SVG logos)
 *  - Stocks    → Clearbit logo CDN (real company logos)
 *  - Forex     → flagcdn.com (base-currency country flag)
 *  - Metals    → chemical symbol (Au / Ag) on gold/silver tinted circle
 *  - Energies  → lucide Droplet / Flame icon on warm-tinted circle
 *  - Indices   → abbreviation badge (SPX / NDX / DJI…) on green-tinted circle
 *
 * All external images fall back to the badge text if the CDN fails to
 * load, so the list never shows broken-image icons.
 */

import { useState } from "react";
import { Droplet, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetClass } from "@/lib/markets/types";

interface Props {
  symbol: string;
  base: string;
  assetClass: AssetClass;
  badge: string;
}

/* Crypto symbol → cryptocurrency-icons CDN slug.
   Slug format: lowercase ticker, e.g. BTC → btc */
const CRYPTO_SLUG: Record<string, string> = {
  BTC: "btc",
  ETH: "eth",
  XRP: "xrp",
  SOL: "sol",
  BNB: "bnb",
  ADA: "ada",
  LTC: "ltc",
  DOGE: "doge",
  BCH: "bch",
  AVAX: "avax",
  ATOM: "atom",
  LINK: "link",
  GRT: "grt",
  FIL: "fil",
  DASH: "dash",
  AAVE: "aave",
  ALGO: "algo",
  UNI: "uni",
  ETC: "etc",
  TRX: "trx",
  DOT: "dot",
  AXS: "axs",
  MANA: "mana",
  ZEC: "zec",
  NEAR: "near",
  IOTA: "iota",
  ICP: "icp",
  LRC: "lrc",
};

/* Stock ticker → company domain (for Clearbit logo CDN). */
const STOCK_DOMAIN: Record<string, string> = {
  TSLA: "tesla.com",
  NVDA: "nvidia.com",
  NFLX: "netflix.com",
  AMZN: "amazon.com",
  AAPL: "apple.com",
  GOOGL: "alphabet.com",
  META: "meta.com",
  BABA: "alibaba.com",
  MMM: "3m.com",
  MSFT: "microsoft.com",
  AMD: "amd.com",
  SHOP: "shopify.com",
};

/* Currency code → ISO 3166-1 alpha-2 country code (for flagcdn.com). */
const CURRENCY_FLAG: Record<string, string> = {
  USD: "us",
  EUR: "eu",
  JPY: "jp",
  GBP: "gb",
  AUD: "au",
  CAD: "ca",
  CHF: "ch",
  NZD: "nz",
  MXN: "mx",
  ZAR: "za",
};

export function InstrumentIcon({ symbol, base, assetClass, badge }: Props) {
  /* ── Crypto: real SVG logo from cryptocurrency-icons CDN ── */
  if (assetClass === "crypto") {
    const slug = CRYPTO_SLUG[base];
    if (slug) {
      return (
        <IconCircle className="bg-white/5">
          <RemoteImg
            src={`https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${slug}.svg`}
            alt={symbol}
            fallback={badge}
          />
        </IconCircle>
      );
    }
  }

  /* ── Stocks: real company logo from Clearbit ── */
  if (assetClass === "stocks") {
    const domain = STOCK_DOMAIN[base];
    if (domain) {
      return (
        <IconCircle className="bg-white/5">
          <RemoteImg
            src={`https://logo.clearbit.com/${domain}`}
            alt={symbol}
            fallback={badge}
          />
        </IconCircle>
      );
    }
  }

  /* ── Forex: base-currency flag from flagcdn ── */
  if (assetClass === "forex") {
    const flag = CURRENCY_FLAG[base];
    if (flag) {
      return (
        <IconCircle className="bg-[#1f3a4a] overflow-hidden">
          <RemoteImg
            src={`https://flagcdn.com/w40/${flag}.png`}
            alt={symbol}
            fallback={badge}
            objectCover
          />
        </IconCircle>
      );
    }
  }

  /* ── Metals: chemical symbol on gold/silver tinted circle ── */
  if (assetClass === "metals") {
    const isGold = base === "XAU";
    const isSilver = base === "XAG";
    return (
      <IconCircle
        className={cn(
          isGold
            ? "bg-[#3a2f1a] text-[#e0b870]"
            : isSilver
            ? "bg-[#2a2a3a] text-[#c0c0c0]"
            : "bg-surface-2 text-fg-muted",
        )}
      >
        <span className="text-[9px] font-bold">{isGold ? "Au" : isSilver ? "Ag" : badge}</span>
      </IconCircle>
    );
  }

  /* ── Energies: oil drop (XTI/XBR) or flame (XNG) icon ── */
  if (assetClass === "energies") {
    const isGas = base === "XNG";
    return (
      <IconCircle className="bg-[#3a1f1a] text-[#cf8b7f]">
        {isGas ? (
          <Flame className="h-3.5 w-3.5" />
        ) : (
          <Droplet className="h-3.5 w-3.5" />
        )}
      </IconCircle>
    );
  }

  /* ── Indices: green-tinted circle with abbreviation badge ── */
  if (assetClass === "indices") {
    return (
      <IconCircle className="bg-[#1a3a2a] text-[#7fcf9b]">
        <span className="text-[8px] font-bold">{badge}</span>
      </IconCircle>
    );
  }

  /* ── Fallback: badge text on neutral circle ── */
  return (
    <IconCircle className="bg-surface-2 text-fg-muted">
      <span className="text-[9px] font-bold">{badge}</span>
    </IconCircle>
  );
}

/* ── Helpers ── */

function IconCircle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Remote image with graceful fallback to badge text on load error.
    Avoids next/image so we don't need to touch next.config.ts
    remotePatterns (which is a global config change). */
function RemoteImg({
  src,
  alt,
  fallback,
  objectCover = false,
}: {
  src: string;
  alt: string;
  fallback: string;
  objectCover?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="text-[9px] font-bold text-fg-muted">{fallback}</span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn(
        "h-5 w-5",
        objectCover ? "object-cover" : "object-contain",
      )}
    />
  );
}
