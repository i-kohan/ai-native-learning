import { A2A_PROTOCOL_VERSION, type AgentCard } from "@a2a-js/sdk";
import {
  IMPACT_AGENT_NAME,
  IMPACT_BINDING,
  IMPACT_SKILL_ID,
  impactInterfaceUrl,
} from "./constants.ts";

export function buildImpactAgentCard(baseUrl: string): AgentCard {
  const interfaceUrl = impactInterfaceUrl(baseUrl);
  return {
    name: IMPACT_AGENT_NAME,
    description:
      "Read-only repository impact analysis. Returns advisory evidence for one bounded scope.",
    supportedInterfaces: [
      {
        url: interfaceUrl,
        protocolBinding: IMPACT_BINDING,
        tenant: "",
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: "ai-native-learning",
      url: "https://github.com/i-kohan/ai-native-learning",
    },
    version: "1.0.0",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: IMPACT_SKILL_ID,
        name: "Repository impact analysis",
        description:
          "Inspect a bounded repository scope and return evidence about implementation impact.",
        tags: ["repository", "impact", "read-only"],
        examples: ["Where does a missing task become an HTTP 500?"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
      },
    ],
    signatures: [],
  };
}
