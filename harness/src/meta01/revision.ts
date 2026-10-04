import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, tryGit } from "./git.ts";
import { hashText } from "./patch.ts";
import { META01_PARENT_REVISION } from "./policy.ts";

export type CandidateRevision = {
  candidateRevision: string;
  parentRevision: string;
  patch: string;
  patchHash: string;
  ref: string;
  mainBefore: string;
  mainAfter: string;
  mainUnchanged: boolean;
};

export function materializeCandidateRevision(options: {
  hostRepoRoot: string;
  workspaceRoot: string;
  candidateId: string;
  expectedParent?: string;
}): CandidateRevision {
  const expectedParent = options.expectedParent ?? META01_PARENT_REVISION;
  const mainBefore = currentBranchHead(options.hostRepoRoot);
  const parent = git(options.workspaceRoot, ["rev-parse", "HEAD"]).trim();
  if (parent !== expectedParent) {
    throw new Error(
      `candidate workspace HEAD ${parent} is not frozen parent ${expectedParent}`,
    );
  }
  const stage = ["harness/src/loop.ts"];
  if (fs.existsSync(path.join(options.workspaceRoot, "harness/src/loop-ext"))) {
    stage.push("harness/src/loop-ext");
  }
  const add = tryGit(options.workspaceRoot, ["add", "--", ...stage]);
  if (!add.ok) {
    throw new Error(`failed to stage candidate patch: ${add.detail}`);
  }
  const authorName = git(options.hostRepoRoot, ["log", "-1", "--format=%an"]).trim();
  const authorEmail = git(options.hostRepoRoot, ["log", "-1", "--format=%ae"]).trim();
  const commit = spawnSync(
    "git",
    [
      "commit",
      "-m",
      "META01 candidate evidence\n\nDetached evidence commit. Not an adoption and not main.",
    ],
    {
      cwd: options.workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
      },
    },
  );
  if (commit.status !== 0) {
    throw new Error(
      `failed to materialize candidate revision: ${commit.stderr || commit.stdout}`,
    );
  }
  const candidateRevision = git(options.workspaceRoot, ["rev-parse", "HEAD"]).trim();
  const recordedParent = git(options.workspaceRoot, ["rev-parse", "HEAD^"]).trim();
  if (recordedParent !== expectedParent) {
    throw new Error(
      `candidate parent ${recordedParent} does not match frozen parent ${expectedParent}`,
    );
  }
  const ref = `refs/meta01/candidates/${options.candidateId}`;
  const updated = tryGit(options.hostRepoRoot, [
    "update-ref",
    ref,
    candidateRevision,
  ]);
  if (!updated.ok) {
    throw new Error(`failed to record candidate ref: ${updated.detail}`);
  }
  const mainAfter = currentBranchHead(options.hostRepoRoot);
  const patch = git(options.hostRepoRoot, [
    "diff",
    expectedParent,
    candidateRevision,
  ]);
  return {
    candidateRevision,
    parentRevision: recordedParent,
    patch,
    patchHash: hashText(patch),
    ref,
    mainBefore,
    mainAfter,
    mainUnchanged: mainBefore === mainAfter,
  };
}

export function provenanceMatches(input: {
  parentRevision: string;
  candidateRevision: string;
  patchHash: string;
  hostRepoRoot: string;
  expectedParent?: string;
}): { ok: true } | { ok: false; reason: string } {
  const expectedParent = input.expectedParent ?? META01_PARENT_REVISION;
  if (input.parentRevision !== expectedParent) {
    return { ok: false, reason: "parentRevision is not the frozen H0 SHA" };
  }
  const type = tryGit(input.hostRepoRoot, ["cat-file", "-t", input.candidateRevision]);
  if (!type.ok || type.stdout.trim() !== "commit") {
    return { ok: false, reason: "candidateRevision is not a commit object" };
  }
  const parent = git(input.hostRepoRoot, [
    "rev-parse",
    `${input.candidateRevision}^`,
  ]).trim();
  if (parent !== input.parentRevision) {
    return { ok: false, reason: "candidateRevision parent does not match parentRevision" };
  }
  const patch = git(input.hostRepoRoot, [
    "diff",
    input.parentRevision,
    input.candidateRevision,
  ]);
  if (hashText(patch) !== input.patchHash) {
    return { ok: false, reason: "patchHash does not match the candidateRevision diff" };
  }
  const branchHead = currentBranchHead(input.hostRepoRoot);
  if (branchHead === input.candidateRevision) {
    return { ok: false, reason: "candidateRevision moved the current branch" };
  }
  return { ok: true };
}

function currentBranchHead(hostRepoRoot: string): string {
  const branch = git(hostRepoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch === "HEAD") {
    return git(hostRepoRoot, ["rev-parse", "HEAD"]).trim();
  }
  return git(hostRepoRoot, ["rev-parse", branch]).trim();
}
