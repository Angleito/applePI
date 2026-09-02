import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Subprocess } from "bun";

const SERVER_URL = "http://localhost:9889";
const SERVER_HEALTH_URL = `${SERVER_URL}/health`;
const HEALTH_TIMEOUT_MS = 2_000;
const SERVER_START_DEADLINE_MS = 60_000;
const SESSION_POLL_INTERVAL_MS = 2_000;
const SESSION_APPEAR_DEADLINE_MS = 60_000;
const WAIT_POLL_INTERVAL_MS = 10_000;
const WAIT_TIMEOUT_MS = 10_800_000; // 3 hours
const WAITING_USER_ANSWER_GRACE_MS = 5 * 60_000;
const MAX_CONSECUTIVE_FETCH_FAILURES = 30;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Lowercased status of the first terminal in a /sessions/{name} body; "" when absent. */
function readTerminalStatus(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  if (!("terminals" in body)) return "";
  const terminals: unknown = body.terminals;
  if (!Array.isArray(terminals) || terminals.length === 0) return "";
  const first: unknown = terminals[0];
  if (typeof first !== "object" || first === null || !("status" in first)) return "";
  const status: unknown = first.status;
  return typeof status === "string" ? status.toLowerCase() : "";
}

export interface AgentRuntime {
  startWorker(input: { cwd: string; instruction: string }): Promise<WorkerHandle>;
  wait(worker: WorkerHandle): Promise<WorkerResult>;
  stop(worker: WorkerHandle): Promise<void>;
}

export type WorkerHandle = { sessionName: string };
export type WorkerResult = { ok: boolean; state: string; detail: string };

export class CaoRuntime implements AgentRuntime {
  readonly repoPath: string;
  #server: Subprocess | null = null;
  #spawnedByUs = false;
  #launchCount = 0;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /** Ensure the CAO server is up. Tracks whether ApplePI spawned it (for stopServer). */
  async ensureServer(): Promise<void> {
    if (await this.#healthOk()) {
      if (!this.#server) this.#spawnedByUs = false;
      return;
    }
    if (this.#server) {
      this.#server = null;
      this.#spawnedByUs = false;
    }
    this.#server = Bun.spawn(["cao-server", "--port", "9889"], { stdio: ["ignore", "pipe", "pipe"] });
    const deadline = Date.now() + SERVER_START_DEADLINE_MS;
    while (Date.now() < deadline) {
      if (await this.#healthOk()) {
        this.#spawnedByUs = true;
        return;
      }
      await sleep(2_000);
    }
    throw new Error("cao-server did not become healthy at http://localhost:9889/health within 60s");
  }

  /** Kill the server only if this instance spawned it. Idempotent. */
  async stopServer(): Promise<void> {
    const child = this.#server;
    if (!this.#spawnedByUs || !child) return;
    this.#server = null;
    this.#spawnedByUs = false;
    child.kill(); // SIGTERM
    await Promise.race([child.exited, sleep(3_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited.catch(() => {});
  }

  async startWorker(input: { cwd: string; instruction: string }): Promise<WorkerHandle> {
    await this.ensureServer();
    const phase = this.#phaseFor(input.instruction);
    await this.#writeAndInstallProfile(phase, input.instruction);
    // CAO prefixes every session with "cao-" (verified: --session-name smoke1
    // creates the tmux session cao-smoke1), so the handle must use the
    // server-side name.
    const sessionName = `cao-applepi-exec-${phase}-${this.#launchCount}-${Date.now()}`;
    const argv = [
      "cao",
      "launch",
      "--agents",
      "applepi-executive",
      "--provider",
      "omp",
      "--auto-approve",
      "--headless",
      "--session-name",
      sessionName,
      input.instruction,
    ];
    // Do NOT await exit: the CAO CLI can hang; the session is created server-side.
    Bun.spawn(argv, { cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const deadline = Date.now() + SESSION_APPEAR_DEADLINE_MS;
    while (Date.now() < deadline) {
      const body = await this.#getSession(sessionName);
      if (readTerminalStatus(body)) return { sessionName };
      await sleep(SESSION_POLL_INTERVAL_MS);
    }
    throw new Error(`session "${sessionName}" did not appear on the CAO server within 60s`);
  }

  async wait(worker: WorkerHandle): Promise<WorkerResult> {
    const started = Date.now();
    let waitingSince: number | null = null;
    let consecutiveFailures = 0;
    let lastStatus = "unknown";
    while (true) {
      if (Date.now() - started >= WAIT_TIMEOUT_MS) {
        return { ok: false, state: lastStatus, detail: "timeout" };
      }
      let status = "";
      try {
        const res = await fetch(`${SERVER_URL}/sessions/${encodeURIComponent(worker.sessionName)}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        status = readTerminalStatus(body);
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FETCH_FAILURES) {
          return { ok: false, state: lastStatus, detail: "server unreachable" };
        }
        await sleep(WAIT_POLL_INTERVAL_MS);
        continue;
      }
      consecutiveFailures = 0;
      if (!status) {
        await sleep(WAIT_POLL_INTERVAL_MS);
        continue;
      }
      lastStatus = status;
      if (status === "completed") return { ok: true, state: "completed", detail: "" };
      if (status === "error") return { ok: false, state: "error", detail: "terminal error" };
      if (status === "waiting_user_answer") {
        waitingSince ??= Date.now();
        if (Date.now() - waitingSince >= WAITING_USER_ANSWER_GRACE_MS) {
          return { ok: false, state: "waiting_user_answer", detail: "waiting for user answer" };
        }
      } else {
        waitingSince = null;
      }
      await sleep(WAIT_POLL_INTERVAL_MS);
    }
  }

  async stop(worker: WorkerHandle): Promise<void> {
    try {
      const proc = Bun.spawn(["cao", "shutdown", "--session", worker.sessionName], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      await proc.exited;
    } catch {
      // ignore non-zero exit and not-found errors
    }
  }

  #phaseFor(instruction: string): "a" | "b" {
    if (instruction.includes("Read docs/ROADMAP.md")) return "a";
    if (instruction.includes("segments.json")) return "b";
    return this.#launchCount % 2 === 0 ? "a" : "b";
  }

  async #writeAndInstallProfile(phase: "a" | "b", instruction: string): Promise<void> {
    const dir = join(this.repoPath, ".applepi", "profiles");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `applepi-executive-${phase}.md`);
    const body = `---\nname: applepi-executive\ndescription: ApplePI v2 executive\nrole: developer\nprovider: omp\n---\n\n${instruction}\n`;
    await Bun.write(file, body);
    const proc = Bun.spawn(["cao", "install", file, "--provider", "omp"], { stdio: ["ignore", "pipe", "pipe"] });
    const [stdout, stderr, code] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    if (code !== 0) {
      throw new Error(`cao install failed (exit ${code}): ${stderr.trim() || stdout.trim()}`);
    }
  }

  async #getSession(name: string): Promise<unknown | null> {
    try {
      const res = await fetch(`${SERVER_URL}/sessions/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async #healthOk(): Promise<boolean> {
    try {
      const res = await fetch(SERVER_HEALTH_URL, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
