import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DeliveryError } from "./delivery-error.ts";
import { redactSecrets } from "./github-redact.ts";
import { verificationChildEnv } from "./verify.ts";

export type DeliveryGit = {
  revParse(cwd: string, ref: string): string;
  commitAcceptedTree(cwd: string, message: string): string;
  pushBranch(cwd: string, branch: string): void;
};

export function assertNoForcePush(args: string[]): void {
  const banned = args.some(
    (arg) => arg === "--force" || arg === "-f" || arg.startsWith("--force="),
  );
  if (banned) {
    throw new DeliveryError(
      "protected_branch",
      "Force push is not part of the delivery protocol.",
    );
  }
}

export function gitPushArgs(branch: string): string[] {
  const args = ["push", "origin", `HEAD:refs/heads/${branch}`];
  assertNoForcePush(args);
  return args;
}

export function deliveryGitEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = verificationChildEnv(baseEnv);
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

export function createDeliveryGit(): DeliveryGit {
  return {
    revParse(cwd, ref) {
      return git(cwd, [
        "rev-parse",
        "--verify",
        `${ref}^{commit}`,
      ]).toLowerCase();
    },
    commitAcceptedTree(cwd, message) {
      const toAdd = ["target-app", ".github", "harness/fixtures"].filter(
        (rel) => fs.existsSync(path.join(cwd, rel)),
      );
      if (toAdd.length > 0) {
        git(cwd, ["add", "-A", "--", ...toAdd]);
      }
      const status = git(cwd, ["status", "--porcelain"]);
      if (status.trim() === "") {
        return git(cwd, ["rev-parse", "HEAD"]).toLowerCase();
      }
      git(cwd, [
        "-c",
        "user.name=ai-native-delivery",
        "-c",
        "user.email=delivery@local",
        "commit",
        "-m",
        message,
      ]);
      return git(cwd, ["rev-parse", "HEAD"]).toLowerCase();
    },
    pushBranch(cwd, branch) {
      const result = spawnSync("git", gitPushArgs(branch), {
        cwd,
        encoding: "utf8",
        env: deliveryGitEnv(),
      });
      if (result.status !== 0) {
        throw new DeliveryError(
          "ambiguous_side_effect",
          redactSecrets(
            `git push may have succeeded or failed:\n${result.stdout}\n${result.stderr}`,
          ),
          { operation: "git_push" },
        );
      }
    },
  };
}

function git(cwd: string, args: string[]): string {
  assertNoForcePush(args);
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: deliveryGitEnv(),
  });
  if (result.status !== 0) {
    throw new DeliveryError(
      "delivery_failed",
      redactSecrets(
        `git ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
      ),
    );
  }
  return (result.stdout ?? "").trim();
}
