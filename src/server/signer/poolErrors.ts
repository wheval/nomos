// Turning pool reverts into sentences a merchant can act on.
//
// A reverted STRK20 action surfaces as a wall of contract addresses, class
// hashes and selectors with the actual reason encoded as a felt somewhere
// inside it. That is the right amount of detail for a log and the wrong
// amount for a dashboard: the merchant needs to know what to do differently,
// and the console was showing them fifteen lines that do not say.
//
// Only reasons that have a merchant-actionable meaning are translated. An
// unrecognised revert keeps its original text — a wrong guess about what
// failed is worse than an ugly message.
const TRANSLATIONS: { match: RegExp; message: string }[] = [
  {
    match: /SUBCHANNEL_NOT_FOUND/,
    message:
      "That destination is not set up to receive private payouts on STRK20. " +
      "Choose Public (unshield) to withdraw to an ordinary wallet, or register the destination on the pool first.",
  },
  {
    match: /Insufficient ERC20 allowance/i,
    message:
      "The operating wallet has not approved the pool to collect its fee. " +
      "This is a Nomos-side setup problem, not something you can fix — the payout was not made.",
  },
  {
    match: /insufficient balance/i,
    message:
      "The pool reports an insufficient shielded balance for this token. " +
      "If the payment settled very recently, wait for it to mature and try again.",
  },
  {
    match: /Note not mature/i,
    message:
      "The notes backing this payout are too recent for the pool to spend yet. Try again in a minute.",
  },
];

export function explainPoolError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  for (const { match, message } of TRANSLATIONS) {
    if (match.test(raw)) return message;
  }
  return raw;
}
