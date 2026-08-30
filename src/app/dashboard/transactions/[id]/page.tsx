"use client";

import { use } from "react";
import ConsoleShell from "../../../components/ConsoleShell";
import TransactionDetailPanel from "../../../components/client/Payments/TransactionDetailPanel";

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <ConsoleShell>
      <TransactionDetailPanel id={id} />
    </ConsoleShell>
  );
}
