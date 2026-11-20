// Browser-safe drop-in for apps/web/src/ledgerAdapter.ts.
// Same function names and signatures as the U3 mock, including verifyChain(): Promise<boolean>.
// The detailed { ok, index, reason } inspector lives on the package root / ./core as verifyChain.
import { verifyChain as inspectChain } from "./core.js";

export {
  GENESIS_HASH,
  canonicalJson,
  hashEvent,
  createEvent,
  append,
  list,
} from "./core.js";

/** Boolean wrapper matching the U3 mock. For the first-bad-index report, import verifyChain from `@consent-guard/ledger` or `./core.js`. */
export async function verifyChain(chain, sha256) {
  return (await inspectChain(chain, sha256)).ok;
}
