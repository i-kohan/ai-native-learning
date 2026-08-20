import fs from "node:fs";
import path from "node:path";
import type { EvalResult } from "./types.ts";

export function writeEvalArtifact(options: {
  evalsDir: string;
  result: EvalResult;
  stamp?: string;
}): { jsonPath: string; reportPath: string } {
  fs.mkdirSync(options.evalsDir, { recursive: true });
  const stamp = options.stamp ?? timestamp();
  const jsonPath = path.join(options.evalsDir, `${stamp}.json`);
  const reportPath = path.join(options.evalsDir, `${stamp}.txt`);
  const serializable = {
    ...options.result,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(serializable, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${options.result.report}\n`);
  return { jsonPath, reportPath };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
