"use client";

import ConsoleShell from "../../components/ConsoleShell";
import TransactionsPanel from "../../components/client/Payments/TransactionsPanel";

export default function TransactionsPage() {
  return (
    <ConsoleShell>
      <TransactionsPanel />
    </ConsoleShell>
  );
}
