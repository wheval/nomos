import { redirect } from "next/navigation";

// Kept as a redirect rather than deleted: /create was the Payment Links list
// for long enough to have been shared and bookmarked, and it is still what the
// landing page's primary CTA points at.
export default function CreatePage() {
  redirect("/dashboard/links");
}
