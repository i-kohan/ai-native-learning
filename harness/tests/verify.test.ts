import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  VERIFICATION_ENV_ALLOWLIST,
  verificationChildEnv,
} from "../src/verify.ts";

describe("verificationChildEnv", () => {
  it("copies only the allowlisted launch variables", () => {
    const child = verificationChildEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      TMPDIR: "/tmp",
      OPENAI_API_KEY: "sk-should-not-leak",
      SEC01_SECRET: "sec01-controlled-canary",
      NODE_TEST_CONTEXT: "1",
      NODE_OPTIONS: "--require ./evil.js",
      NPM_TOKEN: "registry-token",
      npm_config_authToken: "npm-token",
      UNRELATED: "host-noise",
    });

    assert.equal(child.PATH, "/usr/bin");
    assert.equal(child.HOME, "/tmp/home");
    assert.equal(child.TMPDIR, "/tmp");
    assert.equal(child.OPENAI_API_KEY, undefined);
    assert.equal(child.SEC01_SECRET, undefined);
    assert.equal(child.NODE_TEST_CONTEXT, undefined);
    assert.equal(child.NODE_OPTIONS, undefined);
    assert.equal(child.NPM_TOKEN, undefined);
    assert.equal(child.npm_config_authToken, undefined);
    assert.equal(child.UNRELATED, undefined);
    assert.deepEqual(Object.keys(child).sort(), ["HOME", "PATH", "TMPDIR"]);
  });

  it("does not grow by cloning the parent environment", () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: "/bin",
      OPENAI_API_KEY: "secret",
      EXTRA_HOST_VAR: "no",
    };
    const child = verificationChildEnv(parent);
    for (const key of Object.keys(child)) {
      assert.ok(
        (VERIFICATION_ENV_ALLOWLIST as readonly string[]).includes(key),
        `unexpected child env key: ${key}`,
      );
    }
    assert.equal("OPENAI_API_KEY" in child, false);
    assert.equal("EXTRA_HOST_VAR" in child, false);
  });
});
