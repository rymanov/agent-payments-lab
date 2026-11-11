import { DatabaseSync } from "node:sqlite";

/**
 * Payment ledger. One row per payment request ID.
 *
 * Status flow:
 *   received  -> blocked                     (a rule said no; nothing signed)
 *   received  -> reserved -> signed -> settled | failed_after_sign
 *   received  -> reserved -> released        (failed before anything was signed)
 *
 * Budget counts reserved, signed, settled and failed_after_sign. Once a payload is
 * signed it may still settle later (until validBefore), so it stays counted.
 *
 * Every check-and-write runs inside BEGIN IMMEDIATE. node:sqlite is synchronous, so
 * inside one process no other request can run between the check and the write; across
 * processes the IMMEDIATE lock serialises writers.
 */

export type Status = "received" | "blocked" | "reserved" | "signed" | "settled" | "failed_after_sign" | "released";
const COUNTED = ["reserved", "signed", "settled", "failed_after_sign"];

export interface Row {
  id: string;
  agent: string;
  task: string;
  url: string;
  service: string | null;
  amount: string | null;
  status: Status;
  rule: string | null;
  reason: string | null;
  tx: string | null;
  created_at: number;
  updated_at: number;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        task TEXT NOT NULL,
        url TEXT NOT NULL,
        service TEXT,
        amount TEXT,
        status TEXT NOT NULL,
        rule TEXT,
        reason TEXT,
        tx TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payments_time ON payments(created_at);
    `);
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  get(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as Row | undefined;
  }

  /** Claim a request ID. Returns the existing row if the ID was already used. */
  claim(id: string, agent: string, task: string, url: string, now = Date.now()): { claimed: true } | { claimed: false; existing: Row } {
    return this.tx(() => {
      const existing = this.get(id);
      if (existing) return { claimed: false as const, existing };
      this.db
        .prepare("INSERT INTO payments (id, agent, task, url, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'received', ?, ?)")
        .run(id, agent, task, url, now, now);
      return { claimed: true as const };
    });
  }

  block(id: string, rule: string, reason: string, service: string | null = null, amount: string | null = null) {
    this.db
      .prepare("UPDATE payments SET status='blocked', rule=?, reason=?, service=?, amount=?, updated_at=? WHERE id=?")
      .run(rule, reason, service, amount, Date.now(), id);
  }

  /**
   * Atomically check the weekly budget, per-task count and duplicate-purchase window,
   * then reserve. Returns null on success or a {rule, reason} block.
   */
  reserve(
    id: string,
    p: { agent: string; task: string; url: string; service: string; amount: string },
    lim: { weeklyBudget: string; maxPaymentsPerTask: number; dedupeWindowSeconds: number },
    now = Date.now(),
  ): { rule: string; reason: string } | null {
    return this.tx(() => {
      const weekAgo = now - 7 * 24 * 3600 * 1000;
      const ph = COUNTED.map(() => "?").join(",");
      const rows = this.db
        .prepare(`SELECT amount FROM payments WHERE status IN (${ph}) AND created_at >= ?`)
        .all(...COUNTED, weekAgo) as { amount: string }[];
      const spent = rows.reduce((s, r) => s + BigInt(r.amount), 0n);
      const want = BigInt(p.amount);
      const budget = BigInt(lim.weeklyBudget);

      const taskCount = (
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM payments WHERE status IN (${ph}) AND agent = ? AND task = ?`)
          .get(...COUNTED, p.agent, p.task) as { n: number }
      ).n;
      const recentSame = (
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM payments WHERE status IN (${ph}) AND agent = ? AND url = ? AND created_at >= ?`)
          .get(...COUNTED, p.agent, p.url, now - lim.dedupeWindowSeconds * 1000) as { n: number }
      ).n;

      let block: { rule: string; reason: string } | null = null;
      if (spent + want > budget) {
        block = { rule: "weekly_budget", reason: `spent ${spent} + ${want} > weekly budget ${budget}` };
      } else if (taskCount >= lim.maxPaymentsPerTask) {
        block = { rule: "per_task_limit", reason: `task "${p.task}" already has ${taskCount} payment(s); limit ${lim.maxPaymentsPerTask}` };
      } else if (recentSame > 0) {
        block = { rule: "duplicate_purchase", reason: `same resource already bought within ${lim.dedupeWindowSeconds}s` };
      }
      if (block) {
        this.db
          .prepare("UPDATE payments SET status='blocked', rule=?, reason=?, service=?, amount=?, updated_at=? WHERE id=?")
          .run(block.rule, block.reason, p.service, p.amount, now, id);
        return block;
      }
      this.db
        .prepare("UPDATE payments SET status='reserved', service=?, amount=?, updated_at=? WHERE id=?")
        .run(p.service, p.amount, now, id);
      return null;
    });
  }

  setStatus(id: string, status: Status, extra: { tx?: string | null; reason?: string | null; rule?: string | null } = {}) {
    this.db
      .prepare("UPDATE payments SET status=?, tx=COALESCE(?, tx), reason=COALESCE(?, reason), rule=COALESCE(?, rule), updated_at=? WHERE id=?")
      .run(status, extra.tx ?? null, extra.reason ?? null, extra.rule ?? null, Date.now(), id);
  }

  weeklySpent(now = Date.now()): bigint {
    const ph = COUNTED.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT amount FROM payments WHERE status IN (${ph}) AND created_at >= ?`)
      .all(...COUNTED, now - 7 * 24 * 3600 * 1000) as { amount: string }[];
    return rows.reduce((s, r) => s + BigInt(r.amount), 0n);
  }

  close() {
    this.db.close();
  }
}
