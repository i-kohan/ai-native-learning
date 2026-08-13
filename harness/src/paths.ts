import path from "node:path";

export class PathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathAccessError";
  }
}

export function resolveWithin(root: string, relativePath: string): string {
  if (!relativePath || relativePath.trim() === "") {
    throw new PathAccessError("Path must be a non-empty relative path.");
  }

  const normalizedInput = relativePath.replace(/\\/g, "/");
  if (path.isAbsolute(normalizedInput) || normalizedInput.startsWith("/")) {
    throw new PathAccessError(`Absolute paths are not allowed: ${relativePath}`);
  }
  if (normalizedInput.split("/").includes("..")) {
    throw new PathAccessError(`Path traversal is not allowed: ${relativePath}`);
  }

  const resolved = path.resolve(root, normalizedInput);
  const rootResolved = path.resolve(root);
  const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;

  if (resolved !== rootResolved && !resolved.startsWith(prefix)) {
    throw new PathAccessError(`Path escapes allowed root: ${relativePath}`);
  }

  return resolved;
}

export function toRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}
