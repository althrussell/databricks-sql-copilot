import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseAuditEvent } from "@/lib/domain/types";

export interface ListWarehouseAuditParams {
  startTime: string;
  endTime: string;
  warehouseId?: string;
  limit?: number;
}

interface AuditRow {
  event_time: string;
  action_name: string;
  warehouse_id: string;
  warehouse_editor_user: string;
  warehouse_name: string | null;
  warehouse_type: string | null;
  warehouse_size: string | null;
  min_cluster_scaling: number | null;
  max_cluster_scaling: number | null;
  auto_stop_mins: string | null;
  warehouse_channel: string | null;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch warehouse config change history from system.access.audit.
 *
 * Captures create, edit, and delete operations on SQL warehouses.
 * Returns who changed what, when.
 */
export async function listWarehouseAudit(
  params: ListWarehouseAuditParams
): Promise<WarehouseAuditEvent[]> {
  const { startTime, endTime, warehouseId, limit = 100 } = params;

  const warehouseFilter = warehouseId
    ? `AND request_params.id = '${escapeString(warehouseId)}'`
    : "";

  // Derive date bounds for partition pruning on system.access.audit
  const startDate = startTime.slice(0, 10); // YYYY-MM-DD
  const endDate = endTime.slice(0, 10);

  const sql = `
    SELECT
      event_time,
      action_name,
      COALESCE(request_params.id, '') AS warehouse_id,
      user_identity.email AS warehouse_editor_user,
      request_params.name AS warehouse_name,
      request_params.warehouse_type AS warehouse_type,
      request_params.cluster_size AS warehouse_size,
      CAST(request_params.min_num_clusters AS INTEGER) AS min_cluster_scaling,
      CAST(request_params.max_num_clusters AS INTEGER) AS max_cluster_scaling,
      request_params.auto_stop_mins AS auto_stop_mins,
      CAST(request_params.channel AS STRING) AS warehouse_channel
    FROM system.access.audit
    WHERE event_date >= '${startDate}'
      AND event_date <= '${endDate}'
      AND service_name = 'databrickssql'
      AND action_name IN (
        'createWarehouse', 'createEndpoint',
        'editWarehouse', 'editEndpoint',
        'deleteWarehouse', 'deleteEndpoint'
      )
      AND response.status_code = '200'
      AND event_time >= '${escapeString(startTime)}'
      AND event_time <= '${escapeString(endTime)}'
      ${warehouseFilter}
    ORDER BY event_time DESC
    LIMIT ${Math.min(Math.max(1, limit), 200)}
  `;

  const result = await executeQuery<AuditRow>(sql);
  return result.rows.map((row) => ({
    eventTime: row.event_time ?? "",
    actionName: normalizeAction(row.action_name ?? ""),
    warehouseId: row.warehouse_id ?? "unknown",
    editorUser: row.warehouse_editor_user ?? "Unknown",
    warehouseName: row.warehouse_name ?? null,
    warehouseType: row.warehouse_type ?? null,
    warehouseSize: row.warehouse_size ?? null,
    minClusters: row.min_cluster_scaling ?? null,
    maxClusters: row.max_cluster_scaling ?? null,
    autoStopMins: row.auto_stop_mins ?? null,
    warehouseChannel: row.warehouse_channel ?? null,
  }));
}

function normalizeAction(action: string): string {
  switch (action) {
    case "createWarehouse":
    case "createEndpoint":
      return "Created";
    case "editWarehouse":
    case "editEndpoint":
      return "Edited";
    case "deleteWarehouse":
    case "deleteEndpoint":
      return "Deleted";
    default:
      return action;
  }
}
