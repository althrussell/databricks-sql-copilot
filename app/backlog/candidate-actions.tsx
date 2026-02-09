"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Candidate } from "@/lib/domain/types";

interface CandidateActionsProps {
  fingerprint: string;
  status: Candidate["status"];
}

/**
 * Row-level actions for a candidate.
 *
 * State is stored locally (in-memory) for Sprint 1.
 * Sprint 2+ may persist to a table or local storage.
 */
export function CandidateActions({
  status: initialStatus,
}: CandidateActionsProps) {
  const [status, setStatus] = useState(initialStatus);

  if (status === "DISMISSED") {
    return (
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setStatus("NEW")}
        className="text-muted-foreground"
      >
        Restore
      </Button>
    );
  }

  if (status === "WATCHING") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground mr-1">Watching</span>
        <Button variant="ghost" size="xs" onClick={() => setStatus("NEW")}>
          Stop
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {/* Primary: Investigate (placeholder for Sprint 2 detail page) */}
      <Button variant="default" size="xs">
        Investigate
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setStatus("WATCHING")}
      >
        Watch
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setStatus("DISMISSED")}
        className="text-muted-foreground"
      >
        Dismiss
      </Button>
    </div>
  );
}
