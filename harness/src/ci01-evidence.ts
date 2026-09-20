import { admitCurrentHeadCi, classifyCiEvidence } from "./ci-admission.ts";
import type { DeliveryProbeEvent } from "./delivery-run.ts";
import type { CiObservation, DeliveryState } from "./delivery-state.ts";

export type Ci01LiveRun = {
  id: number;
  headSha: string;
  conclusion: string | null;
};

export type Ci01LifecycleEvidence = {
  h1: string | null;
  h2: string | null;
  h1Ci: {
    headSha: string;
    conclusion: "failure";
    failureClass: "semantic";
    runId: number | null;
  } | null;
  repairEvidence: {
    sourceHeadSha: string;
    repairAttempt: 1;
    derivedFromH1CiFailure: boolean;
  } | null;
  h2Acceptance: {
    verificationPassed: boolean;
    reviewPassed: boolean;
    afterRepair: boolean;
    previousExpectedHeadSha: string | null;
  } | null;
  h2Ci: {
    headSha: string;
    conclusion: "success";
    runId: number | null;
  } | null;
  prNumber: number | null;
  samePr: boolean;
  staleH1CannotAuthorizeH2: {
    live: {
      realH1Fail: boolean;
      realH2Pass: boolean;
    };
    deterministic: {
      contract: "exact-head admission";
      classification: string;
      admission: string;
    };
  };
};

export function buildCi01LifecycleEvidence(options: {
  delivery: DeliveryState | null;
  events: DeliveryProbeEvent[];
  h1Runs: Ci01LiveRun[];
  h2Runs: Ci01LiveRun[];
  finalPrHeadSha: string | null;
}): Ci01LifecycleEvidence {
  const h1 = options.delivery?.firstHeadSha ?? null;
  const h2 = options.delivery?.expectedHeadSha ?? null;
  const h1Event = options.events.find(
    (event) =>
      event.type === "ci_observed" &&
      event.observation.headSha === h1 &&
      event.observation.conclusion === "failure",
  );
  const h1Live = completedRun(options.h1Runs, h1, "failure");
  const h1Observation =
    h1Event && h1Event.type === "ci_observed" ? h1Event.observation : null;
  const h1Ci =
    h1 &&
    h1Observation?.failureClass === "semantic" &&
    (h1Live !== null || h1Event !== undefined)
      ? {
          headSha: h1,
          conclusion: "failure" as const,
          failureClass: "semantic" as const,
          runId:
            h1Live?.id ??
            (h1Event && h1Event.type === "ci_observed" ? h1Event.runId : null),
        }
      : null;

  const repairEvent = options.events.find(
    (event) => event.type === "repair_started",
  );
  const repairEvidence =
    repairEvent && repairEvent.type === "repair_started"
      ? {
          sourceHeadSha: repairEvent.sourceHeadSha,
          repairAttempt: 1 as const,
          derivedFromH1CiFailure:
            repairEvent.sourceHeadSha === h1 &&
            h1Ci !== null &&
            repairEvent.repairAttempt === 1,
        }
      : null;

  const repairIndex = options.events.findIndex(
    (event) => event.type === "repair_started",
  );
  const h2Accept = options.events.find((event, eventIndex) => {
    if (event.type !== "candidate_accepted") {
      return false;
    }
    return (
      event.expectedHeadSha === h2 &&
      event.previousExpectedHeadSha === h1 &&
      (repairIndex === -1 || eventIndex > repairIndex)
    );
  });
  const h2Acceptance =
    h2Accept && h2Accept.type === "candidate_accepted"
      ? {
          verificationPassed: h2Accept.verificationPassed,
          reviewPassed: h2Accept.reviewPassed,
          afterRepair: repairIndex >= 0,
          previousExpectedHeadSha: h2Accept.previousExpectedHeadSha ?? null,
        }
      : null;

  const h2Event = options.events.find(
    (event) =>
      event.type === "ci_observed" &&
      event.observation.headSha === h2 &&
      event.observation.conclusion === "success",
  );
  const h2Live = completedRun(options.h2Runs, h2, "success");
  const h2Ci =
    h2 && (h2Live !== null || h2Event !== undefined)
      ? {
          headSha: h2,
          conclusion: "success" as const,
          runId:
            h2Live?.id ??
            (h2Event && h2Event.type === "ci_observed" ? h2Event.runId : null),
        }
      : null;

  const prFromH1 =
    h1Observation?.prNumber ?? options.delivery?.prNumber ?? null;
  const finalPr = options.delivery?.prNumber ?? null;
  const samePr =
    prFromH1 !== null &&
    finalPr !== null &&
    prFromH1 === finalPr &&
    options.finalPrHeadSha === h2 &&
    h1 !== null &&
    h2 !== null &&
    h1 !== h2;

  return {
    h1,
    h2,
    h1Ci,
    repairEvidence,
    h2Acceptance,
    h2Ci,
    prNumber: finalPr,
    samePr,
    staleH1CannotAuthorizeH2: proveStaleH1CannotAuthorizeH2({
      delivery: options.delivery,
      h1,
      h2,
      h1Observation,
      realH1Fail: h1Ci !== null,
      realH2Pass: h2Ci !== null,
    }),
  };
}

