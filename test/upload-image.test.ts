import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { readImage, uploadImage } from "../lib/upload-image.ts";

let dir: string;
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const url = "https://github.com/user-attachments/assets/12345678-abcd";

before(() => {
  dir = mkdtempSync(join(tmpdir(), "upload-image-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(
    join(dir, "bin/docker"),
    `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.UPLOAD_TEST_DIR + '/args.json', JSON.stringify(process.argv.slice(2)));
process.stdout.write(fs.readFileSync(process.env.UPLOAD_TEST_DIR + '/image.png'));
`
  );
  chmodSync(join(dir, "bin/docker"), 0o755);
  process.env.PATH = `${dir}/bin:${process.env.PATH}`;
  process.env.UPLOAD_TEST_DIR = dir;
});
after(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  writeFileSync(join(dir, "image.png"), png);
  process.env.ATTACHMENT_REPOSITORY = "owner/assets";
  process.env.ATTACHMENT_UPLOAD_TOKEN = "upload-secret";
  process.env.GH_TOKEN = "comment-secret";
});

test("uploads sandbox bytes with the dedicated PAT to the configured repository", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const result = await uploadImage(
    { path: "tmp/a $(command).png", repository: "other/repo" },
    async (input, options) => {
      calls.push({ url: String(input), options: options! });
      return Response.json(calls.length === 1 ? { id: 42 } : { url });
    }
  );
  assert.deepEqual(result, { url });
  assert.equal(calls[0]!.url, "https://api.github.com/repos/owner/assets");
  const upload = calls[1]!;
  const parsed = new URL(upload.url);
  assert.equal(parsed.origin, "https://uploads.github.com");
  assert.equal(parsed.searchParams.get("repository_id"), "42");
  assert.equal(parsed.searchParams.get("name"), "a $(command).png");
  assert.deepEqual(upload.options.body, new Uint8Array(png));
  for (const { options } of calls) {
    assert.equal(
      new Headers(options.headers).get("Authorization"),
      "token upload-secret"
    );
    assert.equal(options.redirect, "error");
  }
  const args = JSON.parse(readFileSync(join(dir, "args.json"), "utf8"));
  assert.deepEqual(args, [
    "exec",
    "-u",
    "agent",
    "workflow-agent-sandbox",
    "timeout",
    "10",
    "head",
    "-c",
    "10485761",
    "--",
    "/src/tmp/a $(command).png",
  ]);
});

test("rejects missing configuration before reading files or contacting GitHub", async () => {
  delete process.env.ATTACHMENT_UPLOAD_TOKEN;
  await assert.rejects(
    uploadImage({ path: "tmp/test.png" }, async () => {
      throw new Error("unexpected request");
    }),
    /require attachment-repository/
  );
});

test("rejects invalid paths, non-images, and oversized files", () => {
  for (const path of [
    undefined,
    "",
    "/etc/secret.png",
    "../secret.png",
    "/src/../../secret.png",
    "test.jpg",
    "test\0.png",
  ]) {
    assert.throws(() => readImage(path), /PNG or WebM in \/src/);
  }
  writeFileSync(join(dir, "image.png"), "not an image");
  assert.throws(() => readImage("tmp/test.png"), /do not match/);
  writeFileSync(join(dir, "image.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.throws(() => readImage("tmp/test.png"), /10 MiB/);
});

test("does not return failed uploads or unexpected URLs as images", async () => {
  await assert.rejects(
    uploadImage(
      { path: "test.png" },
      async () => new Response("", { status: 403 })
    ),
    /repository: HTTP 403/
  );
  for (const result of [
    new Response("", { status: 404 }),
    Response.json({ url: "https://example.com/image.png" }),
  ]) {
    let requests = 0;
    await assert.rejects(
      uploadImage({ path: "test.png" }, async () =>
        ++requests === 1 ? Response.json({ id: 42 }) : result
      ),
      /HTTP 404|unexpected attachment URL/
    );
  }
});

test("uploads videos with their media type and rejects mismatched extensions", async () => {
  for (const [extension, contentType, bytes] of [
    ["webm", "video/webm", Buffer.from("1a45dfa34282847765626d", "hex")],
  ] as const) {
    writeFileSync(join(dir, "image.png"), bytes);
    let requests = 0;
    await uploadImage(
      { path: `tmp/recording.${extension}` },
      async (input, options) => {
        if (++requests === 1) {
          return Response.json({ id: 42 });
        }
        assert.equal(
          new URL(String(input)).searchParams.get("content_type"),
          contentType
        );
        assert.deepEqual(options!.body, new Uint8Array(bytes));
        return Response.json({ url });
      }
    );
    assert.throws(() => readImage("tmp/renamed.png"), /do not match/);
    writeFileSync(join(dir, "image.png"), png);
    assert.throws(() => readImage(`tmp/fake.${extension}`), /do not match/);
  }
});
