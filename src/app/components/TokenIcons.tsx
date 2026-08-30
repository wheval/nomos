// Real token logos, served from /public/tokens. Plain <img> (no next/image config).

type IconProps = { size?: number; className?: string };

function coin(src: string, alt: string) {
  return function Coin({ size = 32, className }: IconProps) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={className}
        style={{ display: "block", borderRadius: "50%" }}
      />
    );
  };
}

export const StrkCoin = coin("/tokens/strk.png", "STRK");
export const EthCoin = coin("/tokens/eth.png", "ETH");
export const BtcCoin = coin("/tokens/btc.webp", "BTC");
export const UsdcCoin = coin("/tokens/usdc.webp", "USDC");
export const ZecCoin = coin("/tokens/zec.png", "ZEC");

// Resolve a token symbol to its logo. Anything unmapped renders nothing
// rather than a broken image — a new token in the ledger shouldn't blank the
// row it appears in.
const BY_SYMBOL: Record<string, ReturnType<typeof coin>> = {
  STRK: StrkCoin,
  USDC: UsdcCoin,
  ETH: EthCoin,
  BTC: BtcCoin,
  ZEC: ZecCoin,
};

export function TokenLogo({ symbol, size = 16 }: { symbol: string; size?: number }) {
  const Icon = BY_SYMBOL[symbol?.toUpperCase()];
  return Icon ? <Icon size={size} /> : null;
}

/**
 * A token symbol shown with its logo — the pairing every amount and token
 * selector should use, so a token is recognised at a glance rather than read.
 * `amount` renders ahead of the logo when given.
 */
export function TokenAmount({
  amount,
  symbol,
  size = 16,
}: {
  amount?: string;
  symbol: string;
  size?: number;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
      {amount !== undefined ? <span>{amount}</span> : null}
      <TokenLogo symbol={symbol} size={size} />
      <span>{symbol}</span>
    </span>
  );
}
