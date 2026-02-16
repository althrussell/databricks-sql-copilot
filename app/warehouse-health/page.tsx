import { getWorkspaceBaseUrl } from "@/lib/utils/deep-links";
import { WarehouseHealthReport } from "./warehouse-health-client";

export const revalidate = 300;

export default function WarehouseHealthPage() {
  const workspaceUrl = getWorkspaceBaseUrl();

  return (
    <div className="px-6 py-8">
      <WarehouseHealthReport workspaceUrl={workspaceUrl} />
    </div>
  );
}
