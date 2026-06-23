"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Rewrite a remote image URL to load through our own same-origin proxy
 * (`/api/download-image`). Data URLs, blob URLs and relative/same-origin URLs
 * are returned unchanged (they never need proxying).
 */
export function proxiedImageSrc(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("/")) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    return `/api/download-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

type ProxiedImgProps = {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  loading?: "eager" | "lazy";
};

/**
 * An <img> that loads the original URL first, then transparently retries
 * through our same-origin image proxy if the direct load fails.
 *
 * Why: generated images are served from the provider's CDN (KIE results live on
 * `aiquickdraw.com`). On normal networks the direct URL loads fine. But some
 * networks — e.g. a corporate / Palo Alto Networks DNS-Security firewall —
 * classify that host and block it at the DNS (sinkhole) and TLS-SNI layers, so
 * the browser's direct `<img>` request is reset and the image appears broken,
 * even though generation succeeded. Routing the retry through our backend (which
 * is not behind that firewall) re-serves the bytes from our own origin.
 *
 * Direct-first keeps things fast and cheap for everyone; the proxy only kicks in
 * when the direct load actually fails.
 *
 * Two failure paths are handled, because a blocked host fails almost instantly:
 *  - onError: the normal case, fires when the load fails after mount.
 *  - a post-render check (`complete && naturalWidth === 0`): catches a load that
 *    already failed before React attached onError — e.g. the server-rendered
 *    <img> erroring during hydration. Without this, a fast network reset would
 *    leave a broken image with onError never firing.
 */
export function ProxiedImg({ src, alt = "", className, loading }: ProxiedImgProps) {
  const [useProxy, setUseProxy] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const original = src || "";
  const canProxy =
    !!original && !original.startsWith("data:") && !original.startsWith("blob:");

  // Reset the proxy fallback whenever the source changes.
  useEffect(() => {
    setUseProxy(false);
  }, [original]);

  // Catch a direct load that already failed before onError could attach.
  // Guarded by !useProxy so a proxy failure doesn't loop back.
  useEffect(() => {
    const el = imgRef.current;
    if (!useProxy && canProxy && el && el.complete && el.naturalWidth === 0) {
      setUseProxy(true);
    }
  });

  const resolved = useProxy && canProxy ? proxiedImageSrc(original) : original;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={resolved}
      alt={alt}
      className={className}
      loading={loading}
      onError={() => {
        if (!useProxy && canProxy) setUseProxy(true);
      }}
    />
  );
}
