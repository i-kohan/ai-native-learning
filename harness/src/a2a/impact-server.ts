import path from "node:path";
import express from "express";
import { AGENT_CARD_PATH, type AgentCard } from "@a2a-js/sdk";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
} from "@a2a-js/sdk/server";
import {
  UserBuilder,
  agentCardHandler,
  restHandler,
} from "@a2a-js/sdk/server/express";
import {
  A2A_ALLOWED_ROOT_ENV,
  A2A_BASE_URL_ENV,
  A2A_PORT_ENV,
  A2A_REMOTE_MODEL_ENV,
  A2A_REMOTE_OPENAI_API_KEY_ENV,
} from "./constants.ts";
import { buildImpactAgentCard } from "./impact-card.ts";
import { ImpactAnalysisExecutor } from "./impact-executor.ts";

export function createImpactApp(options: {
  agentCard: AgentCard;
  executor: AgentExecutor;
}): express.Express {
  const requestHandler = new DefaultRequestHandler(
    options.agentCard,
    new InMemoryTaskStore(),
    options.executor,
  );
  const app = express();
  app.use(
    `/${AGENT_CARD_PATH}`,
    agentCardHandler({ agentCardProvider: requestHandler }),
  );
  app.use(
    "/a2a/rest",
    restHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }),
  );
  return app;
}

export function startImpactAgentFromEnv(): void {
  if (process.env.OPENAI_API_KEY) {
    console.error(
      "refusing to start: OPENAI_API_KEY is present in the remote agent environment",
    );
    process.exit(1);
  }
  const allowedRoot = process.env[A2A_ALLOWED_ROOT_ENV];
  const baseUrl = process.env[A2A_BASE_URL_ENV];
  const port = Number(process.env[A2A_PORT_ENV]);
  if (!allowedRoot || !path.isAbsolute(allowedRoot)) {
    console.error(`${A2A_ALLOWED_ROOT_ENV} must be an absolute path.`);
    process.exit(1);
  }
  if (!baseUrl || !Number.isInteger(port) || port <= 0) {
    console.error("A2A_BASE_URL and A2A_PORT must be set by the host.");
    process.exit(1);
  }

  const app = createImpactApp({
    agentCard: buildImpactAgentCard(baseUrl),
    executor: new ImpactAnalysisExecutor({
      allowedRoot,
      apiKey: process.env[A2A_REMOTE_OPENAI_API_KEY_ENV] ?? "",
      model: process.env[A2A_REMOTE_MODEL_ENV] ?? "",
    }),
  });
  app.listen(port, "127.0.0.1", () => {
    console.log(`a2a_impact_agent_ready ${baseUrl}`);
  });
}

const isDirectRun = process.argv[1]?.endsWith("impact-server.ts");
if (isDirectRun) {
  startImpactAgentFromEnv();
}
