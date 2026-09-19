import { DeliveryError } from "./delivery-error.ts";
import type { DeliveryState } from "./delivery-state.ts";
import type { GitHubClient, GitHubPull } from "./github-client.ts";
import { redactSecrets } from "./github-redact.ts";

export type BranchReconcileDecision =
  | { action: "create"; sha: string }
  | { action: "update"; sha: string; from: string }
  | { action: "already_equal"; sha: string };

export function decideRemoteBranchAction(options: {
  remoteSha: string | null;
  intendedSha: string;
  previousSha?: string;
}): BranchReconcileDecision {
  const remote = options.remoteSha?.toLowerCase() ?? null;
  const intended = options.intendedSha.toLowerCase();
  const previous = options.previousSha?.toLowerCase();

  if (remote === intended) {
    return { action: "already_equal", sha: intended };
  }
  if (remote === null) {
    return { action: "create", sha: intended };
  }
  if (previous && remote === previous) {
    return { action: "update", sha: intended, from: previous };
  }
  throw new DeliveryError(
    "unexpected_remote_head",
    `Remote branch moved to unexpected SHA ${remote}; refusing overwrite.`,
  );
}

export async function reconcileRemoteBranch(options: {
  github: GitHubClient;
  state: DeliveryState;
  pushLocal: () => void;
}): Promise<string> {
  const intended = requireSha(options.state.expectedHeadSha, "expectedHeadSha");
  const remote = await options.github.getRef(options.state.branch);
  const decision = decideRemoteBranchAction({
    remoteSha: remote?.sha ?? null,
    intendedSha: intended,
    previousSha: options.state.publishedHeadSha,
  });
  if (decision.action === "already_equal") {
    return decision.sha;
  }
  try {
    options.pushLocal();
  } catch (error) {
    if (!isAmbiguous(error)) {
      throw error;
    }
  }
  const after = await options.github.getRef(options.state.branch);
  if (after?.sha === intended) {
    return intended;
  }
  if (after?.sha && after.sha !== intended) {
    throw new DeliveryError(
      "unexpected_remote_head",
      `After push reconcile, remote is ${after.sha}, expected ${intended}.`,
    );
  }
  throw new DeliveryError(
    "ambiguous_side_effect",
    "Branch push was ambiguous and the remote still does not equal expectedHeadSha.",
    { operation: "git_push" },
  );
}

export async function reconcileDraftPull(options: {
  github: GitHubClient;
  state: DeliveryState;
  title: string;
  body: string;
}): Promise<GitHubPull> {
  const existing = await options.github.listPulls({
    head: options.state.branch,
    base: options.state.defaultBranch,
  });
  const open = existing.filter((pull) => !pull.merged);
  if (open.length > 1) {
    throw new DeliveryError(
      "illegal_transition",
      "Multiple open PRs exist for the deterministic delivery branch.",
    );
  }
  if (open.length === 1) {
    return open[0];
  }
  try {
    return await options.github.createDraftPull({
      title: options.title,
      body: options.body,
      head: options.state.branch,
      base: options.state.defaultBranch,
    });
  } catch (error) {
    if (!isAmbiguous(error)) {
      throw error;
    }
    const after = await options.github.listPulls({
      head: options.state.branch,
      base: options.state.defaultBranch,
    });
    const reused = after.filter((pull) => !pull.merged);
    if (reused.length === 1) {
      return reused[0];
    }
    throw new DeliveryError(
      "ambiguous_side_effect",
      redactSecrets(
        "create-PR was ambiguous and no unique PR could be reconciled; not creating again.",
      ),
      { operation: "create_pull" },
    );
  }
}

export function deliveryPrBody(state: DeliveryState): string {
  return [
    `Closes #${state.issueNumber}`,
    "",
    "Draft PR from the Module 20 delivery workflow. Ready for human review only.",
    "",
    `- workflowId: \`${state.workflowId}\``,
    `- baseSha: \`${state.baseSha}\``,
    `- expectedHeadSha: \`${state.expectedHeadSha ?? "unset"}\``,
    `- branch: \`${state.branch}\``,
    "",
    "This PR must not be auto-merged.",
  ].join("\n");
}

function requireSha(value: string | undefined, field: string): string {
  if (!value) {
    throw new DeliveryError("illegal_transition", `${field} is required.`);
  }
  return value.toLowerCase();
}

function isAmbiguous(error: unknown): boolean {
  return (
    error instanceof DeliveryError && error.code === "ambiguous_side_effect"
  );
}
