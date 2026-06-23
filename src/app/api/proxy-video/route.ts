export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow long-lived streaming for large clips.
export const maxDuration = 300;

import { NextResponse } from "next/server";

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

/**
 * Range-aware streaming proxy for generated videos.
 *
 * Generated videos are served from KIE's CDN (`aiquickdraw.com`), which some
 * networks (Palo Alto DNS Security firewalls) block at the DNS + TLS-SNI layers.
 * This route runs on the server (off that firewall), fetches the upstream video,
 * and streams it back from our own origin so the browser never touches the
 * blocked host.
 *
 * Unlike the image proxy, this forwards the client's `Range` header and passes
 * through `Content-Range` / `Accept-Ranges`, so seeking and progressive
 * playback work and we never buffer the whole file in memory.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("url");
    if (!target || !isHttpUrl(target)) {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const range = req.headers.get("range");

    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent": "Outlight/1.0 (+video-proxy)",
        Accept: "video/*,*/*;q=0.8",
        ...(range ? { Range: range } : {}),
      },
    });

    // 200 (full) and 206 (partial/range) are both success for media.
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: 502 });
    }

    const headers = new Headers();
    for (const h of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
    ]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "private, max-age=300");

    // Stream the upstream body straight through — no full-file buffering.
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Proxy error" }, { status: 500 });
  }
}
