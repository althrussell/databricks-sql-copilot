import type { NextConfig } from "next";

const isSpMode = process.env.AUTH_MODE?.toLowerCase() === "sp";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@databricks/sql", "@prisma/client", "pg"],
  experimental: {
    /**
     * Client-side router cache configuration:
     * - Under AUTH_MODE=obo (default), dynamic staleTime is 0s so switching
     *   identities or refreshing never serves cached RSC payloads from a prior user.
     * - Under AUTH_MODE=sp, 300s is safe since all requests share the SP identity.
     */
    staleTimes: {
      dynamic: isSpMode ? 300 : 0,
      static: 60,
    },
  },
};

export default nextConfig;
