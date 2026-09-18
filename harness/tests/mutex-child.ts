import fs from "node:fs";
import {
  acquireWorkflowMutex,
  releaseWorkflowMutex,
} from "../src/workflow-lock.ts";

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.role === "hold-sleep") {
    const handle = acquireWorkflowMutex({
      storeDir: args.storeDir,
      workflowId: args.workflowId,
    });
    write(args.readyPath, { pid: process.pid, holding: true });
    sleepSync(args.holdMs);
    write(args.stillHeldPath, { pid: process.pid, stillHolding: true });
    releaseWorkflowMutex(handle);
    write(args.donePath, { pid: process.pid, released: true });
    return;
  }

  if (args.role === "try-lock") {
    waitForFile(args.waitPath, 20_000);
    try {
      const handle = acquireWorkflowMutex({
        storeDir: args.storeDir,
        workflowId: args.workflowId,
        timeoutMs: args.timeoutMs,
      });
      write(args.resultPath, {
        pid: process.pid,
        entered: true,
        timedOut: false,
      });
      releaseWorkflowMutex(handle);
    } catch (error) {
      write(args.resultPath, {
        pid: process.pid,
        entered: false,
        timedOut: isTimeout(error),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (args.role === "stale-release") {
    const handle = acquireWorkflowMutex({
      storeDir: args.storeDir,
      workflowId: args.workflowId,
    });
    write(args.readyPath, { pid: process.pid, acquired: true });
    waitForFile(args.waitReleasePath, 20_000);
    releaseWorkflowMutex(handle);
    write(args.releasedPath, { pid: process.pid, released: true });
    waitForFile(args.waitStalePath, 20_000);
    handle.released = false;
    releaseWorkflowMutex(handle);
    write(args.staleDonePath, {
      pid: process.pid,
      staleReleaseAttempted: true,
    });
    return;
  }

  if (args.waitPath) {
    waitForFile(args.waitPath, 20_000);
  }
  const handle = acquireWorkflowMutex({
    storeDir: args.storeDir,
    workflowId: args.workflowId,
  });
  write(args.readyPath, { pid: process.pid, acquired: true });
  waitForFile(args.waitDonePath, 20_000);
  write(args.stillHeldPath, { pid: process.pid, stillHolding: true });
  releaseWorkflowMutex(handle);
}

function write(dest: string, value: unknown): void {
  fs.mkdirSync(pathDirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(value, null, 2)}\n`);
}

function pathDirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index < 0 ? "." : filePath.slice(0, index);
}

function waitForFile(filePath: string, timeoutMs: number): void {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    sleepSync(20);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Timed out waiting");
}

function sleepSync(ms: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, ms);
}

function parseArgs(argv: string[]): {
  role: "hold-sleep" | "try-lock" | "stale-release" | "hold-until";
  storeDir: string;
  workflowId: string;
  holdMs: number;
  timeoutMs: number;
  readyPath: string;
  stillHeldPath: string;
  donePath: string;
  waitPath: string;
  resultPath: string;
  waitReleasePath: string;
  releasedPath: string;
  waitStalePath: string;
  staleDonePath: string;
  waitDonePath: string;
} {
  const role = flag(argv, "--role");
  const storeDir = flag(argv, "--store-dir");
  const workflowId = flag(argv, "--workflow-id");
  if (
    role !== "hold-sleep" &&
    role !== "try-lock" &&
    role !== "stale-release" &&
    role !== "hold-until"
  ) {
    throw new Error(`Unsupported --role: ${String(role)}`);
  }
  if (!storeDir || !workflowId) {
    throw new Error("mutex-child requires --store-dir and --workflow-id");
  }
  return {
    role,
    storeDir,
    workflowId,
    holdMs: Number(flag(argv, "--hold-ms") ?? "0"),
    timeoutMs: Number(flag(argv, "--timeout-ms") ?? "5000"),
    readyPath: flag(argv, "--ready-path") ?? "",
    stillHeldPath: flag(argv, "--still-held-path") ?? "",
    donePath: flag(argv, "--done-path") ?? "",
    waitPath: flag(argv, "--wait-path") ?? "",
    resultPath: flag(argv, "--result-path") ?? "",
    waitReleasePath: flag(argv, "--wait-release-path") ?? "",
    releasedPath: flag(argv, "--released-path") ?? "",
    waitStalePath: flag(argv, "--wait-stale-path") ?? "",
    staleDonePath: flag(argv, "--stale-done-path") ?? "",
    waitDonePath: flag(argv, "--wait-done-path") ?? "",
  };
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

main();