export function ci01Assertions(options: {
  delivery: DeliveryState | null;
  evidence: Ci01LifecycleEvidence;
  extra: Record<string, unknown>;
}): Record<string, boolean> {
  const { delivery, evidence } = options;
  return {
    distinctHeads: Boolean(
      evidence.h1 && evidence.h2 && evidence.h1 !== evidence.h2,
    ),
    realH1CiFailed:
      evidence.h1Ci?.conclusion === "failure" &&
      evidence.h1Ci.headSha === evidence.h1,
    h1FailureBoundToH1:
      evidence.h1Ci !== null && evidence.h1Ci.headSha === evidence.h1,
    repairDerivedFromH1:
      evidence.repairEvidence?.derivedFromH1CiFailure === true &&
      evidence.repairEvidence.sourceHeadSha === evidence.h1 &&
      (delivery?.ciRepairAttempts ?? 0) === 1,
    h2VerifyPassed: evidence.h2Acceptance?.verificationPassed === true,
    h2ReviewPassed: evidence.h2Acceptance?.reviewPassed === true,
    expectedHeadChangedAfterAcceptance:
      evidence.h2Acceptance?.afterRepair === true &&
      evidence.h2Acceptance.previousExpectedHeadSha === evidence.h1 &&
      delivery?.expectedHeadSha === evidence.h2,
    samePrAdvanced: evidence.samePr === true && Number(evidence.prNumber) > 0,
    staleH1CannotAuthorizeH2:
      evidence.staleH1CannotAuthorizeH2.live.realH1Fail &&
      evidence.staleH1CannotAuthorizeH2.live.realH2Pass &&
      evidence.staleH1CannotAuthorizeH2.deterministic.classification ===
        "stale" &&
      evidence.staleH1CannotAuthorizeH2.deterministic.admission ===
        "ignore_stale",
    realH2CiPassed:
      evidence.h2Ci?.conclusion === "success" &&
      evidence.h2Ci.headSha === evidence.h2 &&
      delivery?.ciObservation?.headSha === evidence.h2 &&
      delivery?.ciObservation?.conclusion === "success",
    readyForHumanReview: delivery?.deliveryPhase === "ready_for_human_review",
    prNotMerged: options.extra.prMerged === false,
  };
}

export function proveStaleH1CannotAuthorizeH2(options: {
  delivery: DeliveryState | null;
  h1: string | null;
  h2: string | null;
  h1Observation: CiObservation | null;
  realH1Fail: boolean;
  realH2Pass: boolean;
}): Ci01LifecycleEvidence["staleH1CannotAuthorizeH2"] {
  const empty = {
    live: {
      realH1Fail: options.realH1Fail,
      realH2Pass: options.realH2Pass,
    },
    deterministic: {
      contract: "exact-head admission" as const,
      classification: "unavailable",
      admission: "unavailable",
    },
  };
  if (!options.delivery || !options.h1 || !options.h2) {
    return empty;
  }
  const classification = classifyCiEvidence({
    expectedHeadSha: options.h2,
    headSha: options.h1,
    conclusion: "success",
    evidenceExcerpt: "",
  });
  const observation: CiObservation = {
    repository: options.delivery.repository,
    prNumber: options.h1Observation?.prNumber ?? options.delivery.prNumber ?? 0,
    headSha: options.h1,
    workflow: options.h1Observation?.workflow ?? "CI",
    job: options.h1Observation?.job ?? null,
    failedStep: options.h1Observation?.failedStep ?? null,
    conclusion: "success",
    failureClass: "success",
    evidenceExcerpt: "",
  };
  const admission = admitCurrentHeadCi({
    state: {
      ...options.delivery,
      expectedHeadSha: options.h2,
    },
    observation,
  });
  return {
    live: {
      realH1Fail: options.realH1Fail,
      realH2Pass: options.realH2Pass,
    },
    deterministic: {
      contract: "exact-head admission",
      classification,
      admission: admission.action,
    },
  };
}

function completedRun(
  runs: Ci01LiveRun[],
  headSha: string | null,
  conclusion: string,
): Ci01LiveRun | null {
  if (!headSha) {
    return null;
  }
  return (
    runs.find(
      (run) => run.headSha === headSha && run.conclusion === conclusion,
    ) ?? null
  );
}
