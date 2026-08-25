import { ProviderInterface, RpcProvider } from "starknet";

// ─── Example config — swap these for your own token / pool / helper ─────────

// DEMO VALUE: the ERC-20 this starter shields. Replace with the token your app
// moves privately (STRK on Starknet here).
export const addrSTRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

// ─── Settlement tokens ───────────────────────────────────────────────────
// STRK20 is a privacy *protocol*, not a token — every action (deposit,
// transfer, withdraw) takes an explicit token address, so any ERC-20 the
// pool has onboarded can be shielded. USDC went live on STRK20 June 25,
// 2026. A payment gateway checkout should quote a dollar-pegged stablecoin
// by default, not a token whose USD value moves under the merchant — so
// both are offered, merchant picks per Payment Link.
export type TokenSymbol = "STRK" | "USDC";

export const Tokens: Record<TokenSymbol, { decimals: number; addresses: Record<number, string> }> = {
  STRK: {
    decimals: 18,
    addresses: { 0: addrSTRK, 2: addrSTRK },
  },
  USDC: {
    decimals: 6,
    // Native USDC on Starknet — addresses from starknet-io/starknet-addresses
    // (bridged_tokens/{mainnet,sepolia}.json), the canonical registry.
    addresses: {
      0: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
      2: "0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080",
    },
  },
};

export const TokenSymbols: TokenSymbol[] = ["STRK", "USDC"];

// Resolve a token symbol to its contract address on a given frontend
// provider index (0 = Mainnet, 2 = Sepolia). "0x0" if unmapped.
export function tokenAddressFor(symbol: TokenSymbol, networkIndex: number): string {
  return Tokens[symbol]?.addresses[networkIndex] ?? "0x0";
}

export function tokenDecimals(symbol: TokenSymbol): number {
  return Tokens[symbol]?.decimals ?? 18;
}

export function isTokenSymbol(value: unknown): value is TokenSymbol {
  return value === "STRK" || value === "USDC";
}

// Frontend RPC providers, indexed. The STRK20 privacy pool lives on Mainnet (0)
// and Sepolia (2); index 1 is a spare public testnet endpoint. NEXT_PUBLIC_PROVIDER_URL
// is your Alchemy key (see .env.example).
export const myFrontendProviders: ProviderInterface[] = [
    new RpcProvider({ nodeUrl: "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/" + process.env.NEXT_PUBLIC_PROVIDER_URL }),
    new RpcProvider({ nodeUrl: "https://starknet-testnet.public.blastapi.io/rpc/v0_7" }),
    new RpcProvider({ nodeUrl: "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/" + process.env.NEXT_PUBLIC_PROVIDER_URL })];

// ─── Example anonymizer (echo helper) ───────────────────────────────────────
// DEMO CONTRACT: StrkInvokeHelper (cairo/src/lib.cairo) just round-trips STRK
// through an open note to exercise the privacy_invoke flow end to end. Replace
// with your real anonymizer that performs an actual protocol action.

// DEMO VALUE: echo helper deployed on Mainnet.
export const Strk20EchoHelperAddress = "0x78ae662e0cc6d1ab2cfeaf2a51ba8783d88e31886f88a794d142f95a6f8735b";

// Echo helper on Sepolia — set NEXT_PUBLIC_STRK20_ECHO_HELPER_SEPOLIA to enable the
// Echo action there. "0x0" = not deployed (the action stays disabled). Deploy a fresh
// instance from the Echo tab, then paste the address into .env.local.
export const Strk20EchoHelperSepolia = process.env.NEXT_PUBLIC_STRK20_ECHO_HELPER_SEPOLIA ?? "0x0";

// Declared class hash of the echo helper (Mainnet + Sepolia). Deploying a fresh
// instance (no constructor args) needs only this class hash + a signed UDC deploy.
// See cairo/address.md.
export const Strk20EchoHelperClassHash = "0x2a4482a13cb7f70dce6f7ba99c4ee6ce404379abeddd9b831b6bf24eb71e137";

// Resolve the echo helper for a frontend provider index (0 = Mainnet, 2 = Sepolia).
// Returns "0x0" when no helper is deployed on that network.
export function echoHelperForIndex(index: number): string {
    if (index === 0) return Strk20EchoHelperAddress;
    if (index === 2) return Strk20EchoHelperSepolia;
    return "0x0";
}

// Frontend provider indices where the STRK20 privacy pool is available, mapped to a
// display name. Used to gate the WalletAccountV6 STRK20 actions.
export const Strk20Networks: Record<number, string> = { 0: "MAINNET", 2: "SEPOLIA" };

// ─── Operating wallet (custodial hold-until-payout model) ──────────────────
// Nomos's own account — the recipient of both checkout flows. Deployed on
// Sepolia; see cairo/address.md and docs/ARCHITECTURE.md "Custody & signing".
// Public info (just an address), safe to ship to the client — the signing
// key stays server-only (NOMOS_OPERATING_WALLET_PRIVKEY, never NEXT_PUBLIC_*).
export const operatingWalletAddress = process.env.NEXT_PUBLIC_NOMOS_OPERATING_WALLET_ADDRESS ?? "0x0";
