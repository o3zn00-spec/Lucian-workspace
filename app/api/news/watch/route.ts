import { NextResponse } from "next/server";
import { fetchNewsVideos } from "@/lib/news/video-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/news/watch
 *
 * Returns real video items sourced from RSS feeds that include
 * media:content / enclosure with video MIME types.
 *
 * Provider sources: Reuters Video, BBC News Video, WSJ Video.
 *
 * No fake videos, no fake durations, no fake LIVE badges. If a feed is
 * down or no videos are available, we return an empty array — we NEVER
 * fabricate video data.
 *
 * Failure isolation: each feed is fetched independently with try/catch;
 * one bad feed does NOT kill the others.
 */
export async function GET() {
  try {
    const videos = await fetchNewsVideos();
    return NextResponse.json({
      videos,
      total: videos.length,
      // Honest flag — the UI can show "video provider partially available"
      // if total < some threshold. Never used to drive fake content.
      providerReady: videos.length > 0,
    });
  } catch {
    return NextResponse.json(
      {
        videos: [],
        total: 0,
        providerReady: false,
        error: "Video feeds unavailable",
      },
      { status: 502 },
    );
  }
}
