import type { HarnessConfig } from "./config.ts";

export type ModelEpisode =
  | "spec"
  | "plan"
  | "implementation"
  | "repair"
  | "review"
  | "review_repair";

export type RoutingReason = "default" | "repair_override";

export type ModelSelection = {
  episode: ModelEpisode;
  model: string;
  reason: RoutingReason;
};

export type RoutingConfig = Pick<HarnessConfig, "model" | "repairModel">;

/**
 * Selects the model for one semantic episode.
 * Does not choose tools, permissions, limits, or any other authority.
 */
export function resolveModel(
  episode: ModelEpisode,
  config: RoutingConfig,
): ModelSelection {
  const repairOverride = config.repairModel?.trim();
  if (episode === "repair" && repairOverride) {
    return {
      episode,
      model: repairOverride,
      reason: "repair_override",
    };
  }

  return {
    episode,
    model: config.model,
    reason: "default",
  };
}

export function routingTraceFields(selection: ModelSelection): {
  episode: ModelEpisode;
  model: string;
  routingReason: RoutingReason;
} {
  return {
    episode: selection.episode,
    model: selection.model,
    routingReason: selection.reason,
  };
}
