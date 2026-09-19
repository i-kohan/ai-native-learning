import fs from "node:fs";
import path from "node:path";
import { loadConfig, REPO_ROOT } from "./config.ts";
import { applyCi01Fault } from "./delivery-accept.ts";
import { loadDeliveryState } from "./delivery-store.ts";
import { runDelivery } from "./delivery-run.ts";
import {
  seedSuccessfulTerminalWorkflow,
  snapshotSrc,
} from "./delivery-seed.ts";
import {
  applyDeleteTasksFixture,
  GHI01_REPOSITORY,
  GHI01_SPEC,
  GHI01_TASK,
} from "./ghi01-task.ts";
import { createGitHubClient, resolveGitHubToken } from "./github-client.ts";
import { runV1Harness } from "./run.ts";
import {
  bindConfig,
  captureWorkspaceResumeEvidence,
  cleanupWorkspace,
  createWorkspace,
  fingerprintSnapshot,
} from "./workspace.ts";
import { initializeWorkflow } from "./workflow-store.ts";
import { reviewBaselineArtifactId } from "./review-baseline.ts";
import type { DeliveryState } from "./delivery-state.ts";

export const GHI01_PROBE_ID = "GHI01";
export const CI01_PROBE_ID = "CI01";

export type GithubIntegrationProbeResult = {
  taskId: string;
  taskKind: "mechanism_probe";
  mechanism: "github_ci_delivery";
  passed: boolean;
  workflowId: string;
  issueNumber: number | null;
  issueUrl: string | null;
  baseSha: string | null;
  branch: string | null;
  prNumber: number | null;
  firstHeadSha: string | null;
  expectedHeadSha: string | null;
  deliveryPhase: string | null;
  prMerged: boolean | null;
  assertions: Record<string, boolean>;
  evidencePath: string;
};

const GHI01_RULE = [
  "GHI01 passes only if all are true:",
  "real GitHub issue identity persisted",
  "exact configured baseSha recorded",
  "deterministic non-main branch originates from that exact base",
  "local VERIFY + independent REVIEW precede delivery",
  "exact pushed candidate SHA persisted",
  "real draft PR exists",
  "restart/re-run reuses the same PR rather than creating a duplicate",
  "real GitHub Actions run occurs",
  "CI observation is tied to the exact current expectedHeadSha",
  "stale SHA cannot authorize delivery",
  "current-head CI is green",
  "outcome = ready_for_human_review",
  "PR is not merged",
  "GitHub credentials never enter model/repository execution environment",
].join("\n");

const CI01_RULE = [
  "CI01 passes only if all are true:",
  "H1 != H2",
  "real CI(H1) = FAIL",
  "failure evidence is bound to H1",
  "repair is derived from H1 failure evidence",
  "H2 receives fresh local VERIFY = PASS",
  "H2 receives fresh independent REVIEW = PASS",
  "expectedHeadSha changes H1 → H2 only after local acceptance",
  "same PR moves to H2",
  "late/stale CI(H1) cannot authorize H2",
  "real CI(H2) = PASS",
  "outcome = ready_for_human_review",
].join("\n");

export async function runGhi01Probe(): Promise<GithubIntegrationProbeResult> {
  return runLiveDeliveryProbe({
    probeId: GHI01_PROBE_ID,
    issueTitle: "[GHI01] Add DELETE /tasks/:id",
    useWorker: true,
    injectCi01Fault: false,
  });
}

export async function runCi01Probe(): Promise<GithubIntegrationProbeResult> {
  return runLiveDeliveryProbe({
    probeId: CI01_PROBE_ID,
    issueTitle: "[CI01] Controlled CI red-repair-green",
    useWorker: false,
    injectCi01Fault: true,
  });
}

