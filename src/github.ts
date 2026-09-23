// Everything this says to GitHub.
const API = "https://api.github.com";

// Who may instruct the agent. Anyone else can comment, and is quoted as such.
export const TRUSTED = new Set(
  (process.env.TRUSTED_ASSOCIATIONS ?? "OWNER,MEMBER,COLLABORATOR").split(","),
);

export type Comment = {
  id: number;
  body: string;
  created_at: string;
  author_association: string;
  user: { login: string };
};

function headers(token?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token ?? process.env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

// Claiming is the one thing that must not change hands: the reaction only
// settles who answers because GitHub reports it per authenticated account.
export const CLAIM_TOKEN = process.env.CLAIM_TOKEN || process.env.GH_TOKEN;

export async function request(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body
      ? { ...headers(token), "content-type": "application/json" }
      : headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub said ${response.status} to ${method} ${path}: ${await response.text()}`,
    );
  }
  return response;
}

// GitHub gives the next page's URL rather than a count.
export async function paginate<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = `${API}${path}${path.includes("?") ? "&" : "?"}per_page=100`;

  while (url) {
    const response: Response = await fetch(url, { headers: headers() });
    if (!response.ok) {
      throw new Error(`GitHub said ${response.status} to GET ${url}: ${await response.text()}`);
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
