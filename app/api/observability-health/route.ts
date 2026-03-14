import { NextResponse } from "next/server";
import { getObservabilityScorecard } from "@/lib/queries/unified-observability";
import {
  getSqlFreshnessSloMinutes,
  getSparkFreshnessSloMinutes,
  getPhotonFreshnessSloMinutes,
} from "@/lib/config";

function ageMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((Date.now() - ts) / 60000);
}

export async function GET(): Promise<NextResponse> {
  try {
    const scorecard = await getObservabilityScorecard();
    if (!scorecard) {
      return NextResponse.json(
        {
          status: "degraded",
          reason: "Unified observability scorecard unavailable",
        },
        { status: 503 },
      );
    }

    const sqlAgeMin = ageMinutes(scorecard.sqlLastIngestTs);
    const sparkAgeMin = ageMinutes(scorecard.sparkLastIngestTs);
    const photonAgeMin = ageMinutes(scorecard.photonLastIngestTs);

    const sqlSlo = getSqlFreshnessSloMinutes();
    const sparkSlo = getSparkFreshnessSloMinutes();
    const photonSlo = getPhotonFreshnessSloMinutes();

    const breaches: string[] = [];
    if (sqlAgeMin == null || sqlAgeMin > sqlSlo) breaches.push("sql_freshness");
    if (sparkAgeMin == null || sparkAgeMin > sparkSlo) breaches.push("spark_freshness");
    if (photonAgeMin == null || photonAgeMin > photonSlo) breaches.push("photon_freshness");

    const status = breaches.length === 0 ? "healthy" : "degraded";
    return NextResponse.json({
      status,
      freshnessStatus: scorecard.freshnessStatus,
      breaches,
      ageMinutes: {
        sql: sqlAgeMin,
        spark: sparkAgeMin,
        photon: photonAgeMin,
      },
      sloMinutes: {
        sql: sqlSlo,
        spark: sparkSlo,
        photon: photonSlo,
      },
      latestIngest: {
        sql: scorecard.sqlLastIngestTs,
        spark: scorecard.sparkLastIngestTs,
        photon: scorecard.photonLastIngestTs,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "degraded", reason: message }, { status: 500 });
  }
}