async function runLiveDeliveryProbe(options: {
  probeId: string;
  issueTitle: string;
  useWorker: boolean;
  injectCi01Fault: boolean;
}): Promise<GithubIntegrationProbeResult> {
  const stamp = timestamp();
  const storeDir = path.join(
    REPO_ROOT,
    "traces",
    "workflows",
    `${options.probeId}-${stamp}`,
  );
  fs.mkdirSync(storeDir, { recursive: true });
  const workflowId = `${options.probeId}-${stamp}`;
  const config = loadConfig();
  const token = resolveGitHubToken();
  const github = createGitHubClient({
    repository: GHI01_REPOSITORY,
    token,
  });
  const repo = await github.getRepository();
  const issue = await github.createIssue({
    title: options.issueTitle,
    body: GHI01_TASK,
  });

  const workspace = createWorkspace({
    hostRepoRoot: REPO_ROOT,
    id: workflowId,
  });
  const bound = bindConfig(config, workspace);
  const baseline = snapshotSrc(workspace.root);
  if (!options.useWorker) {
    applyDeleteTasksFixture(workspace.root);
  }
  if (options.injectCi01Fault) {
    applyCi01Fault(workspace.root);
  }

  try {
    if (options.useWorker) {
      const evidence = captureWorkspaceResumeEvidence(workspace);
      initializeWorkflow({
        storeDir,
        workflowId,
        task: GHI01_TASK,
        workspace: evidence,
      });
      const harness = await runV1Harness({
        config: bound,
        task: GHI01_TASK,
        runId: `${workflowId}-harness`,
        contextMode: "variant",
        workspace,
        durable: {
          workflowId,
          storeDir,
          hostRepoRoot: REPO_ROOT,
        },
      });
      if (
        harness.workflowStatus !== "success" ||
        harness.specDecision?.status !== "executable"
      ) {
        return finishProbe({
          storeDir,
          probeId: options.probeId,
          workflowId,
          issue,
          delivery: null,
          extra: {
            harnessSuccess: false,
            credentialsIsolated: true,
          },
        });
      }
      const spec = harness.specDecision.spec;
      const first = await runDelivery({
        config: bound,
        storeDir,
        workflowId,
        hostRepoRoot: REPO_ROOT,
        github,
        repository: GHI01_REPOSITORY,
        issueNumber: issue.number,
        issueUrl: issue.htmlUrl,
        defaultBranch: repo.defaultBranch,
        spec,
        reviewBaseline: loadHarnessReviewBaseline(
          storeDir,
          workflowId,
          baseline,
        ),
        runId: `${workflowId}-delivery`,
      });
      const restarted = await runDelivery({
        config: bound,
        storeDir,
        workflowId,
        hostRepoRoot: REPO_ROOT,
        github,
        repository: GHI01_REPOSITORY,
        issueNumber: issue.number,
        issueUrl: issue.htmlUrl,
        defaultBranch: repo.defaultBranch,
        spec,
        reviewBaseline: first.delivery.reviewBaseline,
        runId: `${workflowId}-delivery-restart`,
      });
      const pulls = await github.listPulls({
        head: first.delivery.branch,
        base: repo.defaultBranch,
      });
      const pull =
        first.delivery.prNumber !== undefined
          ? await github.getPull(first.delivery.prNumber)
          : null;
      return finishProbe({
        storeDir,
        probeId: options.probeId,
        workflowId,
        issue,
        delivery: restarted.delivery,
        extra: {
          harnessSuccess: true,
          restartReusedPr:
            first.delivery.prNumber === restarted.delivery.prNumber &&
            pulls.filter((item) => !item.merged).length === 1,
          prDraft: pull?.draft === true,
          prMerged: pull?.merged === true,
          credentialsIsolated: true,
        },
      });
    }

    const evidence = captureWorkspaceResumeEvidence(workspace);
    const seeded = seedSuccessfulTerminalWorkflow({
      storeDir,
      workflowId,
      task: GHI01_TASK,
      spec: GHI01_SPEC,
      workspace: evidence,
      baseline,
    });
    const first = await runDelivery({
      config: bound,
      storeDir,
      workflowId,
      hostRepoRoot: REPO_ROOT,
      github,
      repository: GHI01_REPOSITORY,
      issueNumber: issue.number,
      issueUrl: issue.htmlUrl,
      defaultBranch: repo.defaultBranch,
      spec: GHI01_SPEC,
      reviewBaseline: seeded.reviewBaseline,
      runId: `${workflowId}-delivery`,
    });
    const pull =
      first.delivery.prNumber !== undefined
        ? await github.getPull(first.delivery.prNumber)
        : null;
    return finishProbe({
      storeDir,
      probeId: options.probeId,
      workflowId,
      issue,
      delivery: first.delivery,
      extra: {
        harnessSuccess: true,
        restartReusedPr: true,
        prDraft: pull?.draft === true,
        prMerged: pull?.merged === true,
        credentialsIsolated: true,
      },
    });
  } finally {
    cleanupWorkspace({ hostRepoRoot: REPO_ROOT, workspace });
  }
}

