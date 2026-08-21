import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../src/config.ts";
import { REPAIR_INSTRUCTIONS } from "../src/instructions.ts";
import { REVIEW_REPAIR_INSTRUCTIONS } from "../src/review-instructions.ts";
import {
  EVIDENCE_GUIDED_REPAIR_SKILL_ID,
  SkillLoadError,
  formatProceduralContext,
  hashSkillContent,
  loadSkill,
  skillIdForPhase,
} from "../src/skills.ts";
import { TOOL_DEFINITIONS, executeTool } from "../src/tools.ts";
import type { HarnessConfig } from "../src/config.ts";

describe("skill selection", () => {
  it("maps repair phases to evidence-guided-repair and implementation to none", () => {
    assert.equal(skillIdForPhase("implementation"), null);
    assert.equal(skillIdForPhase("repair"), EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    assert.equal(
      skillIdForPhase("review_repair"),
      EVIDENCE_GUIDED_REPAIR_SKILL_ID,
    );
  });
});

describe("skill loading", () => {
  it("loads the same SKILL.md with a stable content hash", () => {
    const first = loadSkill(REPO_ROOT, EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    const second = loadSkill(REPO_ROOT, EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    const raw = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "skills",
        EVIDENCE_GUIDED_REPAIR_SKILL_ID,
        "SKILL.md",
      ),
      "utf8",
    );
    assert.equal(first.id, EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    assert.equal(first.contentHash, second.contentHash);
    assert.equal(first.contentHash, hashSkillContent(raw));
    assert.match(first.contentHash, /^[a-f0-9]{64}$/);
    assert.match(first.body, /resolved spec/i);
    assert.match(first.body, /external evidence/i);
  });

  it("fails explicitly when the skill is missing or invalid", () => {
    const missingRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "skills-missing-"),
    );
    assert.throws(
      () => loadSkill(missingRoot, EVIDENCE_GUIDED_REPAIR_SKILL_ID),
      SkillLoadError,
    );
    assert.throws(
      () => loadSkill(REPO_ROOT, "not-a-real-skill"),
      /Unknown skill id/,
    );
    assert.throws(() => loadSkill(REPO_ROOT, "../secrets"), /Unknown skill id/);

    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skills-empty-"));
    const skillDir = path.join(
      emptyRoot,
      "skills",
      EVIDENCE_GUIDED_REPAIR_SKILL_ID,
    );
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "   \n");
    assert.throws(
      () => loadSkill(emptyRoot, EVIDENCE_GUIDED_REPAIR_SKILL_ID),
      /empty/,
    );
  });
});

describe("skill context boundary", () => {
  it("labels the skill as procedural context, not privileged instructions", () => {
    const skill = loadSkill(REPO_ROOT, EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    const block = formatProceduralContext(skill);
    assert.match(block, /Procedural context \(reusable skill\)/);
    assert.match(block, /not a privileged role instruction/i);
    assert.match(
      block,
      /does not replace verification, review, or retry policy/,
    );
    assert.doesNotMatch(REPAIR_INSTRUCTIONS, /causal surface/i);
    assert.doesNotMatch(REVIEW_REPAIR_INSTRUCTIONS, /causal surface/i);
    assert.doesNotMatch(REPAIR_INSTRUCTIONS, /game the evidence/i);
    assert.doesNotMatch(REVIEW_REPAIR_INSTRUCTIONS, /game the evidence/i);
    assert.match(skill.body, /causal surface/i);
    assert.match(skill.body, /game the evidence/i);
    assert.match(REPAIR_INSTRUCTIONS, /verification-repair/);
    assert.match(REVIEW_REPAIR_INSTRUCTIONS, /review-repair/);
    assert.match(REPAIR_INSTRUCTIONS, /Only change application source/);
    assert.match(REVIEW_REPAIR_INSTRUCTIONS, /Only change application source/);
  });

  it("does not expand tool authority", () => {
    const skill = loadSkill(REPO_ROOT, EVIDENCE_GUIDED_REPAIR_SKILL_ID);
    assert.equal("tools" in skill, false);
    assert.deepEqual(
      TOOL_DEFINITIONS.map((item) => item.name),
      ["list_files", "read_file", "write_file", "run_command"],
    );
    assert.doesNotMatch(formatProceduralContext(skill), /submit_review/);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-tools-"));
    const targetAppRoot = path.join(root, "target-app");
    const targetSrcRoot = path.join(targetAppRoot, "src");
    fs.mkdirSync(path.join(targetSrcRoot, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(targetAppRoot, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(targetAppRoot, "tests", "tasks.test.ts"),
      "test('protected', () => {});\n",
    );
    const config: HarnessConfig = {
      apiKey: "test",
      model: "test",
      maxTurns: 20,
      maxRepairAttempts: 2,
      maxReviewRepairAttempts: 1,
      repoRoot: root,
      targetAppRoot,
      targetSrcRoot,
      tracesDir: path.join(root, "traces"),
    };
    const denied = executeTool(
      config,
      "write_file",
      JSON.stringify({
        path: "../tests/tasks.test.ts",
        content: "hacked",
      }),
    );
    assert.equal(denied.ok, false);
  });
});
