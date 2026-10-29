import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@databricks/sql", "lz4-napi", "@prisma/client", "pg"],
  images: {
    // Only /databricks-icon.svg is rendered via next/image; skip sharp at runtime
    unoptimized: true,
  },
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@databricks/databricks-sql-kernel*/**",
      "public/1.png",
      "public/2.png",
      "public/3.png",
      "public/4.png",
      "public/5.png",
    ],
  },
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
