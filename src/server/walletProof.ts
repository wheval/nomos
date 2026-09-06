// Proving that whoever is asking for a merchant session actually holds the
// wallet they claim.
//
// Until this existed, POST /api/merchant-session took an address out of the
// request body and issued a signed session cookie for it, with nothing in
// between. A Starknet address is public — it is on every explorer and in
// every payment link — so anyone who knew a merchant's address could open
// their console, read their whole ledger, and call /api/payouts, which takes
// the destination from the caller. That is a complete path to draining a
// merchant's balance, requiring no secret at all.
//
// The fix is the ordinary one: the server issues a challenge, the wallet
// signs it, and the server checks the signature against the account contract
// before it will hand out a session. This is what "connect your wallet to
// log in" is supposed to mean.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { TypedData } from "starknet";
import { RpcProvider } from "starknet";
import { myFrontendProviders } from "@/utils/constants";
import { chainIdForIndex } from "@/utils/networks";

// Long enough for someone to read the wallet prompt and decide, short enough
// that a captured challenge is worth little. The signature only ever travels
// to this server over TLS, so the window is the whole exposure.
export const CHALLENGE_TTL_SECONDS = 300;

type ChallengePayload = { a: string; n: number; iat: number; r: string };

// Stateless, so it survives the serverless instance that issued it not being
// the one that verifies it. The alternative — a nonce table — would need a
// store method and a sweep, and buys single-use semantics that the TTL and
// TLS already make close to moot here.
function challengeSecret(): string {
  return process.env.NOMOS_SESSION_SECRET || process.env.NOMOS_SHIELD_WORKER_SECRET || "nomos-dev-session";
}

function sign(body: string): string {
  return createHmac("sha256", challengeSecret()).update(body).digest("base64url");
}

export function issueChallenge(address: string, networkIndex: number, now = Date.now()): string {
  const payload: ChallengePayload = {
    a: address.toLowerCase(),
    n: networkIndex,
    iat: Math.floor(now / 1000),
    r: randomBytes(12).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Is this a challenge we issued, to this address, recently? */
export function challengeIsValid(
  challenge: string,
  address: string,
  networkIndex: number,
  now = Date.now()
): boolean {
  const dot = challenge.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = challenge.slice(0, dot);
  const given = Buffer.from(challenge.slice(dot + 1));
  const expected = Buffer.from(sign(body));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ChallengePayload;
  } catch {
    return false;
  }
  if (payload.a !== address.toLowerCase() || payload.n !== networkIndex) return false;
  return payload.iat * 1000 + CHALLENGE_TTL_SECONDS * 1000 > now;
}

/**
 * What the merchant is asked to sign.
 *
 * Built identically on both sides — the client signs what this returns, and
 * the server verifies against what this returns — so the two can never drift
 * apart into a signature that is valid but for a different message.
 */
export function loginTypedData(challenge: string, networkIndex: number): TypedData {
  return {
    domain: {
      name: "Nomos",
      version: "1",
      chainId: chainIdForIndex(networkIndex),
      revision: "1",
    },
    primaryType: "Login",
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Login: [
        { name: "statement", type: "string" },
        { name: "challenge", type: "string" },
      ],
    },
    message: {
      statement: "Sign in to the Nomos merchant console. This does not authorise any payment.",
      challenge,
    },
  };
}

/**
 * Does this signature come from the account at `address`?
 *
 * Asks the account contract itself (is_valid_signature), so it works for
 * Argent, Braavos and anything else implementing the standard, and it keeps
 * working when a wallet changes its signing scheme. An undeployed account
 * cannot answer and is refused — a merchant being paid has a deployed one.
 */
export async function walletOwnsAddress(opts: {
  address: string;
  networkIndex: number;
  challenge: string;
  signature: string[];
}): Promise<boolean> {
  const provider = myFrontendProviders[opts.networkIndex];
  if (!(provider instanceof RpcProvider)) return false;
  try {
    return await provider.verifyMessageInStarknet(
      loginTypedData(opts.challenge, opts.networkIndex),
      opts.signature,
      opts.address
    );
  } catch {
    // A reverted is_valid_signature, an undeployed account, or an RPC
    // failure. None of them is proof of ownership.
    return false;
  }
}
