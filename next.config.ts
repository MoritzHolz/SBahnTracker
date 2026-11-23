import type { NextConfig } from "next";

const SUPABASE = "https://ytggyjckyslohbdkievd.supabase.co";
const TILES = "https://tiles.openfreemap.org";
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${SUPABASE} ${TILES}`,
  `img-src 'self' data: blob: ${TILES}`,
  // MapLibre-Worker liegt unter /maplibre/ (same-origin), ggf. als Blob-Wrapper
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  // Next.js benötigt Inline-Skripte; Dev-Server zusätzlich eval (React Refresh)
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
