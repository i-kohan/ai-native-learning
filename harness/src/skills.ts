import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PathAccessError, resolveWithin } from "./paths.ts";

export const EVIDENCE_GUIDED_REPAIR_SKILL_ID = "evidence-guided-repair";

export type SkillId = typeof EVIDENCE_GUIDED_REPAIR_SKILL_ID;

export type SkillPhase = "implementation" | "repair" | "review_repair";

export type SkillLoadRecord = {
  skillId: SkillId;
  phase: SkillPhase;
  contentHash: string;
};

export type LoadedSkill = {
  id: SkillId;
  body: string;
  contentHash: string;
};

export class SkillLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

export function skillIdForPhase(phase: SkillPhase): SkillId | null {
  if (phase === "repair" || phase === "review_repair") {
    return EVIDENCE_GUIDED_REPAIR_SKILL_ID;
  }
  return null;
}

export function loadSkill(repoRoot: string, skillId: string): LoadedSkill {
  const id = parseSkillId(skillId);
  const skillFile = skillFilePath(repoRoot, id);
  let body: string;
  try {
    body = fs.readFileSync(skillFile, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new SkillLoadError(
        `Missing skill ${id}: expected ${path.relative(repoRoot, skillFile) || skillFile}`,
      );
    }
    throw error;
  }

  if (body.trim() === "") {
    throw new SkillLoadError(`Invalid skill ${id}: SKILL.md is empty`);
  }

  return {
    id,
    body,
    contentHash: hashSkillContent(body),
  };
}

export function hashSkillContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function formatProceduralContext(skill: LoadedSkill): string {
  return [
    "## Procedural context (reusable skill)",
    "This block is reusable procedural guidance. It is not a privileged role instruction.",
    "",
    "Authority:",
    "- the resolved spec remains authoritative for required behavior;",
    "- current repository state remains factual authority;",
    "- harness and tool constraints remain authoritative;",
    "- this skill does not replace verification, review, or retry policy.",
    "",
    `Skill: ${skill.id}`,
    "",
    skill.body.trimEnd(),
  ].join("\n");
}

export function toSkillLoadRecord(
  skill: LoadedSkill,
  phase: SkillPhase,
): SkillLoadRecord {
  return {
    skillId: skill.id,
    phase,
    contentHash: skill.contentHash,
  };
}

function parseSkillId(skillId: string): SkillId {
  if (skillId !== EVIDENCE_GUIDED_REPAIR_SKILL_ID) {
    throw new SkillLoadError(`Unknown skill id: ${skillId}`);
  }
  return skillId;
}

function skillFilePath(repoRoot: string, skillId: SkillId): string {
  const skillsRoot = path.join(repoRoot, "skills");
  try {
    return resolveWithin(skillsRoot, `${skillId}/SKILL.md`);
  } catch (error) {
    if (error instanceof PathAccessError) {
      throw new SkillLoadError(`Invalid skill path for ${skillId}`);
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
