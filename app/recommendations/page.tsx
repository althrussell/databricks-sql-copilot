import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { listRecommendations } from "@/lib/dbx/recommendations";
import { RecommendationsClient } from "./recommendations-client";

export const dynamic = "force-dynamic";

function RecommendationsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

async function RecommendationsLoader() {
  let recommendations: Awaited<ReturnType<typeof listRecommendations>> = [];
  try {
    recommendations = await listRecommendations();
  } catch {
    recommendations = [];
  }

  return <RecommendationsClient initialRecommendations={recommendations} />;
}

export default function RecommendationsPage() {
  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Recommendations</span>
      </nav>

      <Suspense fallback={<RecommendationsSkeleton />}>
        <RecommendationsLoader />
      </Suspense>
    </div>
  );
}
