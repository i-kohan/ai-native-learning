import fs from "node:fs";
import path from "node:path";

export type TraceEvent = {
  timestamp: string;
  turn?: number;
  event: string;
  [key: string]: unknown;
};

export class Tracer {
  readonly tracePath: string;
  private readonly stream: fs.WriteStream;

  constructor(tracesDir: string, runId: string) {
    fs.mkdirSync(tracesDir, { recursive: true });
    this.tracePath = path.join(tracesDir, `${runId}.jsonl`);
    this.stream = fs.createWriteStream(this.tracePath, { flags: "a" });
  }

  record(event: string, data: Record<string, unknown> = {}, turn?: number): void {
    const entry: TraceEvent = {
      timestamp: new Date().toISOString(),
      event,
      ...(turn !== undefined ? { turn } : {}),
      ...data,
    };
    this.stream.write(`${JSON.stringify(entry)}\n`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on("error", reject);
    });
  }
}
