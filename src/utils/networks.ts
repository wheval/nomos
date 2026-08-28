import { constants as SNconstants } from "starknet";

export const MAINNET_INDEX = 0;
export const SEPOLIA_INDEX = 2;
export const NETWORK_STORAGE_KEY = "nomos:network-index";
export const LAST_WALLET_KEY = "nomos:wallet-name";

export function chainIdForIndex(index: number): string {
  return index === MAINNET_INDEX ? SNconstants.StarknetChainId.SN_MAIN : SNconstants.StarknetChainId.SN_SEPOLIA;
}

export function indexForChainId(chainId: string): number {
  return chainId === SNconstants.StarknetChainId.SN_MAIN ? MAINNET_INDEX : SEPOLIA_INDEX;
}

export function networkLabel(index: number): "Mainnet" | "Sepolia" {
  return index === MAINNET_INDEX ? "Mainnet" : "Sepolia";
}

export function readStoredNetworkIndex(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(NETWORK_STORAGE_KEY);
  if (raw === "0") return MAINNET_INDEX;
  if (raw === "2") return SEPOLIA_INDEX;
  return null;
}

export function writeStoredNetworkIndex(index: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NETWORK_STORAGE_KEY, String(index));
}
