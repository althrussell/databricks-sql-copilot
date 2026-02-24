import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@databricks/sql", "@prisma/client", "pg"],
  experimental: {
    /**
     * Client-side router cache — keeps the RSC payload in browser memory
     * so navigating back from query details is instant (no re-fetch).
     *
     * - dynamic: 300s — matches the server-side `revalidate = 300` on the
     *   dashboard page. The browser won't hit the server at all for 5 min.
     * - static: 300s — same treatment for statically rendered pages.
     *
     * A new server fetch only happens when:
     *   1. The stale time expires (5 min), OR
     *   2. The user changes the time dimension (which changes the URL params,
     *      creating a new cache key automatically).
     */
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
};

export default nextConfig;
