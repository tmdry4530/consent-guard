// Shared contract between U1 (policy), U2 (ledger) and U3 (web). Change only via Engineering Lead.
export type Decision = "allow" | "deny" | "pending";

export interface DataRequest {
  id: string;            // unique request id (replay protection)
  agentId: string;       // e.g. "budget-agent"
  dataset: string;       // e.g. "card_tx", "medical_record", "location"
  fields: string[];      // requested fields, e.g. ["category","amount","merchant"]
  purpose: string;       // e.g. "budgeting", "diet_recommendation"
  rangeDays?: number;    // e.g. 90
  maxRows?: number;
  at: number;            // epoch ms
}

export interface Grant {
  id: string;
  agentId: string;
  dataset: string;
  allowFields: string[];
  maskFields: string[];  // passed through masked, e.g. merchant -> "***"
  purposes: string[];
  maxRangeDays?: number;
  maxRows?: number;
  expiresAt: number;     // epoch ms (TTL)
  revokedAt?: number;
}

export interface PolicyResult {
  decision: Decision;
  requestId: string;
  grantId?: string;
  passFields: string[];
  maskFields: string[];
  reason: string;        // human-readable, shown on screen
}

export type LedgerEventKind = "grant" | "access" | "deny" | "pending" | "revoke";

export interface LedgerEvent {
  seq: number;
  kind: LedgerEventKind;
  at: number;
  agentId: string;
  dataset: string;
  fields: string[];
  refId: string;         // grant id or request id
  prevHash: string;      // hash chain
  hash: string;          // sha256 of canonical JSON of the other fields
  anchorTx?: string;     // NEAR testnet tx hash once anchored
}
