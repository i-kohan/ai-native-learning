import type { VerificationResult } from "./verify.ts";

export type NormalizedFailure = {
  passed: false;
  exitCode: number;
  durationMs: number;
  failedTests: string[];
  locations: string[];
  assertionMessages: string[];
  summary: {
    tests: number | null;
    pass: number | null;
    fail: number | null;
  };
  outputPreview: string;
  signature: string;
};

const OUTPUT_PREVIEW_LIMIT = 4000;

/**
 * Compact factual evidence of what failed.
 * Does not diagnose why the implementation is wrong or prescribe a fix.
 */
export function normalizeFailure(
  result: VerificationResult,
): NormalizedFailure {
  const failedTests = extractFailedTests(result.output);
  const locations = extractLocations(result.output);
  const assertionMessages = extractAssertionMessages(result.output);
  const summary = extractSummary(result.output);
  const outputPreview = truncate(result.output, OUTPUT_PREVIEW_LIMIT);
  const signature = buildSignature({
    exitCode: result.exitCode,
    failedTests,
    locations,
    assertionMessages,
    outputPreview,
  });

  return {
    passed: false,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    failedTests,
    locations,
    assertionMessages,
    summary,
    outputPreview,
    signature,
  };
}

export function formatFailureEvidence(failure: NormalizedFailure): string {
  return JSON.stringify(
    {
      exitCode: failure.exitCode,
      durationMs: failure.durationMs,
      failedTests: failure.failedTests,
      locations: failure.locations,
      assertionMessages: failure.assertionMessages,
      summary: failure.summary,
      outputPreview: failure.outputPreview,
    },
    null,
    2,
  );
}

function extractFailedTests(output: string): string[] {
  const names: string[] = [];
  const failingSection = output.split("failing tests:")[1] ?? "";
  const source = failingSection || output;
  const pattern = /^[✖x]\s+(.+?)\s+\([\d.]+ms\)/gm;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function extractLocations(output: string): string[] {
  const locations: string[] = [];
  for (const match of output.matchAll(/test at (\S+)/g)) {
    const location = match[1].trim();
    if (location && !locations.includes(location)) {
      locations.push(location);
    }
  }
  for (const match of output.matchAll(/\(([^)]+\.test\.[tj]s:\d+:\d+)\)/g)) {
    const location = match[1].replace(/\\/g, "/");
    const relative = location.includes("target-app/")
      ? location.slice(location.indexOf("target-app/"))
      : location;
    if (relative && !locations.includes(relative)) {
      locations.push(relative);
    }
  }
  return locations;
}

function extractAssertionMessages(output: string): string[] {
  const messages: string[] = [];
  const assertionBlock = /AssertionError[^\n]*(?:\n[^\n]*){0,8}/g;
  for (const match of output.matchAll(assertionBlock)) {
    const compact = match[0]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("at "))
      .slice(0, 6)
      .join(" | ");
    if (compact && !messages.includes(compact)) {
      messages.push(compact);
    }
  }
  return messages;
}

function extractSummary(output: string): NormalizedFailure["summary"] {
  return {
    tests: matchInfoCount(output, "tests"),
    pass: matchInfoCount(output, "pass"),
    fail: matchInfoCount(output, "fail"),
  };
}

function matchInfoCount(output: string, label: string): number | null {
  const match = output.match(new RegExp(`ℹ ${label}\\s+(\\d+)`));
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function buildSignature(parts: {
  exitCode: number;
  failedTests: string[];
  locations: string[];
  assertionMessages: string[];
  outputPreview: string;
}): string {
  if (parts.failedTests.length || parts.locations.length) {
    return [
      `exit=${parts.exitCode}`,
      parts.failedTests.join("; ") || "(unnamed)",
      parts.locations.join("; "),
      parts.assertionMessages[0] ?? "",
    ]
      .filter(Boolean)
      .join(" | ");
  }
  return `exit=${parts.exitCode} | unstructured | ${parts.outputPreview.slice(0, 200)}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}…`;
}
