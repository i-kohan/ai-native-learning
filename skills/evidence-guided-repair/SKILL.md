# Evidence-guided repair

Reusable procedure for repairing an existing implementation from external evidence.

This skill is procedural guidance. It does not replace the resolved spec, repository facts, harness constraints, verification, or review.

## Authority

- Keep the resolved spec authoritative for required behavior.
- Treat current repository state as the factual record of what the code does.
- Treat harness and tool constraints as authoritative.
- Do not treat this skill as a privileged role instruction or as a new product contract.

## Evidence

Treat supplied external evidence as evidence that a problem exists.

Do not treat it automatically as:

- the root cause;
- a complete diagnosis;
- a prescribed fix.

The same procedure applies whether the evidence is a deterministic test failure or an accepted review finding.

## Procedure

1. Diagnose against the current repository state and the resolved spec, not against a remembered earlier version of the code.
2. Inspect only the relevant causal surface for this evidence.
3. Choose the smallest appropriate repair that restores required behavior.
4. Preserve unrelated behavior.
5. Do not game the evidence by changing tests, spec, or the verifier.
6. When the repair is complete, stop and return control to the harness for external verification.
