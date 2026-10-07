// LUCIAN News — Video provider (Phase 13).
//
// Real video metadata sourced from RSS feeds that include media:content
// or enclosures with video MIME types. No fake videos. No fake durations.
// No fake view counts. No fake LIVE badges.
//
// Public RSS feeds with video enclosures (no API key required):
//   - Reuters Video (https://www.reutersagency.com/feed/?best-sectors=economics&post_type=video)
//   - BBC News Video (https://feeds.bbci.co.uk/news/video_and_audio/news_front_page/rss.xml)
//   - WSJ Video (https://feeds.content.dowjones.io/public/rss/SB10001424053111904265404576566530551174790)
//
// We parse each feed for:
//   - <enclosure type="video/*" url="...">  → direct media file URL
//   - <media:content medium="video" url="..."> → embed URL (YouTube etc.)
//   - <media:thumbnail url="..."> → thumbnail
//
// All video URLs are validated via isLegitimateVideoUrl() in article-media.ts.
// Direct mp4 URLs are playable in-browser; YouTube/Vimeo embeds are rendered
// in a sandboxed iframe with the provider's permission.
//
// This module is SERVER-ONLY. The News API route imports it and returns
// the video list as JSON. The client never fetches RSS feeds directly.

import {
  extractMediaContent,
  extractMediaThumbnail,
  isLegitimateImageUrl,
  isLegitimateVideoUrl,
} from "./article-media";
import type { NewsItem, NewsFilters, NewsProvider, MarketCategory } from "@/lib/markets/intelligence-types";

/** Canonical video item — no fake fields. Only fields with real metadata
 *  are populated; everything else is undefined. */
export interface NewsVideo {
  /** Stable id (URL hash). */
  id: string;
  /** Title. */
  title: string;
  /** Short description (HTML stripped, max 280 chars). */
  description?: string;
  /** Thumbnail URL (https preferred). */
  thumbnailUrl?: string;
  /** Direct media URL OR embeddable video URL (YouTube/Vimeo). */
  videoUrl: string;
  /** Source publisher name. */
  source: string;
  /** Canonical article URL (where the user lands if they click "Read"). */
  articleUrl?: string;
  /** ISO timestamp of publication. */
  publishedAt?: number;
  /** Duration in seconds — ONLY if real metadata exists. Otherwise undefined. */
  duration?: number;
  /** Whether the video is a direct media file or an embeddable iframe URL. */
  kind: "direct" | "embed";
  /** Whether the video stream is currently live. ONLY if real metadata. */
  isLive?: boolean;
  /** Provider/feed ID. */
  providerId: string;
}

/** A curated list of public RSS feeds that include video media. */
interface VideoFeedSource {
  id: string;
  source: string;
  url: string;
  categories: MarketCategory[];
}

const VIDEO_FEEDS: VideoFeedSource[] = [
  {
    id: "reuters-video",
    source: "Reuters",
    url: "https://www.reutersagency.com/feed/?best-sectors=economics&post_type=video",
    categories: ["all"],
  },
  {
    id: "bbc-news-video",
    source: "BBC News",
    url: "https://feeds.bbci.co.uk/news/video_and_audio/news_front_page/rss.xml",
    categories: ["all"],
  },
  {
    id: "wsj-video",
    source: "WSJ",
    url: "https://feeds.content.dowjones.io/public/rss/SB10001424053111904265404576566530551174790",
    categories: ["all"],
  },
];

