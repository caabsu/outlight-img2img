"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rewrite a remote video URL to load through our range-aware streaming proxy
 * (`/api/proxy-video`). Data/blob/relative URLs are returned unchanged.
 */
export function proxiedVideoSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    return `/api/proxy-video?url=${encodeURIComponent(url)}`;
  }
  return url;
}

type ProxiedVideoProps = {
  src: string | null | undefined;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  playsInline?: boolean;
  muted?: boolean;
  loop?: boolean;
};

/**
 * A <video> that plays the original URL first, then transparently retries
 * through our same-origin streaming proxy if the direct load fails.
 *
 * Same rationale as ProxiedImg: KIE serves results from `aiquickdraw.com`, which
 * some networks (e.g. Palo Alto DNS Security firewalls) block at the DNS and
 * TLS-SNI layers, so the browser can't load the video directly even though
 * generation succeeded. The proxy runs server-side (off the firewall) and
 * streams the bytes back with range support so seeking still works.
 */
export function ProxiedVideo({
  src,
  className,
  controls,
  autoPlay,
  playsInline,
  muted,
  loop,
}: ProxiedVideoProps) {
  const [useProxy, setUseProxy] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);

  const original = src || "";
  const canProxy =
    !!original && !original.startsWith("data:") && !original.startsWith("blob:");

  // Reset the proxy fallback whenever the source changes.
  useEffect(() => {
    setUseProxy(false);
  }, [original]);

  // Catch a direct load that already errored before onError could attach.
  useEffect(() => {
    const el = ref.current;
    if (!useProxy && canProxy && el && el.error) {
      setUseProxy(true);
    }
  });

  const resolved = useProxy && canProxy ? proxiedVideoSrc(original) : original;

  return (
    <video
      ref={ref}
      key={resolved}
      src={resolved}
      className={className}
      controls={controls}
      autoPlay={autoPlay}
      playsInline={playsInline}
      muted={muted}
      loop={loop}
      onError={() => {
        if (!useProxy && canProxy) setUseProxy(true);
      }}
    />
  );
}
