import { NextRequest, NextResponse } from "next/server";
import { validateAndParseAddress } from "starknet";
import { getStore } from "@/server/store";
import { unauthorizedUnlessMerchant } from "@/server/merchantAuth";
import { sweepOpenIntents } from "@/server/intentSweep";
import { csvDocument, formatUnits } from "@/utils/csv";
import { isValidNetworkIndex, tokenDecimals, isTokenSymbol, Strk20Networks } from "@/utils/constants";
import { netAfterFee } from "@/utils/fees";

// A merchant's own record of what they were paid, as a spreadsheet.
//
// This is the disclosure story Nomos can honestly tell. Nomos is a custodial
// processor: it holds the operating wallet's viewing key and sees payments
// into it, exactly as Stripe sees yours. What is private is the *chain* —
// amounts, senders and totals are not public information. It is not private
// from Nomos, and Nomos cannot grant a third party a cryptographic view of
// one merchant's payments, because there is no per-merchant viewing key to
// grant. See docs/disclosure.
//
// So the merchant discloses, not the protocol: they export their own record
// and hand it to whoever needs it. That covers the case that actually comes
// up — an accountant, a tax filing, an investor asking to see revenue — and
// it does so without either party trusting a claim Nomos cannot back.
//
// Every row carries gross, fee and net, because a merchant reconciling
// against their balance needs the arithmetic to close.
export async function GET(request: NextRequest) {
  const to = request.nextUrl.searchParams.get("to");
  const networkRaw = request.nextUrl.searchParams.get("network");

  if (!to) {
    return NextResponse.json({ error: "Missing ?to=<address>." }, { status: 400 });
  }
  const networkIndex = networkRaw !== null ? Number(networkRaw) : NaN;
  if (!isValidNetworkIndex(networkIndex)) {
    return NextResponse.json({ error: "Missing or invalid ?network=." }, { status: 400 });
  }
  let normalizedTo: string;
  try {
    normalizedTo = validateAndParseAddress(to);
  } catch {
    return NextResponse.json({ error: "to is not a valid Starknet address." }, { status: 400 });
  }

  // Same credential as every other merchant endpoint: a console session or a
  // secret key. An export is the whole ledger in one file, so it is emphatically
  // not a public route.
  const denied = await unauthorizedUnlessMerchant({ request, address: normalizedTo, networkIndex });
  if (denied) return denied;

  // Settle anything that arrived without the payer's tab saying so, or the
  // export would be a record with known gaps in it.
  await sweepOpenIntents({ networkIndex, merchantAddress: normalizedTo });

  const deposits = await getStore().listDepositsFor(normalizedTo, networkIndex);

  const rows = deposits
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt)
    .map((d) => {
      const decimals = isTokenSymbol(d.token) ? tokenDecimals(d.token) : 18;
      const fee = d.feeWei ?? 0n;
      return [
        new Date(d.recordedAt * 1000).toISOString(),
        d.reference,
        d.ref ?? "",
        d.note ?? "",
        d.token,
        formatUnits(d.amountWei, decimals),
        formatUnits(fee, decimals),
        formatUnits(netAfterFee(d.amountWei, fee), decimals),
        d.flow === "A" ? "private" : "public",
        d.status,
        d.txHash,
      ];
    });

  const csv = csvDocument(
    ["date_utc", "reference", "your_reference", "note", "token", "gross", "nomos_fee", "net", "flow", "status", "transaction"],
    rows
  );

  const network = (Strk20Networks[networkIndex] ?? `network-${networkIndex}`).toLowerCase();
  const filename = `nomos-payments-${network}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A ledger export is never a thing to cache.
      "Cache-Control": "no-store",
    },
  });
}
