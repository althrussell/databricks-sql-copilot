import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // For runtime, use the pooler URL (DATABASE_URL).
    // For migrations/DDL, override with DIRECT_DATABASE_URL via:
    //   DATABASE_URL=$DIRECT_DATABASE_URL npx prisma db push
    url: process.env["DATABASE_URL"],
  },
});
