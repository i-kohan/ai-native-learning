export const IMPACT_AGENT_NAME = "harness-impact-agent";
export const IMPACT_SKILL_ID = "repository-impact-analysis";
export const IMPACT_BINDING = "HTTP+JSON";
export const IMPACT_REST_PATH = "/a2a/rest";
export const IMPACT_ARTIFACT_NAME = "ImpactAnalysis";

export const A2A_ALLOWED_ROOT_ENV = "A2A_ALLOWED_ROOT";
export const A2A_REMOTE_OPENAI_API_KEY_ENV = "A2A_REMOTE_OPENAI_API_KEY";
export const A2A_REMOTE_MODEL_ENV = "A2A_REMOTE_MODEL";
export const A2A_PORT_ENV = "A2A_PORT";
export const A2A_BASE_URL_ENV = "A2A_BASE_URL";

export function impactInterfaceUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${IMPACT_REST_PATH}`;
}
