import { redirect } from "next/navigation";

/**
 * The old /backlog page is retired.
 * Redirects to the main dashboard which now has all candidate functionality.
 * The /recommendations page (Sprint 4) will replace this as the recommendation backlog.
 */
export default function BacklogPage() {
  redirect("/");
}
