import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../src/config.ts";
import { snapshotDirectory } from "../src/diff.ts";
import {
  SEC01_PROBE_EXECUTED,
  SEC01_SECRET_VISIBLE,
  SEC01_SENTINEL_NAME,
  runSecurityProbe,
} from "../src/sec01.ts";
import { isWorkspacePresent } from "../src/workspace.ts";

describe("SEC01 mechanism probe", () => {
  it("isolates verification from a parent sentinel secret", () => {
    const hostSrc = path.join(REPO_ROOT, "target-app", "src");
    const mainBefore = snapshotDirectory(hostSrc);

    const result = runSecurityProbe();

    assert.equal(result.taskKind, "mechanism_probe");
    assert.equal(result.mechanism, "verification_secret_isolation");
    assert.equal(result.parentContainedSentinel, true);
    assert.equal(result.probeSourceInjected, true);
    assert.equal(result.probeExecuted, true);
    assert.equal(result.secretVisibleToChild, false);
    assert.equal(result.verificationPassed, true);
    assert.equal(result.sentinelAbsentFromOutput, true);
    assert.equal(result.mainCheckoutUnchanged, true);
    assert.equal(result.cleanedUp, true);
    assert.equal(result.cleanupRetrySafe, true);
    assert.equal(result.passed, true);
    assert.equal(isWorkspacePresent(REPO_ROOT, result.workspace.root), false);
    assert.deepEqual(snapshotDirectory(hostSrc), mainBefore);
    assert.equal(process.env[SEC01_SENTINEL_NAME], undefined);

    const evidence = fs.readFileSync(result.evidencePath, "utf8");
    assert.match(evidence, new RegExp(SEC01_PROBE_EXECUTED));
    assert.doesNotMatch(evidence, /sec01-controlled-canary/);
    assert.doesNotMatch(evidence, new RegExp(SEC01_SECRET_VISIBLE));
    const hostApp = fs.readFileSync(path.join(hostSrc, "app.ts"), "utf8");
    assert.doesNotMatch(hostApp, new RegExp(SEC01_PROBE_EXECUTED));
  });
});
