const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

// Who may instruct the agent. Anyone else can comment, and is quoted as such.
export const TRUSTED = new Set(
  (process.env.TRUSTED_ASSOCIATIONS ?? "OWNER,MEMBER,COLLABORATOR").split(",")
);

export type Comment = {
  id: number;
  body: string;
  created_at: string;
  author_association: string;
  user: { login: string };
  kind?: "issues" | "pulls";
  in_reply_to_id?: number;
  path?: string;
  line?: number | null;
  original_line?: number;
  diff_hunk?: string;
  html_url?: string;
};

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export class GitHubError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body
      ? { ...headers(), "content-type": "application/json" }
      : headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new GitHubError(
      response.status,
      `GitHub said ${response.status} to ${method} ${path}: ${await response.text()}`
    );
  }
  return response;
}

// GitHub gives the next page's URL rather than a count.
async function paginate<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined =
    `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;

  while (url) {
    const response: Response = await fetch(url, { headers: headers() });
    if (!response.ok) {
      throw new Error(
        `GitHub said ${response.status} to GET ${url}: ${await response.text()}`
      );
    }
    out.push(...((await response.json()) as T[]));
    url = next(response.headers.get("link"));
  }
  return out;
}

function next(link: string | null): string | undefined {
  return link
    ?.split(",")
    .map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1])
    .find(Boolean);
}

export function listComments(repo: string, issue: string, since?: string) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  return paginate<Comment>(`/repos/${repo}/issues/${issue}/comments${query}`);
}

export async function listReviewComments(
  repo: string,
  issue: string,
  since?: string
) {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const comments = await paginate<Comment>(
    `/repos/${repo}/pulls/${issue}/comments${query}`
  );
  return comments.map((c) => ({ ...c, kind: "pulls" as const }));
}
