import { DeliveryError } from "./delivery-error.ts";
import { redactSecrets } from "./github-redact.ts";

export type GitHubPull = {
  number: number;
  headSha: string;
  base: string;
  head: string;
  draft: boolean;
  merged: boolean;
  htmlUrl: string;
};

export type GitHubIssue = {
  number: number;
  htmlUrl: string;
  title?: string;
  state?: string;
};

export type GitHubWorkflowRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
};

export type GitHubJob = {
  id: number;
  name: string;
  conclusion: string | null;
  steps: Array<{ name: string; conclusion: string | null }>;
};

export type GitHubRepositoryInfo = {
  defaultBranch: string;
};

export type GitHubClient = {
  getRepository(): Promise<GitHubRepositoryInfo>;
  getRef(branch: string): Promise<{ sha: string } | null>;
  createRef(branch: string, sha: string): Promise<void>;
  updateRef(branch: string, sha: string): Promise<void>;
  listPulls(options: { head: string; base: string }): Promise<GitHubPull[]>;
  createDraftPull(options: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GitHubPull>;
  getPull(number: number): Promise<GitHubPull>;
  createIssue(options: { title: string; body: string }): Promise<GitHubIssue>;
  getIssue(number: number): Promise<GitHubIssue>;
  createIssueComment(number: number, body: string): Promise<void>;
  closeIssue(number: number): Promise<void>;
  listWorkflowRuns(headSha: string): Promise<GitHubWorkflowRun[]>;
  listJobs(runId: number): Promise<GitHubJob[]>;
  getJobLogExcerpt(jobId: number): Promise<string>;
};

export function resolveGitHubToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (!token) {
    throw new DeliveryError(
      "missing_credentials",
      "Missing GitHub credentials in the delivery layer environment.",
    );
  }
  return token;
}

export function gitRefUpdateBody(sha: string): { sha: string; force: false } {
  return { sha, force: false };
}

