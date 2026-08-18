import fs from "node:fs";
import path from "node:path";
import type { HarnessConfig } from "./config.ts";

export type ContextMode = "baseline" | "variant";

export type RepositoryMapEntry = {
  /** Path relative to target-app/. */
  path: string;
  kind: "file" | "directory";
  /** File extension without dot, when kind=file. */
  extension?: string;
};

export type RepositoryMap = {
  root: "target-app/";
  entries: RepositoryMapEntry[];
};

export type ContextPreparation = {
  map: RepositoryMap;
  durationMs: number;
  pathsScanned: number;
};

export type InspectedPaths = {
  readFiles: string[];
  listedPaths: string[];
};

export type ReusableContext = {
  repositoryMap: RepositoryMap;
  specInspectedPaths: InspectedPaths;
};

export type PhaseDiscoveryMetrics = {
  listFilesCalls: number;
  readFileCalls: number;
  readFilePaths: string[];
  listedPaths: string[];
};

export type PathOverlap = {
  readFileOverlap: string[];
  listedPathOverlap: string[];
};

export type ContextRunMetrics = {
  mode: ContextMode;
  preparation: ContextPreparation | null;
  specDiscovery: PhaseDiscoveryMetrics;
  implDiscovery: PhaseDiscoveryMetrics | null;
  pathOverlap: PathOverlap | null;
  implNavCallsBeforeFirstWrite: number | null;
  tokenUsage: TokenUsageSummary | null;
};

export type TokenUsageSummary = {
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  specInputTokens: number | null;
  specOutputTokens: number | null;
  implInputTokens: number | null;
  implOutputTokens: number | null;
};

const DEFAULT_MAX_ENTRIES = 64;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".cache",
]);

export function buildRepositoryMap(
  config: HarnessConfig,
  options: { maxEntries?: number } = {},
): ContextPreparation {
  const startedAt = Date.now();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries: RepositoryMapEntry[] = [];
  let pathsScanned = 0;

  walkDirectory(config.targetAppRoot, config, entries, maxEntries, () => {
    pathsScanned += 1;
  });

  entries.sort((left, right) => left.path.localeCompare(right.path));

  return {
    map: {
      root: "target-app/",
      entries,
    },
    durationMs: Date.now() - startedAt,
    pathsScanned,
  };
}

export function formatSpecPhaseOrientation(map: RepositoryMap): string {
  return [
    "## Repository orientation (not authoritative)",
    "Compact structural map of target-app/. Use for initial orientation only.",
    "Repository evidence does not authorize new product semantics.",
    "You may still use list_files and read_file on demand.",
    "",
    formatRepositoryMapLines(map),
  ].join("\n");
}

export function formatImplementationHints(context: ReusableContext): string {
  const { repositoryMap, specInspectedPaths } = context;
  const readFiles =
    specInspectedPaths.readFiles.length > 0
      ? specInspectedPaths.readFiles.map((item) => `- ${item}`).join("\n")
      : "(none recorded)";
  const listedPaths =
    specInspectedPaths.listedPaths.length > 0
      ? specInspectedPaths.listedPaths.map((item) => `- ${item}`).join("\n")
      : "(none recorded)";

  return [
    "## Reusable repository context (hints only)",
    "The resolved specification below is the authoritative execution intent.",
    "The repository map is orientation, not a requirement.",
    "Spec phase inspected paths may be useful starting points and are not an exhaustive scope.",
    "Repository evidence does not authorize new product semantics.",
    "You may inspect any repository file allowed by list_files/read_file.",
    "",
    "### Repository map",
    formatRepositoryMapLines(repositoryMap),
    "",
    "### Spec phase inspected paths",
    "Spec phase inspected these repository paths; they may be useful starting points and are not exhaustive.",
    "",
    "read_file:",
    readFiles,
    "",
    "list_files:",
    listedPaths,
  ].join("\n");
}

export function computePathOverlap(
  specPaths: InspectedPaths,
  implPaths: InspectedPaths,
): PathOverlap {
  const specReads = new Set(specPaths.readFiles);
  const specLists = new Set(specPaths.listedPaths);
  return {
    readFileOverlap: implPaths.readFiles.filter((item) => specReads.has(item)),
    listedPathOverlap: implPaths.listedPaths.filter((item) =>
      specLists.has(item),
    ),
  };
}

export class DiscoveryTracker {
  listFilesCalls = 0;
  readFileCalls = 0;
  readFilePaths: string[] = [];
  listedPaths: string[] = [];
  private implNavCallsBeforeFirstWrite: number | null = null;
  private implNavCallsSeen = 0;
  private implFirstWriteSeen = false;

