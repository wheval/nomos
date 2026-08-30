"use client";

import { use } from "react";
import ConsoleShell from "../../../components/ConsoleShell";
import LinkDetailPanel from "../../../components/client/Payments/LinkDetailPanel";

export default function LinkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ConsoleShell>
      <LinkDetailPanel id={id} />
    </ConsoleShell>
  );
}
