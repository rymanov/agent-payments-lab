import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Decision log, one JSON line per decision (rule 7 + rule d, added 6 Nov).
 * Fields: time, agent, task, service, amount, rule, result, plus requestId,
 * the service's 402 terms as received, the accept that was used, and the tx hash.
 */
export interface Decision {
  time: string;
  requestId: string;
  agent: string;
  task: string;
  url: string;
  service: string | null;
  amount: string | null;
  rule: string;
  result: "allowed" | "blocked" | "duplicate" | "free" | "error";
  reason?: string;
  terms?: unknown;
  accepted?: unknown;
  tx?: string | null;
  settlement?: unknown;
}

export class DecisionLog {
  constructor(private file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
  }
  write(d: Omit<Decision, "time">) {
    const line: Decision = { time: new Date().toISOString(), ...d };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
    return line;
  }
}
