import { readFileSync } from "node:fs";
import type { DataRequest, Decision, Grant, LedgerEvent } from "@consent-guard/policy";
import { createFixtureAdapter, loadFixtureResponses } from "@consent-guard/proxy";
import type { FixtureResponse, LlmAdapter } from "@consent-guard/proxy";
import type { DemoPipeline, PipelineRequestResult } from "./pipeline.ts";

const FIXTURES_DIR = new URL("../../../fixtures/", import.meta.url);
const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(name, FIXTURES_DIR), "utf8"));

export const MINUTE_MS = 60_000;

interface DemoFixture {
  clock: { now: number; tenMinMs: number };
  grants: Grant[];
  requests: DataRequest[];
  afterRevoke: Record<string, DataRequest>;
}

export type SampleData = Record<string, Record<string, unknown>[]>;

// Repo-owned fixture files; shapes match the shared contract types in @consent-guard/policy.
export const demoFixture = readJson("demo.json") as DemoFixture;
export const sampleData = readJson("sample-data.json") as SampleData;
export const aiResponses: FixtureResponse[] = loadFixtureResponses(readJson("ai-responses.json"));

/** Demo clock start from fixtures/demo.json (2026-11-20 20:00 KST). */
export const SCENE_START: number = demoFixture.clock.now;

/** Replays fixtures/ai-responses.json; never calls a live model. */
export function createDemoAdapter(): LlmAdapter {
  return createFixtureAdapter(aiResponses);
}

function fixtureGrant(id: string): Grant {
  const g = demoFixture.grants.find((x) => x.id === id);
  if (!g) throw new Error(`fixtures/demo.json has no grant ${id}`);
  return g;
}

/** Fixture request without its `at`; the pipeline clock supplies the time when the scene runs. */
function fixtureRequest(id: string): SceneRequest {
  const all = [...demoFixture.requests, ...Object.values(demoFixture.afterRevoke)];
  const r = all.find((x) => x.id === id);
  if (!r) throw new Error(`fixtures/demo.json has no request ${id}`);
  const { at: _at, ...rest } = r;
  return rest;
}

export type SceneRequest = Omit<DataRequest, "at">;

export type SceneStep =
  | { op: "grant"; grant: Grant }
  | { op: "request"; request: SceneRequest; expect: Decision }
  | { op: "advance"; ms: number }
  | { op: "revoke"; grantId: string };

export interface Scene {
  id: string;
  title: string;
  steps: SceneStep[];
}

export const DEMO_SCENES: readonly Scene[] = [
  {
    id: "1-card-budget",
    title: "카드 내역 자동 허용 (가맹점명 *** 마스킹) / card history auto-allowed, merchant masked",
    steps: [
      { op: "grant", grant: fixtureGrant("grant-card-budget") },
      { op: "request", request: fixtureRequest("req-card-budget"), expect: "allow" },
    ],
  },
  {
    id: "2-account-number",
    title: "계좌번호 원문 차단 / raw account_number blocked",
    steps: [{ op: "request", request: fixtureRequest("req-account-raw"), expect: "deny" }],
  },
  {
    id: "3-medical-pending",
    title: "진료기록 전체 요청은 소유자 승인 대기 / full medical_record waits for owner approval",
    steps: [{ op: "request", request: fixtureRequest("req-medical-full"), expect: "pending" }],
  },
  {
    id: "4-allergy-ttl",
    title: "식단용 알레르기 10분 허용 후 만료 / allergy allowed for diet, 10-minute grant expires",
    steps: [
      { op: "grant", grant: fixtureGrant("grant-allergy-diet") },
      { op: "request", request: fixtureRequest("req-allergy-diet"), expect: "allow" },
      { op: "advance", ms: 11 * MINUTE_MS },
      {
        op: "request",
        request: { ...fixtureRequest("req-allergy-diet"), id: "req-allergy-diet-expired" },
        expect: "deny",
      },
    ],
  },
  {
    id: "5-revoke",
    title: "동의 철회 후 재요청 차단 / revoke, then re-request is denied",
    steps: [
      { op: "revoke", grantId: "grant-card-budget" },
      { op: "request", request: fixtureRequest("req-card-after-revoke"), expect: "deny" },
    ],
  },
];

export type StepOutcome =
  | { op: "grant"; grant: Grant; event: LedgerEvent }
  | { op: "request"; request: DataRequest; expect: Decision; result: PipelineRequestResult }
  | { op: "advance"; ms: number; now: number }
  | { op: "revoke"; grantId: string; event: LedgerEvent };

export interface SceneRun {
  scene: Scene;
  outcomes: StepOutcome[];
}

export interface RunScenesOptions {
  scenes?: readonly Scene[];
  /** Rows per dataset handed to the proxy; datasets missing here get no rows. */
  rows?: SampleData;
  /** Called after every step, e.g. to print as the demo goes. */
  onStep?: (scene: Scene, outcome: StepOutcome) => void;
}

/** Runs scenes in order against one pipeline; requests are stamped with the pipeline clock. */
export async function runScenes(pipeline: DemoPipeline, opts: RunScenesOptions = {}): Promise<SceneRun[]> {
  const { scenes = DEMO_SCENES, rows = sampleData, onStep } = opts;
  const runs: SceneRun[] = [];
  for (const scene of scenes) {
    const outcomes: StepOutcome[] = [];
    for (const step of scene.steps) {
      let outcome: StepOutcome;
      switch (step.op) {
        case "grant":
          outcome = { op: "grant", grant: step.grant, event: await pipeline.grant(step.grant) };
          break;
        case "request": {
          const request: DataRequest = { ...step.request, at: pipeline.now() };
          const result = await pipeline.request(request, rows[request.dataset] ?? []);
          outcome = { op: "request", request, expect: step.expect, result };
          break;
        }
        case "advance":
          outcome = { op: "advance", ms: step.ms, now: pipeline.advance(step.ms) };
          break;
        case "revoke":
          outcome = { op: "revoke", grantId: step.grantId, event: await pipeline.revoke(step.grantId) };
          break;
      }
      outcomes.push(outcome);
      onStep?.(scene, outcome);
    }
    runs.push({ scene, outcomes });
  }
  return runs;
}
