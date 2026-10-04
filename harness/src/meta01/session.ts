import fs from "node:fs";
import path from "node:path";
import {
  validateHypothesis,
  type ImprovementHypothesis,
} from "./hypothesis.ts";
import {
  collectWorktreePatch,
  patchWithinBudget,
} from "./patch.ts";
import { candidateReadPath, candidateWritePath } from "./paths.ts";

export type SessionEvent = {
  seq: number;
  kind: "hypothesis_accepted" | "hypothesis_rejected" | "write" | "write_denied";
  path?: string;
  detail: string;
};

export type CandidateSession = {
  workspaceRoot: string;
  parentRevision: string;
  hypothesis: ImprovementHypothesis | null;
  submissionCount: number;
  events: SessionEvent[];
};

export function createCandidateSession(options: {
  workspaceRoot: string;
  parentRevision: string;
}): CandidateSession {
  return {
    workspaceRoot: options.workspaceRoot,
    parentRevision: options.parentRevision,
    hypothesis: null,
    submissionCount: 0,
    events: [],
  };
}

export function hypothesisAcceptedBeforeFirstWrite(session: CandidateSession): boolean {
  const accepted = session.events.find((event) => event.kind === "hypothesis_accepted");
  const write = session.events.find((event) => event.kind === "write");
  if (!write) {
    return session.hypothesis !== null;
  }
  return Boolean(accepted && accepted.seq < write.seq);
}

export function submitHypothesis(
  session: CandidateSession,
  value: unknown,
): { ok: boolean; message: string } {
  if (session.submissionCount > 0) {
    return deny(
      session,
      "hypothesis_rejected",
      "hypothesis denied: only one submission is allowed",
    );
  }
  session.submissionCount += 1;
  const validated = validateHypothesis(value);
  if (!validated.ok) {
    return deny(
      session,
      "hypothesis_rejected",
      `hypothesis denied: invalid ImprovementHypothesis (${validated.error})`,
    );
  }
  session.hypothesis = validated.value;
  pushEvent(session, "hypothesis_accepted", "hypothesis accepted");
  return { ok: true, message: "hypothesis accepted" };
}

export function readCandidateFile(
  session: CandidateSession,
  relativePath: string,
): { ok: boolean; message: string } {
  const located = candidateReadPath(session.workspaceRoot, relativePath);
  if (!located.ok) {
    return { ok: false, message: located.error };
  }
  if (!fs.existsSync(located.absolute)) {
    return { ok: false, message: `read denied: ${located.relative} does not exist` };
  }
  return { ok: true, message: fs.readFileSync(located.absolute, "utf8") };
}

export function writeCandidateFile(
  session: CandidateSession,
  relativePath: string,
  content: string,
): { ok: boolean; message: string } {
  if (session.hypothesis === null) {
    return deny(
      session,
      "write_denied",
      "write denied: improvement hypothesis has not been accepted",
      relativePath,
    );
  }
  if (typeof content !== "string") {
    return deny(session, "write_denied", "write denied: content must be a string", relativePath);
  }
  if (content.length > 200_000) {
    return deny(session, "write_denied", "write denied: content exceeds the file size cap", relativePath);
  }
  const located = candidateWritePath(session.workspaceRoot, relativePath);
  if (!located.ok) {
    return deny(session, "write_denied", located.error, relativePath);
  }
  const previous = fs.existsSync(located.absolute)
    ? fs.readFileSync(located.absolute, "utf8")
    : null;
  fs.mkdirSync(path.dirname(located.absolute), { recursive: true });
  fs.writeFileSync(located.absolute, content);
  const stats = collectWorktreePatch(session.workspaceRoot);
  const budget = patchWithinBudget(stats);
  if (!budget.ok) {
    restore(located.absolute, previous);
    return deny(session, "write_denied", budget.error, located.relative);
  }
  pushEvent(session, "write", `wrote ${located.relative}`, located.relative);
  return { ok: true, message: `wrote ${located.relative}` };
}

function deny(
  session: CandidateSession,
  kind: "hypothesis_rejected" | "write_denied",
  message: string,
  filePath?: string,
): { ok: false; message: string } {
  pushEvent(session, kind, message, filePath);
  return { ok: false, message };
}

function pushEvent(
  session: CandidateSession,
  kind: SessionEvent["kind"],
  detail: string,
  filePath?: string,
): void {
  session.events.push({
    seq: session.events.length + 1,
    kind,
    ...(filePath ? { path: filePath } : {}),
    detail,
  });
}

function restore(absolute: string, previous: string | null): void {
  if (previous === null) {
    fs.rmSync(absolute, { force: true });
    return;
  }
  fs.writeFileSync(absolute, previous);
}
