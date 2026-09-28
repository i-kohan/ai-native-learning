import fs from "node:fs";
import path from "node:path";
import { normalizeRepoPath, type InvestigationReport } from "./investigation-report.ts";
import {
  SWM01_NOT_DEFAULT_NAME,
  SWM01_SURFACES,
  type Swm01FrozenSurface,
} from "./swm01-contract.ts";

export type Swm01GradeFinding = {
  mechanism: string;
  claim: string;
  reason: string;
};

export type Swm01Grade = {
  coverageMatched: string[];
  coverageMissing: string[];
  coverageRatio: number;
  correctnessConsistent: string[];
  correctnessInconsistent: string[];
  correctnessRatio: number;
  incorrectClaims: Swm01GradeFinding[];
  unsupportedFindings: Swm01GradeFinding[];
};

export function gradeInvestigationReport(
  report: InvestigationReport,
  repoRoot: string,
): Swm01Grade {
  const assignments = assignSurfaces(report);
  const incorrectClaims: Swm01GradeFinding[] = [];
  const unsupportedFindings: Swm01GradeFinding[] = [];
  const coverageMatched: string[] = [];
  const coverageMissing: string[] = [];
  const correctnessConsistent: string[] = [];
  const correctnessInconsistent: string[] = [];

  for (const surface of SWM01_SURFACES) {
    const mechanism = assignments.get(surface.id) ?? null;
    if (!mechanism) {
      coverageMissing.push(surface.id);
      continue;
    }
    coverageMatched.push(surface.id);
    const incorrect = incorrectClaimsFor(surface, mechanism);
    const unsupported = unsupportedPaths(surface, mechanism, repoRoot);
    incorrectClaims.push(...incorrect);
    unsupportedFindings.push(...unsupported);
    if (incorrect.length === 0) {
      correctnessConsistent.push(surface.id);
    } else {
      correctnessInconsistent.push(surface.id);
    }
  }

  for (const mechanism of report.mechanisms) {
    if ([...assignments.values()].includes(mechanism)) {
      continue;
    }
    if (
      SWM01_NOT_DEFAULT_NAME.test(mechanism.name) &&
      mechanism.defaultStatus === "default"
    ) {
      incorrectClaims.push({
        mechanism: mechanism.name,
        claim: "defaultStatus=default",
        reason: "SWM01 multi-agent investigation is not the default harness path.",
      });
    }
    for (const cited of mechanism.evidencePaths) {
      if (!fileExists(repoRoot, cited)) {
        unsupportedFindings.push({
          mechanism: mechanism.name,
          claim: cited,
          reason: "Evidence path does not exist in the repository.",
        });
      }
    }
  }

  return {
    coverageMatched,
    coverageMissing,
    coverageRatio: ratio(coverageMatched.length, SWM01_SURFACES.length),
    correctnessConsistent,
    correctnessInconsistent,
    correctnessRatio: ratio(correctnessConsistent.length, coverageMatched.length),
    incorrectClaims,
    unsupportedFindings,
  };
}

function assignSurfaces(
  report: InvestigationReport,
): Map<string, InvestigationReport["mechanisms"][number]> {
  const candidates: Array<{
    surfaceId: string;
    mechanismIndex: number;
    aliasLength: number;
  }> = [];
  SWM01_SURFACES.forEach((surface) => {
    report.mechanisms.forEach((mechanism, mechanismIndex) => {
      const name = mechanism.name.toLowerCase();
      for (const alias of surface.aliases) {
        if (name.includes(alias)) {
          candidates.push({
            surfaceId: surface.id,
            mechanismIndex,
            aliasLength: alias.length,
          });
        }
      }
    });
  });
  candidates.sort((left, right) => right.aliasLength - left.aliasLength);
  const usedSurfaces = new Set<string>();
  const usedMechanisms = new Set<number>();
  const assigned = new Map<string, InvestigationReport["mechanisms"][number]>();
  for (const candidate of candidates) {
    if (usedSurfaces.has(candidate.surfaceId) || usedMechanisms.has(candidate.mechanismIndex)) {
      continue;
    }
    usedSurfaces.add(candidate.surfaceId);
    usedMechanisms.add(candidate.mechanismIndex);
    assigned.set(candidate.surfaceId, report.mechanisms[candidate.mechanismIndex]);
  }
  return assigned;
}

function incorrectClaimsFor(
  surface: Swm01FrozenSurface,
  mechanism: InvestigationReport["mechanisms"][number],
): Swm01GradeFinding[] {
  const findings: Swm01GradeFinding[] = [];
  if (mechanism.durableSupport !== surface.durableSupport) {
    findings.push({
      mechanism: mechanism.name,
      claim: `durableSupport=${mechanism.durableSupport}`,
      reason: `Frozen contract expects ${surface.durableSupport} for ${surface.id}.`,
    });
  }
  if (mechanism.defaultStatus !== surface.defaultStatus) {
    findings.push({
      mechanism: mechanism.name,
      claim: `defaultStatus=${mechanism.defaultStatus}`,
      reason: `Frozen contract expects ${surface.defaultStatus} for ${surface.id}.`,
    });
  }
  if (!mentionsAny(mechanism.activationOwner, surface.activationMustMentionAny)) {
    findings.push({
      mechanism: mechanism.name,
      claim: mechanism.activationOwner,
      reason: `activationOwner does not identify the harness or caller gate for ${surface.id}.`,
    });
  }
  if (!mentionsAny(mechanism.capabilities.join(" "), surface.capabilityMustMentionAny)) {
    findings.push({
      mechanism: mechanism.name,
      claim: mechanism.capabilities.join("; "),
      reason: `capabilities do not describe the frozen ${surface.id} capability surface.`,
    });
  }
  if (
    !mentionsAny(
      mechanism.retainedOuterAuthority.join(" "),
      surface.retainedMustMentionAny,
    )
  ) {
    findings.push({
      mechanism: mechanism.name,
      claim: mechanism.retainedOuterAuthority.join("; "),
      reason: `retainedOuterAuthority does not keep outer harness authority for ${surface.id}.`,
    });
  }
  return findings;
}

function unsupportedPaths(
  surface: Swm01FrozenSurface,
  mechanism: InvestigationReport["mechanisms"][number],
  repoRoot: string,
): Swm01GradeFinding[] {
  const findings: Swm01GradeFinding[] = [];
  const existing: string[] = [];
  for (const cited of mechanism.evidencePaths) {
    if (fileExists(repoRoot, cited)) {
      existing.push(cited);
    } else {
      findings.push({
        mechanism: mechanism.name,
        claim: cited,
        reason: "Evidence path does not exist in the repository.",
      });
    }
  }
  const supported = existing.some((cited) =>
    surface.evidencePathFragments.some((fragment) => cited.includes(fragment)),
  );
  if (!supported) {
    findings.push({
      mechanism: mechanism.name,
      claim: mechanism.evidencePaths.join(", ") || "(no paths)",
      reason: `No existing evidence path matches the frozen fragments for ${surface.id}.`,
    });
  }
  return findings;
}

function mentionsAny(text: string, tokens: string[]): boolean {
  const haystack = text.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}

function fileExists(repoRoot: string, relativePath: string): boolean {
  const relative = normalizeRepoPath(relativePath);
  if (relative.split("/").includes("..") || path.isAbsolute(relative)) {
    return false;
  }
  const absolute = path.resolve(repoRoot, relative);
  const root = path.resolve(repoRoot);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (absolute !== root && !absolute.startsWith(prefix)) {
    return false;
  }
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}
