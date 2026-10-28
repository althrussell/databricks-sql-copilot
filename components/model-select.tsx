"use client";

import { SUPPORTED_MODEL_OPTIONS } from "@/lib/ai/model-config";

/** Sends no override, so the server applies tiered routing and any AI_MODEL_* env settings. */
export const AUTO_MODEL = "";

export function ModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Select AI model"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
    >
      <option value={AUTO_MODEL}>Auto (tiered routing)</option>
      {SUPPORTED_MODEL_OPTIONS.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
