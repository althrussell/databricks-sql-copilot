import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@databricks/sql", "@prisma/client", "pg"],
  experimental: {
    /**
     * Dynamic pages embed per-user data (OBO query results and per-user query
     * actions in every auth mode), so the client router cache must not reuse them.
     */
    staleTimes: {
      dynamic: 0,
      static: 60,
    },
  },
};

export default nextConfig;
