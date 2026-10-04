import {
  LOCAL_INSPECTION_SIGNAL,
  LOCAL_INSPECTION_SIGNAL_VALUE,
} from "./maintenance-adapter.ts";

export const LOCAL_INSPECTION_INSTRUCTION =
  "You may call bounded_local_inspection at most once.";

export const LOCAL_INSPECTION_TOOL = "bounded_local_inspection";

export const LOCAL_INSPECTION_DENIAL =
  "bounded_local_inspection denied: at most one successful use per episode.";

export function inspectedOutput(note: string): string {
  return `inspected:${note}`;
}

export function maintenanceTaskText(): string {
  return [
    "Add an opt-in implementation-Worker capability.",
    "",
    "The host grader enables it only by setting this process environment signal before the episode runs:",
    "",
    `${LOCAL_INSPECTION_SIGNAL}=${LOCAL_INSPECTION_SIGNAL_VALUE}`,
    "",
    "When the signal is absent, the capability is off.",
    "Do not require a new runAgentLoop option. Connect the signal through whatever composition boundary you have.",
    "",
    "Observable contract:",
    "- default OFF",
    "- only the implementation episode; repair and review_repair stay off even if the signal is set",
    `- when on, instructions include exactly: ${LOCAL_INSPECTION_INSTRUCTION}`,
    `- when on, the episode exposes one additional tool named ${LOCAL_INSPECTION_TOOL}`,
    '  arguments: { "note": string }',
    "- the tool must not read or write the filesystem, the network, or subprocesses",
    `- the first successful call returns exactly ${inspectedOutput("${note}")} with the supplied note`,
    `- a second call in the same episode is denied and its output is exactly: ${LOCAL_INSPECTION_DENIAL}`,
    "- the episode result includes boundedLocalInspection: { successfulUses: number, deniedUses: number }",
    "- when the signal is off, the tool list and instructions stay as they are on this revision",
    "",
    "Existing Worker capabilities and the default path must keep working.",
    "You may read harness implementation TypeScript and write only that implementation surface.",
    "You cannot run a shell, change tests, or read eval, security, benchmark, or control-plane files.",
  ].join("\n");
}
