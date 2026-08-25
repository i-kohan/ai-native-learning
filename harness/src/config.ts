import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DEFAULT_MAX_REPAIR_ATTEMPTS } from "./repair.ts";
import { DEFAULT_MAX_REVIEW_REPAIR_ATTEMPTS } from "./review.ts";

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(harnessDir, "../..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

export type HarnessConfig = {
  apiKey: string;
  model: string;
  /** Optional override used only for the verification-repair episode. */
  repairModel?: string;
  maxTurns: number;
  maxRepairAttempts: number;
  maxReviewRepairAttempts: number;
  repoRoot: string;
  targetAppRoot: string;
  targetSrcRoot: string;
  tracesDir: string;
};

export function loadConfig(): HarnessConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  const repairModel = process.env.OPENAI_REPAIR_MODEL?.trim();

  if (!apiKey) {
    throw new Error(
      "Missing required env OPENAI_API_KEY. Set it in .env or the environment.",
    );
  }
  if (!model) {
    throw new Error(
      "Missing required env OPENAI_MODEL. Set it in .env or the environment.",
    );
  }

  const targetAppRoot = path.join(REPO_ROOT, "target-app");

  return {
    apiKey,
    model,
    ...(repairModel ? { repairModel } : {}),
    maxTurns: 20,
    maxRepairAttempts: DEFAULT_MAX_REPAIR_ATTEMPTS,
    maxReviewRepairAttempts: DEFAULT_MAX_REVIEW_REPAIR_ATTEMPTS,
    repoRoot: REPO_ROOT,
    targetAppRoot,
    targetSrcRoot: path.join(targetAppRoot, "src"),
    tracesDir: path.join(REPO_ROOT, "traces"),
  };
}