  record(
    toolName: string,
    argsJson: string,
    phase: "spec" | "implementation",
  ): void {
    const pathArg = extractPathArg(argsJson);
    if (toolName === "list_files" && pathArg) {
      this.listFilesCalls += 1;
      this.listedPaths.push(normalizeRepoPath(pathArg));
    } else if (toolName === "read_file" && pathArg) {
      this.readFileCalls += 1;
      this.readFilePaths.push(normalizeRepoPath(pathArg));
    }

    if (phase === "implementation") {
      if (toolName === "write_file") {
        this.implFirstWriteSeen = true;
        return;
      }
      if (
        !this.implFirstWriteSeen &&
        (toolName === "list_files" || toolName === "read_file")
      ) {
        this.implNavCallsSeen += 1;
        this.implNavCallsBeforeFirstWrite = this.implNavCallsSeen;
      }
    }
  }

  toMetrics(): PhaseDiscoveryMetrics {
    return {
      listFilesCalls: this.listFilesCalls,
      readFileCalls: this.readFileCalls,
      readFilePaths: uniqueSorted(this.readFilePaths),
      listedPaths: uniqueSorted(this.listedPaths),
    };
  }

  toInspectedPaths(): InspectedPaths {
    const metrics = this.toMetrics();
    return {
      readFiles: metrics.readFilePaths,
      listedPaths: metrics.listedPaths,
    };
  }

  getImplNavCallsBeforeFirstWrite(): number | null {
    return this.implNavCallsBeforeFirstWrite;
  }
}

export function mergeTokenUsage(
  current: TokenUsageSummary | null,
  usage: Record<string, unknown> | null,
  phase: "spec" | "implementation",
): TokenUsageSummary | null {
  if (!usage) {
    return current;
  }

  const input = readTokenField(usage, "input_tokens");
  const output = readTokenField(usage, "output_tokens");
  if (input === null && output === null) {
    return current;
  }

  const base: TokenUsageSummary = current ?? {
    totalInputTokens: null,
    totalOutputTokens: null,
    specInputTokens: null,
    specOutputTokens: null,
    implInputTokens: null,
    implOutputTokens: null,
  };

  if (input !== null) {
    base.totalInputTokens = addNullable(base.totalInputTokens, input);
    if (phase === "spec") {
      base.specInputTokens = addNullable(base.specInputTokens, input);
    } else {
      base.implInputTokens = addNullable(base.implInputTokens, input);
    }
  }
  if (output !== null) {
    base.totalOutputTokens = addNullable(base.totalOutputTokens, output);
    if (phase === "spec") {
      base.specOutputTokens = addNullable(base.specOutputTokens, output);
    } else {
      base.implOutputTokens = addNullable(base.implOutputTokens, output);
    }
  }

  return base;
}

function walkDirectory(
  absoluteDir: string,
  config: HarnessConfig,
  entries: RepositoryMapEntry[],
  maxEntries: number,
  onScan: () => void,
): void {
  if (entries.length >= maxEntries) {
    return;
  }

  onScan();
  const relativeDir = toTargetAppRelative(config, absoluteDir);
  if (relativeDir !== ".") {
    entries.push({ path: relativeDir, kind: "directory" });
  }

  let names: string[];
  try {
    names = fs
      .readdirSync(absoluteDir)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return;
  }

  for (const name of names) {
    if (entries.length >= maxEntries) {
      return;
    }
    if (SKIP_DIR_NAMES.has(name)) {
      continue;
    }

    const absolutePath = path.join(absoluteDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      continue;
    }

    const relativePath =
      relativeDir === "."
        ? name
        : `${relativeDir}/${name}`.replace(/\/+/g, "/");

    if (stat.isDirectory()) {
      walkDirectory(absolutePath, config, entries, maxEntries, onScan);
    } else if (stat.isFile()) {
      entries.push({
        path: relativePath,
        kind: "file",
        extension: path.extname(name).replace(/^\./, "") || undefined,
      });
    }
  }
}

function formatRepositoryMapLines(map: RepositoryMap): string {
  if (!map.entries.length) {
    return "(empty)";
  }
  return map.entries
    .map((entry) => {
      if (entry.kind === "directory") {
        return `- ${entry.path}/`;
      }
      const suffix = entry.extension ? ` (${entry.extension})` : "";
      return `- ${entry.path}${suffix}`;
    })
    .join("\n");
}

function toTargetAppRelative(
  config: HarnessConfig,
  absolutePath: string,
): string {
  const rel = path.relative(config.targetAppRoot, absolutePath);
  if (!rel || rel === ".") {
    return ".";
  }
  return rel.split(path.sep).join("/");
}

function extractPathArg(argsJson: string): string | null {
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    if (typeof parsed.path === "string" && parsed.path.trim()) {
      return parsed.path.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeRepoPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/\/+$/, "") || ".";
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function readTokenField(
  usage: Record<string, unknown>,
  field: "input_tokens" | "output_tokens",
): number | null {
  const value = usage[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addNullable(current: number | null, delta: number): number {
  return (current ?? 0) + delta;
}