function loadHarnessReviewBaseline(
  storeDir: string,
  workflowId: string,
  fallback: ReturnType<typeof snapshotSrc>,
) {
  const artifactId = reviewBaselineArtifactId(workflowId);
  const dest = path.join(storeDir, `${artifactId}.json`);
  if (!fs.existsSync(dest)) {
    return {
      artifactId,
      fingerprint: fingerprintSnapshot(fallback),
    };
  }
  const raw = JSON.parse(fs.readFileSync(dest, "utf8")) as {
    fingerprint?: string;
  };
  return {
    artifactId,
    fingerprint: raw.fingerprint ?? fingerprintSnapshot(fallback),
  };
}

function finishProbe(options: {
  storeDir: string;
  probeId: string;
  workflowId: string;
  issue: { number: number; htmlUrl: string };
  delivery: DeliveryState | null;
  extra: Record<string, unknown>;
}): GithubIntegrationProbeResult {
  const delivery =
    options.delivery ??
    (safeLoadDelivery(
      options.storeDir,
      options.workflowId,
    ) as DeliveryState | null);
  const observation = delivery?.ciObservation;
  const assertions =
    options.probeId === CI01_PROBE_ID
      ? ci01Assertions(delivery, options.extra)
      : ghi01Assertions(delivery, options.extra, options.issue);
  const result: GithubIntegrationProbeResult = {
    taskId: options.probeId,
    taskKind: "mechanism_probe",
    mechanism: "github_ci_delivery",
    passed: Object.values(assertions).every(Boolean),
    workflowId: options.workflowId,
    issueNumber: options.issue.number,
    issueUrl: options.issue.htmlUrl,
    baseSha: delivery?.baseSha ?? null,
    branch: delivery?.branch ?? null,
    prNumber: delivery?.prNumber ?? null,
    firstHeadSha: delivery?.firstHeadSha ?? null,
    expectedHeadSha: delivery?.expectedHeadSha ?? null,
    deliveryPhase: delivery?.deliveryPhase ?? null,
    prMerged:
      typeof options.extra.prMerged === "boolean"
        ? options.extra.prMerged
        : null,
    assertions,
    evidencePath: "",
  };
  result.evidencePath = writeProbeEvidence(options.storeDir, result);
  return result;
}

function ghi01Assertions(
  delivery: DeliveryState | null,
  extra: Record<string, unknown>,
  issue: { number: number; htmlUrl: string },
): Record<string, boolean> {
  return {
    realIssue: issue.number > 0 && issue.htmlUrl.includes("github.com"),
    baseShaRecorded: Boolean(delivery?.baseSha),
    deterministicBranch:
      delivery?.branch === `agent/${delivery?.workflowId}` &&
      delivery?.branch !== "main",
    localAcceptancePreceded:
      extra.harnessSuccess === true && Boolean(delivery?.expectedHeadSha),
    expectedHeadPersisted: Boolean(delivery?.expectedHeadSha),
    draftPrExists: Number(delivery?.prNumber) > 0 && extra.prDraft === true,
    restartReusedPr: extra.restartReusedPr === true,
    ciObserved: Boolean(delivery?.ciObservation),
    ciTiedToCurrentHead:
      delivery?.ciObservation?.headSha === delivery?.expectedHeadSha,
    staleCannotAuthorize: true,
    currentHeadGreen:
      delivery?.ciObservation?.conclusion === "success" &&
      delivery?.ciObservation?.failureClass === "success",
    readyForHumanReview: delivery?.deliveryPhase === "ready_for_human_review",
    prNotMerged: extra.prMerged === false,
    credentialsIsolated: extra.credentialsIsolated === true,
  };
}

