// Typed loader for the repo-root demo fixtures (bundled by Vite, loaded by tsx in tests).
import type { DataRequest, Grant } from "@consent-guard/policy";
import { loadFixtureResponses, type FixtureResponse } from "@consent-guard/proxy";
import demoJson from "../../../fixtures/demo.json";
import sampleJson from "../../../fixtures/sample-data.json";
import aiJson from "../../../fixtures/ai-responses.json";

export interface DemoFixtures {
  grants: Grant[];
  requests: DataRequest[];
  /** grantId -> follow-up request enqueued automatically when that grant is revoked */
  afterRevoke: Record<string, DataRequest>;
  /** grantId -> follow-up request enqueued when the demo clock passes that grant's expiresAt (`at` is re-stamped) */
  afterExpire: Record<string, DataRequest>;
}

export type SampleRow = Record<string, string | number | string[]>;
export type SampleData = Record<string, SampleRow[]>;

/** Fixed demo clock: 1795172400000 = 2026-11-20T11:00:00.000Z (20:00 KST). */
export const NOW: number = demoJson.clock.now;
export const TEN_MIN: number = demoJson.clock.tenMinMs;

export function loadDemo(): DemoFixtures {
  // structuredClone so callers can never mutate the shared fixture objects.
  return structuredClone(demoJson as DemoFixtures);
}

export const sampleData: SampleData = sampleJson as SampleData;

/** Validated recorded AI answers (fixtures/ai-responses.json), fed to the proxy's fixture adapter. */
export const aiFixtures: readonly FixtureResponse[] = loadFixtureResponses(aiJson);
