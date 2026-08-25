"use client";

import ConsoleShell from "../components/ConsoleShell";
import OverviewPanel from "../components/client/Payments/OverviewPanel";

export default function DashboardPage() {
  return (
    <ConsoleShell>
      <OverviewPanel />
    </ConsoleShell>
  );
}
