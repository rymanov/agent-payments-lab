import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

/**
 * Start the agent in a separate process under macOS sandbox-exec:
 *  - it cannot read .env or the ledger (data/),
 *  - it cannot write anywhere in the project (config, log, ledger),
 *  - it starts with a clean environment: no inherited secrets.
 * Network stays open (the claude brain needs it). The agent has no key, so reaching
 * a service directly gets it a 402 it cannot pay.
 */
export function sandboxProfile(roots: string[] = [ROOT]): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = ["(version 1)", "(allow default)"];
  // The sandbox matches real paths, so resolve symlinks (e.g. /var -> /private/var) first.
  for (const root of roots.map((r) => realpathSync(r))) {
    lines.push(`(deny file-read* (literal ${q(path.join(root, ".env"))}) (subpath ${q(path.join(root, "data"))}))`);
    lines.push(`(deny file-write* (subpath ${q(root)}))`);
  }
  return lines.join("\n");
}

export interface AgentRun {
  code: number | null;
  stdout: string;
  stderr: string;
  json?: any;
}

/** `root` is the project the agent must not touch; the agent code always runs from ROOT. */
export function runAgent(vars: Record<string, string>, root = ROOT): Promise<AgentRun> {
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    PROJECT_ROOT: root,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    ...vars,
  };
  return new Promise((resolve) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      ["-p", sandboxProfile([...new Set([ROOT, root])]), process.execPath, "--import", "tsx", path.join(ROOT, "src/agent/agent.ts")],
      { cwd: ROOT, env: cleanEnv },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      let json: unknown;
      try {
        json = JSON.parse(stdout.trim().split("\n").pop() ?? "");
      } catch {
        /* leave undefined */
      }
      resolve({ code, stdout, stderr, json });
    });
  });
}

// CLI: npm run agent -- [scripted|obey|claude]
if (import.meta.url === `file://${process.argv[1]}`) {
  const brain = process.argv[2] ?? "scripted";
  runAgent({ BRAIN: brain, CONTEXT_TEXT: process.env.CONTEXT_TEXT ?? "", TASK_ID: process.env.TASK_ID ?? "" }).then((r) => {
    console.log(r.json ? JSON.stringify(r.json, null, 2) : r.stdout + r.stderr);
  });
}
