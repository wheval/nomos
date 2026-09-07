import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateAndParseAddress } from "starknet";
import { encodeSession } from "@/server/merchantAuth";

const walletOwnsAddress = vi.fn(async () => true);
vi.mock("@/server/walletProof", async () => {
  const actual = await vi.importActual<typeof import("@/server/walletProof")>("@/server/walletProof");
  return { ...actual, walletOwnsAddress };
});

const { GET, POST } = await import("./route");

const ADDR = "0x" + "1".repeat(63);
// The route compares against validateAndParseAddress's output, which pads to
// 64 hex characters. A session minted from the raw string would not match —
// which is correct, and is what the real POST stores.
const NORMALIZED = validateAndParseAddress(ADDR).toLowerCase();

function get(cookie?: string) {
  return new NextRequest(`http://localhost/api/merchant-session?address=${ADDR}&network=2`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  walletOwnsAddress.mockResolvedValue(true);
});

describe("GET /api/merchant-session", () => {
  it("issues a challenge when there is no session", async () => {
    const body = await (await GET(get())).json();
    expect(body.authenticated).toBe(false);
    expect(typeof body.challenge).toBe("string");
    expect(body.typedData.primaryType).toBe("Login");
  });

  // A session lasts two weeks. Asking the wallet to sign again on every page
  // load is how people learn to approve prompts without reading them.
  it("reports an existing session instead of asking for another signature", async () => {
    const cookie = `nomos_session=${encodeSession(NORMALIZED, 2)}`;
    const body = await (await GET(get(cookie))).json();
    expect(body.authenticated).toBe(true);
    expect(body.challenge).toBeUndefined();
  });

  it("does not accept a session belonging to another wallet", async () => {
    const other = validateAndParseAddress("0x" + "2".repeat(63)).toLowerCase();
    const cookie = `nomos_session=${encodeSession(other, 2)}`;
    expect((await (await GET(get(cookie))).json()).authenticated).toBe(false);
  });

  it("does not accept a session for another network", async () => {
    const cookie = `nomos_session=${encodeSession(NORMALIZED, 0)}`;
    expect((await (await GET(get(cookie))).json()).authenticated).toBe(false);
  });

  it("does not accept a forged or expired session", async () => {
    expect((await (await GET(get("nomos_session=not.a.session"))).json()).authenticated).toBe(false);
    const stale = encodeSession(NORMALIZED, 2, Date.now() - 1000 * 60 * 60 * 24 * 30);
    expect((await (await GET(get(`nomos_session=${stale}`))).json()).authenticated).toBe(false);
  });
});

describe("POST /api/merchant-session", () => {
  async function post(body: unknown) {
    return POST(
      new NextRequest("http://localhost/api/merchant-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }

  it("still refuses a bare address, session check or not", async () => {
    expect((await post({ address: ADDR, networkIndex: 2 })).status).toBe(400);
  });

  it("refuses a signature that does not prove ownership", async () => {
    walletOwnsAddress.mockResolvedValue(false);
    const { challenge } = await (await GET(get())).json();
    const res = await post({ address: ADDR, networkIndex: 2, challenge, signature: ["0x1"] });
    expect(res.status).toBe(401);
  });

  it("opens a session for a signature that does", async () => {
    const { challenge } = await (await GET(get())).json();
    const res = await post({ address: ADDR, networkIndex: 2, challenge, signature: ["0x1", "0x2"] });
    expect(res.status).toBe(200);
    expect(res.cookies.get("nomos_session")?.value).toBeTruthy();
  });
});