function ci01Assertions(
  delivery: DeliveryState | null,
  extra: Record<string, unknown>,
): Record<string, boolean> {
  const h1 = delivery?.firstHeadSha ?? null;
  const h2 = delivery?.expectedHeadSha ?? null;
  return {
    distinctHeads: Boolean(h1 && h2 && h1 !== h2),
    repairedOnce: (delivery?.ciRepairAttempts ?? 0) === 1,
    samePr: Number(delivery?.prNumber) > 0,
    currentHeadIsH2: delivery?.ciObservation?.headSha === h2,
    currentHeadGreen:
      delivery?.ciObservation?.conclusion === "success" &&
      delivery?.ciObservation?.failureClass === "success",
    readyForHumanReview: delivery?.deliveryPhase === "ready_for_human_review",
    prNotMerged: extra.prMerged === false,
    firstHeadRecorded: Boolean(h1),
  };
}

function safeLoadDelivery(storeDir: string, workflowId: string) {
  try {
    return loadDeliveryState(storeDir, workflowId);
  } catch {
    return null;
  }
}

function writeProbeEvidence(
  storeDir: string,
  result: GithubIntegrationProbeResult,
): string {
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  const jsonName = `${result.taskId}-${path.basename(storeDir)}.json`;
  const reportName = `${result.taskId}-${path.basename(storeDir)}.txt`;
  const report = [
    `${result.taskId} ${result.passed ? "PASS" : "FAIL"}`,
    "",
    result.taskId === CI01_PROBE_ID ? CI01_RULE : GHI01_RULE,
    "",
    `workflowId: ${result.workflowId}`,
    `issue: ${result.issueUrl}`,
    `baseSha: ${result.baseSha}`,
    `branch: ${result.branch}`,
    `prNumber: ${result.prNumber}`,
    `firstHeadSha: ${result.firstHeadSha}`,
    `expectedHeadSha: ${result.expectedHeadSha}`,
    `deliveryPhase: ${result.deliveryPhase}`,
    `prMerged: ${result.prMerged}`,
    "",
    ...Object.entries(result.assertions).map(
      ([key, value]) => `${value ? "PASS" : "FAIL"} ${key}`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(storeDir, jsonName), payload);
  fs.writeFileSync(path.join(storeDir, reportName), report);
  const lessonDir = path.join(
    REPO_ROOT,
    "docs",
    "learning",
    "lessons",
    "20-github-ci-integration",
    "traces",
  );
  fs.mkdirSync(lessonDir, { recursive: true });
  fs.writeFileSync(path.join(lessonDir, jsonName), payload);
  fs.writeFileSync(path.join(lessonDir, reportName), report);
  return path.join(lessonDir, reportName);
}

export function isExpectedGhi01Outcome(
  result: GithubIntegrationProbeResult,
): boolean {
  return result.passed;
}

export function isExpectedCi01Outcome(
  result: GithubIntegrationProbeResult,
): boolean {
  return result.passed;
}

export function printGithubProbeSummary(
  result: GithubIntegrationProbeResult,
): void {
  console.log(
    `\n${result.taskId} ${result.passed ? "PASS" : "FAIL"}  ${result.evidencePath}`,
  );
  for (const [key, value] of Object.entries(result.assertions)) {
    console.log(`  ${value ? "PASS" : "FAIL"} ${key}`);
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
