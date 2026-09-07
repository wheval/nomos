"use client";

import styles from "../../../uni.module.css";
import { TokenSymbols, type TokenSymbol } from "@/utils/constants";
import { TokenLogo } from "../../TokenIcons";

// Amount and token as one control.
//
// They were two: a row of token pills, then a separate labelled input further
// down. That reads as two unrelated decisions when it is one — you are naming
// a price, and a price is a number and a unit together. Splitting them also
// meant the amount's label had to carry the token ("Amount (USDC)") to stay
// intelligible, which is the giveaway that the two belong in the same place.
//
// Used by payouts, payment links and invoices, so the three agree.
export default function AmountField({
  id,
  amount,
  onAmountChange,
  token,
  onTokenChange,
  placeholder = "0.00",
  amountDisabled = false,
  autoFocus = false,
}: {
  id: string;
  amount: string;
  onAmountChange: (value: string) => void;
  token: TokenSymbol;
  onTokenChange: (token: TokenSymbol) => void;
  placeholder?: string;
  /**
   * Greys out the amount only, never the token.
   *
   * An open-amount payment link has no price to type but is still denominated
   * in something, so the token has to stay selectable.
   */
  amountDisabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className={styles.amountField}>
      <input
        id={id}
        className={styles.amountFieldInput}
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        disabled={amountDisabled}
        autoFocus={autoFocus}
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
      />
      <span className={styles.amountFieldToken}>
        <TokenLogo symbol={token} size={17} />
        <select
          className={styles.amountFieldSelect}
          aria-label="Token"
          value={token}
          onChange={(e) => onTokenChange(e.target.value as TokenSymbol)}
        >
          {TokenSymbols.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </span>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
