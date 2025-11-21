export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const target = searchParams.get("url");
    if (!target || !isHttpUrl(target)) {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        // Some CDNs require a UA
        "User-Agent": "Outlight/1.0 (+image-proxy)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: `Upstream error ${upstream.status}` }, { status: 502 });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Proxy error" }, { status: 500 });
  }
}

