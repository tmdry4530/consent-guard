// Typed loader for the repo-root demo fixtures (bundled by Vite, loaded by tsx in tests).
import type { DataRequest, Grant } from "../../../packages/policy/src/types";
import demoJson from "../../../fixtures/demo.json";
import sampleJson from "../../../fixtures/sample-data.json";
import aiJson from "../../../fixtures/ai-responses.json";

export interface DemoFixtures {
  grants: Grant[];
  requests: DataRequest[];
  /** grantId -> follow-up request enqueued automatically when that grant is revoked */
  afterRevoke: Record<string, DataRequest>;
}

export interface RecordedAiResponse {
  requestId: string;
  text: string;
  recorded: true;
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

export const aiResponses: ReadonlyMap<string, RecordedAiResponse> = new Map(
  (aiJson.responses as RecordedAiResponse[]).map((r) => [r.requestId, r]),
);
