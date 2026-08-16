import { loadConfig } from "./config.ts";
import { printHarnessResult, runV1Harness } from "./run.ts";

async function main(): Promise<void> {
  const taskArgIndex = process.argv.indexOf("--task");
  const taskFromArg =
    taskArgIndex >= 0 && process.argv[taskArgIndex + 1]
      ? process.argv[taskArgIndex + 1]
      : undefined;
  const taskFromStdin = !process.stdin.isTTY ? (await readStdin()).trim() : "";
  const task = taskFromArg ?? taskFromStdin;

  if (!task) {
    console.error(
      'Usage: npm start -- --task "..."   OR pipe task text via stdin',
    );
    process.exit(1);
  }

  const config = loadConfig();
  const runId = `manual-${timestamp()}`;
  const result = await runV1Harness({ config, task, runId });
  printHarnessResult(result);
  process.exit(result.workflowStatus === "failure" ? 1 : 0);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
