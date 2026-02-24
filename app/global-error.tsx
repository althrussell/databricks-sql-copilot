"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error-boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased bg-background text-foreground">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1.5rem" }}>
          <div style={{ maxWidth: "28rem", width: "100%", textAlign: "center" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Application Error
            </h1>
            <p style={{ fontSize: "0.875rem", color: "#71717a", marginBottom: "1.5rem" }}>
              {error.message || "A critical error occurred. Please try refreshing the page."}
            </p>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "1px solid #d4d4d8",
                borderRadius: "0.375rem",
                cursor: "pointer",
                background: "transparent",
                color: "inherit",
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
