import type { NumericSummary } from "./types.ts";

export function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function numericSummary(
  values: Array<number | null | undefined>,
): NumericSummary {
  const raw = values.map((value) => (value == null ? null : value));
  const present = raw.filter((value): value is number => value != null);
  if (present.length === 0) {
    return { median: null, min: null, max: null, values: raw };
  }
  return {
    median: median(present),
    min: Math.min(...present),
    max: Math.max(...present),
    values: raw,
  };
}

export function formatCount(ratio: { met: number; total: number }): string {
  return `${ratio.met}/${ratio.total}`;
}

export function formatMedianRange(summary: NumericSummary): string {
  if (summary.median == null || summary.min == null || summary.max == null) {
    return "n/a";
  }
  return `median=${formatNumber(summary.median)} range=${formatNumber(summary.min)}–${formatNumber(summary.max)}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}
