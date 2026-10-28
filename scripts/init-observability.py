#!/usr/bin/env python3
"""Run Databricks SQL files statement by statement on a SQL warehouse.

Uses the SQL Statement Execution API through the Databricks CLI and stops at the
first failing statement (non-zero exit), so callers never proceed on a partial bootstrap.
"""

import argparse
import json
import os
import subprocess
import sys
import time

TERMINAL_STATES = {"SUCCEEDED", "FAILED", "CANCELED", "CLOSED"}


def split_statements(sql: str) -> list[str]:
    """Split on top-level semicolons, skipping quoted text and dropping comments."""
    statements: list[str] = []
    buf: list[str] = []
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""
        if ch == "-" and nxt == "-":
            end = sql.find("\n", i)
            i = n if end == -1 else end
            continue
        if ch == "/" and nxt == "*":
            end = sql.find("*/", i + 2)
            if end == -1:
                raise ValueError("unterminated block comment")
            # Optimizer hints (/*+ ... */) are part of the statement.
            buf.append(sql[i : end + 2] if sql.startswith("/*+", i) else " ")
            i = end + 2
            continue
        if ch in ("'", '"', "`"):
            # r'...' / r"..." raw literals have no escape character.
            raw = (
                ch != "`"
                and i > 0
                and sql[i - 1] in "rR"
                and (i < 2 or not (sql[i - 2].isalnum() or sql[i - 2] == "_"))
            )
            j = i + 1
            while j < n:
                if sql[j] == "\\" and ch != "`" and not raw:
                    j += 2
                    continue
                if sql[j] == ch:
                    break
                j += 1
            if j >= n:
                raise ValueError("unterminated quoted literal")
            buf.append(sql[i : j + 1])
            i = j + 1
            continue
        if ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def api(profile: str, method: str, path: str, payload: dict | None = None) -> dict:
    cmd = ["databricks", "api", method, path, "--profile", profile]
    if payload is not None:
        cmd += ["--json", json.dumps(payload)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())
    return json.loads(proc.stdout or "{}")


def run_statement(args: argparse.Namespace, statement: str) -> None:
    resp = api(
        args.profile,
        "post",
        "/api/2.0/sql/statements",
        {
            "warehouse_id": args.warehouse,
            "catalog": args.catalog,
            "statement": statement,
            "wait_timeout": "30s",
            "on_wait_timeout": "CONTINUE",
        },
    )
    statement_id = resp.get("statement_id")
    deadline = time.time() + args.timeout
    while resp.get("status", {}).get("state") not in TERMINAL_STATES:
        if time.time() > deadline:
            api(args.profile, "post", f"/api/2.0/sql/statements/{statement_id}/cancel")
            raise RuntimeError(f"timed out after {args.timeout}s (statement cancelled)")
        time.sleep(3)
        resp = api(args.profile, "get", f"/api/2.0/sql/statements/{statement_id}")
    status = resp["status"]
    if status["state"] != "SUCCEEDED":
        raise RuntimeError(status.get("error", {}).get("message") or status["state"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, help="Databricks CLI profile")
    parser.add_argument("--warehouse", required=True, help="SQL warehouse ID")
    parser.add_argument("--catalog", default="main", help="default catalog for two-part names")
    parser.add_argument("--timeout", type=int, default=900, help="per-statement timeout (s)")
    parser.add_argument("--dry-run", action="store_true", help="list statements without running")
    parser.add_argument("files", nargs="+")
    args = parser.parse_args()

    for path in args.files:
        with open(path, encoding="utf-8") as f:
            statements = split_statements(f.read())
        for idx, statement in enumerate(statements, 1):
            label = f"{os.path.basename(path)} [{idx}/{len(statements)}] {statement.splitlines()[0][:70]}"
            if args.dry_run:
                print(f"  · {label}")
                continue
            try:
                run_statement(args, statement)
            except Exception as err:  # noqa: BLE001 — surface any CLI/API/SQL failure
                print(f"  ✗ {label}\n    {err}", file=sys.stderr)
                return 1
            print(f"  ✓ {label}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