export function createGitHubClient(options: {
  repository: string;
  token: string;
  fetchImpl?: typeof fetch;
}): GitHubClient {
  const [owner, repo] = parseRepository(options.repository);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-native-delivery",
  };

  const request = async (
    method: string,
    apiPath: string,
    body?: unknown,
    operation?: string,
  ): Promise<{ status: number; json: unknown; text: string }> => {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.github.com${apiPath}`, {
        method,
        headers: body
          ? { ...headers, "Content-Type": "application/json" }
          : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new DeliveryError(
        "ambiguous_side_effect",
        redactSecrets(
          `GitHub ${operation ?? method} network failure: ${stringifyError(error)}`,
        ),
        { operation: operation ?? method },
      );
    }
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json, text };
  };

  return {
    async getRepository() {
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}`,
        undefined,
        "get_repository",
      );
      if (result.status !== 200 || !isRecord(result.json)) {
        throw apiError("get_repository", result);
      }
      const defaultBranch = result.json.default_branch;
      if (typeof defaultBranch !== "string" || defaultBranch.trim() === "") {
        throw new DeliveryError(
          "corrupt_state",
          "GitHub repository default_branch is missing.",
        );
      }
      return { defaultBranch };
    },

    async getRef(branch) {
      const encoded = encodeURIComponent(`heads/${stripRefsHeads(branch)}`);
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/git/ref/${encoded}`,
        undefined,
        "get_ref",
      );
      if (result.status === 404) {
        return null;
      }
      if (result.status !== 200 || !isRecord(result.json)) {
        throw apiError("get_ref", result);
      }
      const object = isRecord(result.json.object) ? result.json.object : null;
      const sha = object && typeof object.sha === "string" ? object.sha : null;
      if (!sha) {
        throw new DeliveryError(
          "corrupt_state",
          "GitHub ref object.sha is missing.",
        );
      }
      return { sha: sha.toLowerCase() };
    },

    async createRef(branch, sha) {
      const result = await request(
        "POST",
        `/repos/${owner}/${repo}/git/refs`,
        { ref: `refs/heads/${stripRefsHeads(branch)}`, sha },
        "create_ref",
      );
      if (result.status !== 201) {
        throw writeError("create_ref", result);
      }
    },

    async updateRef(branch, sha) {
      const encoded = encodeURIComponent(`heads/${stripRefsHeads(branch)}`);
      const result = await request(
        "PATCH",
        `/repos/${owner}/${repo}/git/refs/${encoded}`,
        gitRefUpdateBody(sha),
        "update_ref",
      );
      if (result.status !== 200) {
        throw writeError("update_ref", result);
      }
    },

    async listPulls({ head, base }) {
      const query = new URLSearchParams({
        head: `${owner}:${stripRefsHeads(head)}`,
        base: stripRefsHeads(base),
        state: "all",
      });
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/pulls?${query.toString()}`,
        undefined,
        "list_pulls",
      );
      if (result.status !== 200 || !Array.isArray(result.json)) {
        throw apiError("list_pulls", result);
      }
      return result.json.map((item) => parsePull(item));
    },

    async createDraftPull({ title, body, head, base }) {
      const result = await request(
        "POST",
        `/repos/${owner}/${repo}/pulls`,
        {
          title,
          body,
          head: stripRefsHeads(head),
          base: stripRefsHeads(base),
          draft: true,
        },
        "create_pull",
      );
      if (result.status !== 201) {
        throw writeError("create_pull", result);
      }
      return parsePull(result.json);
    },

    async getPull(number) {
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/pulls/${number}`,
        undefined,
        "get_pull",
      );
      if (result.status !== 200) {
        throw apiError("get_pull", result);
      }
      return parsePull(result.json);
    },

    async createIssue({ title, body }) {
      const result = await request(
        "POST",
        `/repos/${owner}/${repo}/issues`,
        { title, body },
        "create_issue",
      );
      if (result.status !== 201 || !isRecord(result.json)) {
        throw writeError("create_issue", result);
      }
      const number = parsePositiveId(result.json.number, "issue.number");
      const htmlUrl = result.json.html_url;
      if (typeof htmlUrl !== "string") {
        throw new DeliveryError(
          "corrupt_state",
          "GitHub issue identity is missing.",
        );
      }
      return { number, htmlUrl };
    },

    async getIssue(number) {
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/issues/${number}`,
        undefined,
        "get_issue",
      );
      if (result.status !== 200) {
        throw apiError("get_issue", result);
      }
      return parseIssue(result.json);
    },

    async createIssueComment(number, body) {
      const result = await request(
        "POST",
        `/repos/${owner}/${repo}/issues/${number}/comments`,
        { body },
        "create_issue_comment",
      );
      if (result.status !== 201) {
        throw writeError("create_issue_comment", result);
      }
    },

    async closeIssue(number) {
      const result = await request(
        "PATCH",
        `/repos/${owner}/${repo}/issues/${number}`,
        { state: "closed" },
        "close_issue",
      );
      if (result.status !== 200) {
        throw writeError("close_issue", result);
      }
    },

    async listWorkflowRuns(headSha) {
      const query = new URLSearchParams({ head_sha: headSha });
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/actions/runs?${query.toString()}`,
        undefined,
        "list_workflow_runs",
      );
      if (
        result.status !== 200 ||
        !isRecord(result.json) ||
        !Array.isArray(result.json.workflow_runs)
      ) {
        throw apiError("list_workflow_runs", result);
      }
      return result.json.workflow_runs.map((item) => parseRun(item));
    },

    async listJobs(runId) {
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/actions/runs/${runId}/jobs`,
        undefined,
        "list_jobs",
      );
      if (
        result.status !== 200 ||
        !isRecord(result.json) ||
        !Array.isArray(result.json.jobs)
      ) {
        throw apiError("list_jobs", result);
      }
      return result.json.jobs.map((item) => parseJob(item));
    },

    async getJobLogExcerpt(jobId) {
      const result = await request(
        "GET",
        `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`,
        undefined,
        "get_job_logs",
      );
      if (result.status === 404 || result.status === 410) {
        return "";
      }
      if (result.status >= 400) {
        throw apiError("get_job_logs", result);
      }
      return redactSecrets(result.text);
    },
  };
}

