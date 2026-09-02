import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type Objective = {
  id: number;
  instruction: string;
  repository: string;
  base_commit: string;
  state: "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: number;
  objective_id: number;
  instruction: string;
  state: "pending" | "running" | "verifying" | "completed" | "failed";
  worktree_path: string | null;
  worker_id: string | null;
  commit_sha: string | null;
  created_at: string;
  updated_at: string;
};

const now = () => new Date().toISOString();

/**
 * Opens (creating if needed) the ApplePI durable-state database at
 * `<repoPath>/.applepi/applepi.db`. Schema creation is idempotent.
 */
export function openDatabase(repoPath: string): Database {
  const dir = path.join(repoPath, ".applepi");
  mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "applepi.db"));
  db.run(`
    CREATE TABLE IF NOT EXISTS objectives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instruction TEXT NOT NULL,
      repository TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      objective_id INTEGER NOT NULL REFERENCES objectives(id),
      instruction TEXT NOT NULL,
      state TEXT NOT NULL,
      worktree_path TEXT,
      worker_id TEXT,
      commit_sha TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return db;
}

export function createObjective(
  db: Database,
  input: { instruction: string; repository: string; baseCommit: string },
): number {
  const ts = now();
  const row = db
    .query(
      `INSERT INTO objectives (instruction, repository, base_commit, state, created_at, updated_at)
       VALUES (?, ?, ?, 'running', ?, ?) RETURNING id`,
    )
    .get(input.instruction, input.repository, input.baseCommit, ts, ts) as { id: number };
  return row.id;
}

export function createTask(
  db: Database,
  objectiveId: number,
  instruction: string,
  worktreePath: string | null = null,
): number {
  const ts = now();
  const row = db
    .query(
      `INSERT INTO tasks (objective_id, instruction, state, worktree_path, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?) RETURNING id`,
    )
    .get(objectiveId, instruction, worktreePath, ts, ts) as { id: number };
  return row.id;
}

export function updateObjectiveState(
  db: Database,
  id: number,
  state: Objective["state"],
): void {
  db.run(`UPDATE objectives SET state = ?, updated_at = ? WHERE id = ?`, [state, now(), id]);
}

export function updateTaskState(db: Database, id: number, state: Task["state"]): void {
  db.run(`UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?`, [state, now(), id]);
}

export function setTaskCommitSha(db: Database, id: number, sha: string): void {
  db.run(`UPDATE tasks SET commit_sha = ?, updated_at = ? WHERE id = ?`, [sha, now(), id]);
}

export function getObjective(db: Database, id: number): Objective | null {
  return (db.query(`SELECT * FROM objectives WHERE id = ?`).get(id) as Objective | null) ?? null;
}

export function getTasksForObjective(db: Database, objectiveId: number): Task[] {
  return db
    .query(`SELECT * FROM tasks WHERE objective_id = ? ORDER BY id`)
    .all(objectiveId) as Task[];
}
