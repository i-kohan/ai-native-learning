import fs from "node:fs";
import path from "node:path";
import { resolveWithin } from "../paths.ts";
import { scopeCeiling } from "./artifact.ts";

const MAX_READ_CHARS = 20_000;
const MAX_LIST_ENTRIES = 200;

export function listBoundedFiles(
  allowedRoot: string,
  scope: string,
  relativePath: string,
): { ok: true; output: string } | { ok: false; output: string } {
  const requested = relativePath.trim() === "" ? "." : relativePath.trim();
  const ceiling = scopeCeiling(allowedRoot, scope);
  const listPath =
    requested === "." ? path.relative(allowedRoot, ceiling) || "." : requested;
  let target: string;
  try {
    target = resolveWithin(allowedRoot, listPath === "" ? "." : listPath);
  } catch (error) {
    return { ok: false, output: errorMessage(error) };
  }
  if (!insideCeiling(target, ceiling)) {
    return {
      ok: false,
      output: `Path is outside the delegated scope: ${requested}`,
    };
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return { ok: false, output: `Directory does not exist: ${requested}` };
  }
  const lines = fs
    .readdirSync(target, { withFileTypes: true })
    .slice(0, MAX_LIST_ENTRIES)
    .map((entry) => {
      const absolute = path.join(target, entry.name);
      const relative = path
        .relative(allowedRoot, absolute)
        .split(path.sep)
        .join("/");
      return entry.isDirectory() ? `${relative}/` : relative;
    })
    .sort();
  return { ok: true, output: lines.join("\n") || "(empty)" };
}

export function readBoundedFile(
  allowedRoot: string,
  scope: string,
  relativePath: string,
): { ok: true; output: string } | { ok: false; output: string } {
  let target: string;
  try {
    target = resolveWithin(allowedRoot, relativePath);
  } catch (error) {
    return { ok: false, output: errorMessage(error) };
  }
  const ceiling = scopeCeiling(allowedRoot, scope);
  if (!insideCeiling(target, ceiling)) {
    return {
      ok: false,
      output: `Path is outside the delegated scope: ${relativePath}`,
    };
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return { ok: false, output: `File does not exist: ${relativePath}` };
  }
  const text = fs.readFileSync(target, "utf8");
  if (text.length <= MAX_READ_CHARS) {
    return { ok: true, output: text };
  }
  return {
    ok: true,
    output: `${text.slice(0, MAX_READ_CHARS)}\n[truncated]`,
  };
}

function insideCeiling(target: string, ceiling: string): boolean {
  const root = path.resolve(ceiling);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(prefix);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
