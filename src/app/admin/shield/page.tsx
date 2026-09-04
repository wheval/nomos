import type { Metadata } from "next";
import ShieldPanel from "../../components/client/Admin/ShieldPanel";

// Internal operator tooling — never a search result, and never a page a
// merchant is meant to find.
export const metadata: Metadata = {
  title: "Shield queue",
  robots: { index: false, follow: false },
};

export default function AdminShieldPage() {
  return <ShieldPanel />;
}
