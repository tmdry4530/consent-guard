export interface LlmInput {
  requestId: string;
  agentId: string;
  purpose: string;
  data: Record<string, unknown>[];
}

export interface LlmOutput {
  text: string;
  recorded: boolean;
  source: string;
}

export interface LlmAdapter {
  name: string;
  complete(input: LlmInput): Promise<LlmOutput>;
}

export interface FixtureResponse {
  requestId: string;
  recorded?: boolean;
  text: string;
}

/**
 * Validate the content of fixtures/ai-responses.json: `{ responses: FixtureResponse[] }`.
 * Accepts the parsed value or the raw JSON string.
 */
export function loadFixtureResponses(json: unknown): FixtureResponse[] {
  const value: unknown = typeof json === "string" ? JSON.parse(json) : json;
  if (typeof value !== "object" || value === null || !("responses" in value) || !Array.isArray(value.responses)) {
    throw new Error("AI fixture file must be an object with a `responses` array.");
  }
  const responses: unknown[] = value.responses;
  return responses.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`AI fixture responses[${i}] must be an object.`);
    }
    const requestId = "requestId" in entry ? entry.requestId : undefined;
    const recorded = "recorded" in entry ? entry.recorded : undefined;
    const text = "text" in entry ? entry.text : undefined;
    if (typeof requestId !== "string" || requestId === "") {
      throw new Error(`AI fixture responses[${i}].requestId must be a non-empty string.`);
    }
    if (typeof text !== "string") {
      throw new Error(`AI fixture responses[${i}].text must be a string.`);
    }
    if (recorded !== undefined && typeof recorded !== "boolean") {
      throw new Error(`AI fixture responses[${i}].recorded must be a boolean when present.`);
    }
    return recorded === undefined ? { requestId, text } : { requestId, recorded, text };
  });
}

/** Adapter that replays recorded responses by request id. Never falls back to a live model. */
export function createFixtureAdapter(responses: readonly FixtureResponse[]): LlmAdapter {
  const byId = new Map<string, string>();
  for (const r of responses) {
    if (byId.has(r.requestId)) throw new Error(`Duplicate AI fixture for request id "${r.requestId}".`);
    byId.set(r.requestId, r.text);
  }
  return {
    name: "fixture",
    async complete(input) {
      const text = byId.get(input.requestId);
      if (text === undefined) {
        throw new Error(
          `No recorded AI response for request id "${input.requestId}"; the fixture adapter never calls a live model.`,
        );
      }
      return { text, recorded: true, source: "fixture" };
    },
  };
}
