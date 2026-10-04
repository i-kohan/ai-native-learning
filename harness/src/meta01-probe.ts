import { runMeta01Experiment } from "./meta01/probe.ts";

runMeta01Experiment().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
