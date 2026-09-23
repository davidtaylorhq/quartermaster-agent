// Everything this says to GitHub.
//
// One place that knows the token, the headers and what a page is, so the
// scripts that use it read as what they are rather than as shell wrapped in a
// subprocess.
const API = "https://api.github.com";

export type Comment = {
  id: number;
  body: string;
  created_at: string;
  author_association: string;
  user: { login: string };
  reactions?: { eyes: number };
};

function headers(): Record<string, string> {
  return {
    authorization: `Bearer ${process.env.GH_TOKEN}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

export async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body
      ? { ...headers(), "content-type": "application/json" }
      : headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub said ${response.status} to ${method} ${path}: ${await response.text()}`,
    );
  }
  return response;
}

// GitHub says where the next page is rather than how many there are, so this
// follows what it says instead of counting.
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
