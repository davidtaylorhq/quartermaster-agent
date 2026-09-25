import { execFileSync } from "node:child_process";
import { posix } from "node:path";
import { WORKSPACE } from "./runtime.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const FORMATS = {
  ".png": {
    contentType: "image/png",
    matches: (bytes: Buffer) =>
      bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  ".webm": {
    contentType: "video/webm",
    matches: (bytes: Buffer) =>
      bytes.subarray(0, 4).equals(Buffer.from("1a45dfa3", "hex")) &&
      bytes.subarray(0, 4096).includes(Buffer.from("webm")),
  },
};

export function readImage(path: unknown): {
  name: string;
  bytes: Buffer;
  contentType: string;
} {
  if (typeof path !== "string" || !path || path.includes("\0")) {
    throw new Error("path must name a PNG or WebM in /src");
  }
  const resolved = posix.resolve("/src", path);
  const extension = posix.extname(resolved).toLowerCase();
  const format = Object.hasOwn(FORMATS, extension)
    ? FORMATS[extension as keyof typeof FORMATS]
    : undefined;
  if (!resolved.startsWith("/src/") || !format) {
    throw new Error("path must name a PNG or WebM in /src");
  }
  // Read inside the credential-free container: symlinks cannot reach runner files.
  const bytes = execFileSync(
    "docker",
    [
      "exec",
      "-u",
      "agent",
      WORKSPACE,
      "timeout",
      "10",
      "head",
      "-c",
      String(MAX_BYTES + 1),
      "--",
      resolved,
    ],
    { timeout: 15_000, maxBuffer: MAX_BYTES + 1024 }
  );
  if (bytes.length > MAX_BYTES) {
    throw new Error("File exceeds the 10 MiB upload limit");
  }
  if (!format.matches(bytes)) {
    throw new Error("File contents do not match the extension");
  }
  return {
    name: posix.basename(resolved),
    bytes,
    contentType: format.contentType,
  };
}

export async function uploadImage(
  input: unknown,
  fetcher: typeof fetch = fetch
): Promise<{ url: string }> {
  const repo = process.env.ATTACHMENT_REPOSITORY;
  const token = process.env.ATTACHMENT_UPLOAD_TOKEN;
  if (!repo || !token) {
    throw new Error(
      "Media uploads require attachment-repository and attachment-upload-token in the calling workflow"
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("attachment-repository must be owner/repo");
  }
  const { name, bytes, contentType } = readImage(
    (input as { path?: unknown } | null)?.path
  );
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
  };
  const metadata = await fetcher(`https://api.github.com/repos/${repo}`, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!metadata.ok) {
    throw new Error(
      `Cannot access attachment repository: HTTP ${metadata.status}`
    );
  }
  const { id } = (await metadata.json()) as { id: number };
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("GitHub returned an invalid repository ID");
  }
  const query = new URLSearchParams({
    name,
    content_type: contentType,
    repository_id: String(id),
  });
  const response = await fetcher(
    `https://uploads.github.com/user-attachments/assets?${query}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(bytes),
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!response.ok) {
    throw new Error(`Media upload failed: HTTP ${response.status}`);
  }
  const { url } = (await response.json()) as { url: string };
  if (
    typeof url !== "string" ||
    !/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+$/.test(url)
  ) {
    throw new Error("GitHub returned an unexpected attachment URL");
  }
  return { url };
}
