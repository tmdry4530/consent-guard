// DOM-free verify logic used by app.js (and by the parity test). Same core.js as node.
import { fetchAnchor, parseEventsJson, verifyAgainstAnchor, webCryptoSha256Hex } from "../src/core.js";

/** The sha256 the page uses (WebCrypto). */
export const pageSha256Hex = webCryptoSha256Hex;

/**
 * @param {{ eventsText: string, anchorSource: "rpc" | "pasted", pastedHead?: string,
 *           rpcUrl?: string, contractId?: string, fetchImpl?: typeof fetch }} input
 * @returns {Promise<import("../src/core.js").AnchorCheck & { anchorSource: string, anchor?: object, eventCount?: number }>}
 */
export async function runVerification({ eventsText, anchorSource, pastedHead = "", rpcUrl = "", contractId = "", fetchImpl }) {
  if (!eventsText.trim()) return { ok: false, status: "no-events", reason: "no events: paste JSON or load a file", anchorSource };
  let events;
  try {
    events = parseEventsJson(eventsText);
  } catch (e) {
    return { ok: false, status: "no-events", reason: `events JSON could not be parsed: ${e.message}`, anchorSource };
  }

  let anchor = null;
  if (anchorSource === "pasted") {
    if (!pastedHead.trim()) return { ok: false, status: "no-anchor", reason: "paste an anchor head hash (offline mode)", anchorSource, eventCount: events.length };
    anchor = { headHash: pastedHead };
  } else {
    if (!rpcUrl.trim() || !contractId.trim()) {
      return { ok: false, status: "no-anchor", reason: "set RPC URL and contract id to read the on-chain anchor", anchorSource, eventCount: events.length };
    }
    try {
      anchor = await fetchAnchor({ rpcUrl: rpcUrl.trim(), contractId: contractId.trim(), fetchImpl: fetchImpl ?? globalThis.fetch.bind(globalThis) });
    } catch (e) {
      return { ok: false, status: "no-anchor", reason: `could not read on-chain anchor from ${contractId}: ${e.message}`, anchorSource, eventCount: events.length };
    }
    if (!anchor) return { ok: false, status: "no-anchor", reason: `contract ${contractId} has no anchor yet (read_anchor returned null)`, anchorSource, eventCount: events.length };
  }

  const res = await verifyAgainstAnchor(events, anchor, pageSha256Hex);
  return { ...res, anchorSource, anchor, eventCount: events.length };
}