/** Parse a single video RSS feed → list of NewsVideo items. */
async function fetchVideoFeed(
  feed: VideoFeedSource,
  signal: AbortSignal,
): Promise<NewsVideo[]> {
  try {
    const res = await fetch(feed.url, {
      signal,
      headers: {
        "User-Agent": "LUCIAN-NewsBot/1.0 (+https://lucian.app)",
      },
      // Server-side cache — revalidate every 5 minutes.
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseVideoFeed(xml, feed);
  } catch {
    return [];
  }
}

/** Parse the RSS XML into NewsVideo items. Uses the same regex-based
 *  item extraction as the news-providers RSS parser, then runs
 *  namespace-aware media extraction. */
function parseVideoFeed(xml: string, feed: VideoFeedSource): NewsVideo[] {
  const items: NewsVideo[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) ?? [];
  for (const m of matches) {
    const title = extractTag(m, "title");
    const link = extractTag(m, "link");
    const description = extractTag(m, "description");
    const pubDate = extractTag(m, "pubDate");

    if (!title || !link) continue;

    // Extract media:content + media:thumbnail from the raw item XML.
    const mediaContent = extractMediaContent(m);
    const thumbnail = extractMediaThumbnail(m);

    // Also check for enclosure (could be video or image).
    const enclosureUrl = extractAttr(m, "url", "enclosure");
    const enclosureType = extractAttr(m, "type", "enclosure")?.toLowerCase() ?? "";

    // Determine the video URL — prefer media:content video, then enclosure video.
    let videoUrl: string | null = null;
    let videoKind: "direct" | "embed" = "embed";
    if (mediaContent?.videoUrl && isLegitimateVideoUrl(mediaContent.videoUrl)) {
      videoUrl = mediaContent.videoUrl;
      // Determine if it's a direct media file or an embed.
      const u = new URL(videoUrl);
      videoKind = /\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(u.pathname) ? "direct" : "embed";
    } else if (enclosureUrl && enclosureType.startsWith("video/") && isLegitimateVideoUrl(enclosureUrl)) {
      videoUrl = enclosureUrl;
      videoKind = "direct";
    } else if (enclosureUrl && isLegitimateVideoUrl(enclosureUrl)) {
      videoUrl = enclosureUrl;
      const u = new URL(videoUrl);
      videoKind = /\.(mp4|webm|ogg|mov|m3u8)(\?|$)/i.test(u.pathname) ? "direct" : "embed";
    }

    if (!videoUrl) continue; // not a video item — skip silently

    // Thumbnail — prefer media:thumbnail, then media:content image, then
    // first <img> in description.
    let thumbnailUrl: string | null = null;
    if (thumbnail && isLegitimateImageUrl(thumbnail)) {
      thumbnailUrl = thumbnail;
    } else if (mediaContent?.imageUrl && isLegitimateImageUrl(mediaContent.imageUrl)) {
      thumbnailUrl = mediaContent.imageUrl;
    } else {
      const descImg = extractFirstImg(description);
      if (descImg && isLegitimateImageUrl(descImg)) {
        thumbnailUrl = descImg;
      }
    }

    // PublishedAt — only if the date parses cleanly.
    const publishedAt = pubDate ? Date.parse(pubDate) : NaN;

    items.push({
      id: hashId(link),
      title: decodeEntities(stripCdata(title.trim())),
      description: description ? stripHtml(decodeEntities(stripCdata(description.trim()))).slice(0, 280) : undefined,
      thumbnailUrl: thumbnailUrl ?? undefined,
      videoUrl,
      source: feed.source,
      articleUrl: link,
      publishedAt: Number.isNaN(publishedAt) ? undefined : publishedAt,
      // Duration: NOT extracted unless the RSS item explicitly declares one.
      // Most RSS video feeds don't, so this stays undefined — no fake durations.
      duration: undefined,
      kind: videoKind,
      isLive: undefined, // No fake LIVE badge — only set if RSS declares it.
      providerId: feed.id,
    });
  }
  return items;
}

// ── Helpers (mirrored from news-providers.ts but not exported there) ────

function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : undefined;
}

function extractAttr(xml: string, attr: string, inTag?: string): string | undefined {
  const tagRe = inTag
    ? new RegExp(`<${inTag}\\b[^>]*>`, "i")
    : /<\w+\b[^>]*>/i;
  const tagMatch = xml.match(tagRe);
  if (!tagMatch) return undefined;
  const re = new RegExp(`\\s${attr}=["']([^"']+)["']`, "i");
  const m = tagMatch[0].match(re);
  return m ? decodeEntities(m[1]) : undefined;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function extractFirstImg(html?: string): string | null {
  if (!html) return null;
  const re = /<img\b[^>]*?\ssrc=["']([^"']+)["'][^>]*>/i;
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ── Provider export ─────────────────────────────────────────────────────

/**
 * Fetch videos from all configured video feeds in parallel.
 *
 * Failure isolation: one bad feed does NOT kill the others. We use
 * `Promise.allSettled` under the hood (via Promise.all + per-feed try/catch).
 *
 * The returned array is deduplicated by video URL (same story may appear in
 * multiple feeds) and sorted newest-first.
 */
export async function fetchNewsVideos(_filters?: NewsFilters): Promise<NewsVideo[]> {
  void _filters; // We don't filter video feeds by market category — they're general.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const results = await Promise.all(
      VIDEO_FEEDS.map((f) => fetchVideoFeed(f, controller.signal)),
    );
    let videos = results.flat();

    // Deduplicate by videoUrl.
    const seen = new Set<string>();
    videos = videos.filter((v) => {
      if (seen.has(v.videoUrl)) return false;
      seen.add(v.videoUrl);
      return true;
    });

    // Sort newest-first (items without publishedAt go to the end, stable).
    videos.sort((a, b) => {
      if (a.publishedAt === undefined && b.publishedAt === undefined) return 0;
      if (a.publishedAt === undefined) return 1;
      if (b.publishedAt === undefined) return -1;
      return b.publishedAt - a.publishedAt;
    });

    return videos.slice(0, 24);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Also expose the video feed items as NewsItems (for cross-listing) ──

/**
 * Convert video items to NewsItems (used when the user searches — we want
 * videos to also appear in the main feed when they match the query).
 */
export function videosToNewsItems(videos: NewsVideo[]): NewsItem[] {
  return videos.map((v) => ({
    id: v.id,
    source: v.source,
    publishedAt: v.publishedAt ?? Date.now(),
    headline: v.title,
    summary: v.description ?? "",
    url: v.articleUrl ?? v.videoUrl,
    type: "news" as const,
    categories: ["all" as MarketCategory],
    symbols: [],
    imageUrl: v.thumbnailUrl,
    providerId: v.providerId,
  }));
}

/** The NewsProvider interface stub — the News video feed is implemented
 *  as a standalone function rather than a NewsProvider, but we expose
 *  this so the Markets/Intelligence panel can import it if needed. */
export const newsVideoProvider: NewsProvider = {
  id: "news-video-rss",
  label: "News Video RSS (Reuters, BBC, WSJ)",
  configured: true,
  async fetch(): Promise<NewsItem[]> {
    const videos = await fetchNewsVideos();
    return videosToNewsItems(videos);
  },
};
