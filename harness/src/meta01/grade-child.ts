import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DefaultSnapshot } from "./grader.ts";
import { runAuthorityInvariants } from "./authority.ts";
import { captureDefaultEpisode, gradeCapability } from "./grader.ts";
import type { runAgentLoop } from "../loop.ts";

async function main(): Promise<void> {
  const workspace = argument("--workspace");
  const mode = argument("--mode");
  const loopPath = path.join(workspace, "harness", "src", "loop.ts");
  const loaded = (await import(pathToFileURL(loopPath).href)) as {
    runAgentLoop: typeof runAgentLoop;
  };
  if (mode === "baseline") {
    emit(await captureDefaultEpisode(loaded.runAgentLoop));
    return;
  }
  if (mode === "authority") {
    emit(await runAuthorityInvariants(loaded.runAgentLoop));
    return;
  }
  if (mode === "grade") {
    const baseline = JSON.parse(
      fs.readFileSync(argument("--baseline"), "utf8"),
    ) as DefaultSnapshot;
    emit(await gradeCapability(baseline, loaded.runAgentLoop));
    return;
  }
  throw new Error(`unknown grade mode: ${mode}`);
}

function argument(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) {
    throw new Error(`missing ${flag}`);
  }
  return value;
}

function emit(payload: unknown): void {
  console.log(`META01_JSON ${JSON.stringify(payload)}`);
}

const isDirect = process.argv[1]?.includes("grade-child.ts");
if (isDirect) {
  main().catch((error) => {
    emit({
      threw: true,
      readable: false,
      status: "",
      toolNames: [],
      instructions: "",
      passed: false,
      reasons: ["loop_threw_after_maintenance"],
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
