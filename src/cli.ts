#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { runObjective } from "./factory";

const USAGE = `Usage: bun run applepi run --repo <path> --objective <text>

Commands:
  run               run an objective end to end

Options:
  --repo <path>       repository path (default: current directory)
  --objective <text>  objective text (required)`;

type Args = { repo: string; objective: string };

function parseArgs(argv: string[]): Args | null {
  const [sub, ...rest] = argv;
  if (sub !== "run") return null;
  let repo = process.cwd();
  let objective: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--repo" || flag === "--objective") {
      const value = rest[++i];
      if (value === undefined || value === "") return null;
      if (flag === "--repo") repo = value;
      else objective = value;
    } else {
      return null;
    }
  }
  if (objective === null) return null;
  return { repo, objective };
}

// Shared line reader: one line per readAnswer call.
const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();

async function readAnswer(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const { value } = await lines.next();
  return value ?? "";
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.log(USAGE);
    return 1;
  }
  return await runObjective(args.repo, args.objective, {
    isTTY: process.stdin.isTTY === true,
    readAnswer,
    print: (text: string) => console.log(text),
  });
}

process.exit(await main());
