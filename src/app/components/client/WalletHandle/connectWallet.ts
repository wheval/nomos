import { walletV6, validateAndParseAddress, WalletAccountV6 } from "starknet";
import { WALLET_API } from "@starknet-io/types-js";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";
import { myFrontendProviders } from "@/utils/constants";
import { LAST_WALLET_KEY, chainIdForIndex, indexForChainId } from "@/utils/networks";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";

export function forgetWallet() {
  if (typeof window !== "undefined") window.localStorage.removeItem(LAST_WALLET_KEY);
  useStoreWallet.getState().setConnected(false);
}

export async function rememberAndConnect(selectedWallet: WalletWithStarknetFeatures): Promise<void> {
  const walletStore = useStoreWallet.getState();
  walletStore.setMyStarknetWalletObject(selectedWallet);

  const providerIndex = useFrontendProvider.getState().currentFrontendProviderIndex;
  const myWA = await WalletAccountV6.connect(myFrontendProviders[providerIndex] ?? myFrontendProviders[2], selectedWallet);
  walletStore.setMyWalletAccount(myWA);

  const result = await walletV6.requestAccounts(selectedWallet);
  if (typeof result === "string") {
    throw new Error("This wallet is not compatible.");
  }
  if (Array.isArray(result) && result[0]) {
    walletStore.setAddressAccount(validateAndParseAddress(result[0]));
  }

  const perms = (await walletV6.getPermissions(selectedWallet)) as WALLET_API.Permission[];
  const connected = perms.includes(WALLET_API.Permission.ACCOUNTS);
  walletStore.setConnected(connected);
  if (!connected) return;

  const chainId = (await walletV6.requestChainId(selectedWallet)) as string;
  walletStore.setChain(chainId);
  walletStore.setWalletApiList(await walletV6.supportedSpecs(selectedWallet));
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LAST_WALLET_KEY, selectedWallet.name);
  }
}

export async function switchConnectedWalletNetwork(index: number): Promise<void> {
  const wallet = useStoreWallet.getState().StarknetWalletObject;
  if (!wallet) throw new Error("Connect a wallet first.");
  await walletV6.switchStarknetChain(wallet, chainIdForIndex(index));
  const chainId = (await walletV6.requestChainId(wallet)) as string;
  useStoreWallet.getState().setChain(chainId);
  const actual = indexForChainId(chainId);
  if (actual !== index) {
    throw new Error("Wallet stayed on a different network. Approve the switch in the extension.");
  }
}

export async function refreshConnectedChain(): Promise<void> {
  const wallet = useStoreWallet.getState().StarknetWalletObject;
  if (!wallet || !useStoreWallet.getState().isConnected) return;
  try {
    const chainId = (await walletV6.requestChainId(wallet)) as string;
    useStoreWallet.getState().setChain(chainId);
  } catch {
    /* extension locked or gone — leave chain as-is until next action */
  }
}
