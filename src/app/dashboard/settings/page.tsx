"use client";

import { Suspense } from "react";
import ConsoleShell from "../../components/ConsoleShell";
import SettingsPanel from "../../components/client/Payments/SettingsPanel";

export default function SettingsPage() {
  return (
    <ConsoleShell>
      {/* SettingsPanel reads ?tab= via useSearchParams, which the App Router
          requires a Suspense boundary for. */}
      <Suspense fallback={null}>
        <SettingsPanel />
      </Suspense>
    </ConsoleShell>
  );
}
