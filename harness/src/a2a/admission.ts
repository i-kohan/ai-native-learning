import {
  IMPACT_AGENT_NAME,
  IMPACT_BINDING,
  IMPACT_SKILL_ID,
} from "./constants.ts";

export type AdmittedAgent = {
  name: string;
  interfaceUrl: string;
  protocolVersion: string;
  binding: string;
  skillId: string;
};

export type AgentAdmission =
  | { ok: true; agent: AdmittedAgent }
  | { ok: false; reason: string };

export function admitDiscoveredAgent(
  card: unknown,
  expected: { interfaceUrl: string },
): AgentAdmission {
  if (!isRecord(card)) {
    return { ok: false, reason: "card_not_object" };
  }
  if (card.name !== IMPACT_AGENT_NAME) {
    return { ok: false, reason: "unexpected_agent_name" };
  }
  const skills = Array.isArray(card.skills) ? card.skills : [];
  const skill = skills.find(
    (entry) => isRecord(entry) && entry.id === IMPACT_SKILL_ID,
  );
  if (!skill) {
    return { ok: false, reason: "skill_not_advertised" };
  }
  const interfaces = Array.isArray(card.supportedInterfaces)
    ? card.supportedInterfaces
    : [];
  const selected = interfaces.find((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    return (
      entry.protocolBinding === IMPACT_BINDING &&
      isCompatibleProtocol(entry.protocolVersion) &&
      urlsMatch(entry.url, expected.interfaceUrl)
    );
  });
  if (!isRecord(selected) || typeof selected.url !== "string") {
    return { ok: false, reason: "interface_not_admitted" };
  }
  if (typeof selected.protocolVersion !== "string") {
    return { ok: false, reason: "interface_not_admitted" };
  }
  return {
    ok: true,
    agent: {
      name: IMPACT_AGENT_NAME,
      interfaceUrl: expected.interfaceUrl,
      protocolVersion: selected.protocolVersion,
      binding: IMPACT_BINDING,
      skillId: IMPACT_SKILL_ID,
    },
  };
}

export function isCompatibleProtocol(version: unknown): boolean {
  if (typeof version !== "string") {
    return false;
  }
  const [major, minor] = version.split(".");
  return major === "1" && minor === "0";
}

function urlsMatch(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string" || actual.trim() === "") {
    return false;
  }
  try {
    const left = new URL(actual);
    const right = new URL(expected);
    return (
      left.origin === right.origin &&
      trimSlash(left.pathname) === trimSlash(right.pathname)
    );
  } catch {
    return false;
  }
}

function trimSlash(value: string): string {
  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