function parseIssue(value: unknown): GitHubIssue {
  if (!isRecord(value)) {
    throw new DeliveryError(
      "corrupt_state",
      "GitHub issue payload must be an object.",
    );
  }
  const number = parsePositiveId(value.number, "issue.number");
  const htmlUrl = value.html_url;
  if (typeof htmlUrl !== "string") {
    throw new DeliveryError("corrupt_state", "GitHub issue identity is missing.");
  }
  return {
    number,
    htmlUrl,
    title: typeof value.title === "string" ? value.title : undefined,
    state: typeof value.state === "string" ? value.state : undefined,
  };
}

function parsePull(value: unknown): GitHubPull {
  if (!isRecord(value)) {
    throw new DeliveryError(
      "corrupt_state",
      "GitHub pull payload must be an object.",
    );
  }
  const head = isRecord(value.head) ? value.head : null;
  const base = isRecord(value.base) ? value.base : null;
  const number = parsePositiveId(value.number, "pull.number");
  const htmlUrl = value.html_url;
  const draft = value.draft === true;
  const merged = value.merged === true || value.merged_at != null;
  const headSha = head && typeof head.sha === "string" ? head.sha : null;
  const headRef = head && typeof head.ref === "string" ? head.ref : null;
  const baseRef = base && typeof base.ref === "string" ? base.ref : null;
  if (typeof htmlUrl !== "string" || !headSha || !headRef || !baseRef) {
    throw new DeliveryError(
      "corrupt_state",
      "GitHub pull identity is incomplete.",
    );
  }
  return {
    number,
    headSha: headSha.toLowerCase(),
    head: headRef,
    base: baseRef,
    draft,
    merged,
    htmlUrl,
  };
}

function parseRun(value: unknown): GitHubWorkflowRun {
  if (!isRecord(value)) {
    throw new DeliveryError(
      "corrupt_state",
      "GitHub workflow run must be an object.",
    );
  }
  const id = parsePositiveId(value.id, "workflow_run.id");
  const name = typeof value.name === "string" ? value.name : "CI";
  const status = typeof value.status === "string" ? value.status : "unknown";
  const conclusion =
    typeof value.conclusion === "string" || value.conclusion === null
      ? value.conclusion
      : null;
  const headSha = typeof value.head_sha === "string" ? value.head_sha : "";
  if (!headSha) {
    throw new DeliveryError(
      "corrupt_state",
      "GitHub workflow run identity is incomplete.",
    );
  }
  return { id, name, status, conclusion, headSha: headSha.toLowerCase() };
}

function parseJob(value: unknown): GitHubJob {
  if (!isRecord(value)) {
    throw new DeliveryError("corrupt_state", "GitHub job must be an object.");
  }
  const id = parsePositiveId(value.id, "job.id");
  const name = typeof value.name === "string" ? value.name : "job";
  const conclusion =
    typeof value.conclusion === "string" || value.conclusion === null
      ? value.conclusion
      : null;
  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((step) => {
        if (!isRecord(step) || typeof step.name !== "string") {
          return [];
        }
        return [
          {
            name: step.name,
            conclusion:
              typeof step.conclusion === "string" || step.conclusion === null
                ? step.conclusion
                : null,
          },
        ];
      })
    : [];
  return { id, name, conclusion, steps };
}

function parsePositiveId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new DeliveryError("corrupt_state", `${field} must be an integer >= 1.`);
  }
  return value;
}

function parseRepository(repository: string): [string, string] {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo || repository.split("/").length !== 2) {
    throw new DeliveryError("corrupt_state", "repository must be owner/name.");
  }
  return [owner, repo];
}

function stripRefsHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

function apiError(
  operation: string,
  result: { status: number; text: string },
): DeliveryError {
  return new DeliveryError(
    "delivery_failed",
    redactSecrets(`GitHub ${operation} failed (${result.status}).`),
    { operation },
  );
}

function writeError(
  operation: string,
  result: { status: number; text: string },
): DeliveryError {
  return new DeliveryError(
    "ambiguous_side_effect",
    redactSecrets(
      `GitHub ${operation} returned ${result.status}; the write may have happened.`,
    ),
    { operation },
  );
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
