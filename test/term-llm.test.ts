import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const binary = process.env.TERM_LLM_BINARY;
const root = join(import.meta.dirname, "..");

// eslint-disable-next-line qunit/no-test-expect-argument -- node:test options
test(
  "the pinned term-llm works with read-only config and a separate output directory",
  { skip: !binary, timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "term-mcp-"));
    t.after(() => {
      configPermissions(true);
      rmSync(dir, { recursive: true, force: true });
    });
    const home = join(dir, "agent");
    const workspace = join(dir, "workspace");
    const serverHome = join(dir, "server");
    const outputDir = join(dir, "output");
    mkdirSync(outputDir);
    const config = join(home, ".config/term-llm");
    mkdirSync(config, { recursive: true });
    mkdirSync(workspace);
    mkdirSync(serverHome);
    cpSync(join(root, "agent"), join(config, "agents/workflow-agent"), {
      recursive: true,
    });
    // PR creation uses SSH; workspace tools use the real MCP server.
    const stubs = join(dir, "stubs");
    mkdirSync(stubs);
    writeFileSync(
      join(stubs, "ssh"),
      `#!/bin/bash
unset ANTHROPIC_API_KEY
if [ "$3" = open-pull-request ]; then
  cat > "${outputDir}/pr-request.json"
  echo '{"url":"https://github.com/test/repo/pull/2","created":true}'
  exit 0
fi
if [ "$3" = upload-image ]; then
  cat > "${outputDir}/image-request.json"
  echo '{"url":"https://github.com/user-attachments/assets/1234-abcd"}'
  exit 0
fi
exit 1
`,
      { mode: 0o755 }
    );
    const baseEnv = {
      PATH: `${stubs}:${process.env.PATH}`,
      LANG: "C.UTF-8",
    };

    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as { port: number }).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const url = `http://127.0.0.1:${port}/mcp`;
    const tools = spawn(
      binary!,
      [
        "serve",
        "mcp",
        "--tools",
        "read_file,write_file,edit_file,glob,grep,shell",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--token",
        "test-token",
        "--yolo",
      ],
      {
        cwd: workspace,
        env: { ...baseEnv, HOME: serverHome, SHELL: "/bin/bash" },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let serverLog = "";
    tools.stderr.on("data", (chunk) => {
      serverLog += chunk;
    });
    t.after(async () => {
      if (tools.exitCode === null) {
        tools.kill();
        await once(tools, "close");
      }
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (tools.exitCode !== null) {
        break;
      }
      try {
        const response = await fetch(url);
        if (response.status === 401) {
          ready = true;
          break;
        }
      } catch {
        /* The listener may not have started yet. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, serverLog);

    // Both names use the local server so this test needs no GitHub credentials.
    const remote = {
      type: "http",
      url,
      headers: { Authorization: "Bearer test-token" },
    };
    writeFileSync(
      join(config, "mcp.json"),
      JSON.stringify({ servers: { workspace: remote, github: remote } })
    );
    const actions: [string, Record<string, unknown>][] = [
      ["write_file", { path: "example.txt", content: "hello\n" }],
      ["read_file", { path: "example.txt" }],
      [
        "edit_file",
        { path: "example.txt", old_text: "hello", new_text: "goodbye" },
      ],
      ["glob", { pattern: "*.txt" }],
      ["grep", { pattern: "goodbye", path: "." }],
      [
        "shell",
        {
          command:
            'test -n "$BASH_VERSION" && test -z "$ANTHROPIC_API_KEY$GH_TOKEN" && cat example.txt',
        },
      ],
      [
        "line_comment",
        { path: "example.txt", line: 1, body: "A review finding" },
      ],
      [
        "open_pull_request",
        {
          head: "backport/2026.5/123",
          base: "release/2026.5",
          title: "Backport",
          body: "Details",
        },
      ],
      ["upload_image", { path: "/src/tmp/screenshot.png" }],
      ["finish", { reply: "Finished through MCP" }],
      ["read_file", { path: "example.txt" }],
      ["finish", { reply: "Follow-up through MCP" }],
    ];
    let next = 0;
    type Content = {
      type: string;
      is_error?: boolean;
      content?: { text?: string }[];
    };
    const requests: { messages: { content: Content[] | string }[] }[] = [];
    const failures: string[] = [];
    const upstream = createServer(async (req, res) => {
      try {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
        }
        const body = JSON.parse(raw);
        requests.push(body);
        const names: string[] = body.tools.map(
          (tool: { name: string }) => tool.name
        );
        const workspaceTools = [
          "edit_file",
          "glob",
          "grep",
          "read_file",
          "shell",
          "write_file",
        ];
        assert.deepEqual(
          names.filter((name) => name.startsWith("workspace__")).sort(),
          workspaceTools.map((name) => `workspace__${name}`)
        );
        assert.ok(
          workspaceTools.every((name) => !names.includes(name)),
          names.join(", ")
        );
        assert.ok(!names.includes("workspace_shell"));
        assert.ok(names.includes("open_pull_request"));
        assert.ok(names.includes("line_comment"));
        assert.ok(names.includes("upload_image"));
        assert.ok(!names.includes("shell"));
        const action = actions[next++];
        assert.ok(action, "unexpected model request");
        const [tool, input] = action;
        const name = [
          "read_file",
          "shell",
          "write_file",
          "edit_file",
          "glob",
          "grep",
        ].includes(tool)
          ? names.find((n) => n.includes("workspace") && n.endsWith(tool))
          : names.find((n) => n === tool);
        assert.ok(name, `${tool} missing: ${names.join(", ")}`);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const event = (type: string, data: Record<string, unknown>) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
          );
        event("message_start", {
          message: {
            id: `msg_${next}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-5",
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        event("content_block_start", {
          index: 0,
          content_block: {
            type: "tool_use",
            id: `call_${next}`,
            name,
            input: {},
          },
        });
        event("content_block_delta", {
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(input),
          },
        });
        event("content_block_stop", { index: 0 });
        event("message_delta", {
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 10 },
        });
        event("message_stop", {});
        res.end();
      } catch (error) {
        failures.push(String(error));
        res.writeHead(500).end(String(error));
      }
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    t.after(() => {
      upstream.closeAllConnections();
      upstream.close();
    });
    const apiPort = (upstream.address() as { port: number }).port;
    writeFileSync(
      join(config, "config.yaml"),
      `default_provider: anthropic\nproviders:\n  anthropic:\n    base_url: http://127.0.0.1:${apiPort}\n    model: claude-sonnet-4-5\n`
    );

    function configPermissions(writable: boolean, path = config) {
      chmodSync(path, writable ? 0o755 : 0o555);
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          configPermissions(writable, join(path, entry.name));
        } else {
          chmodSync(join(path, entry.name), writable ? 0o755 : 0o555);
        }
      }
    }
    configPermissions(false);

    for (const resume of [false, true]) {
      const child = spawn(
        binary!,
        [
          "ask",
          "--agent",
          "workflow-agent",
          "--session-db",
          join(home, "session.db"),
          ...(resume ? ["--resume"] : []),
          "--yolo",
          "--text",
          "--max-turns",
          "14",
          "--timeout",
          "20s",
          resume ? "Follow up" : "Work through the sandbox",
        ],
        {
          cwd: home,
          env: {
            ...baseEnv,
            HOME: home,
            OUTPUT_DIR: outputDir,
            ANTHROPIC_API_KEY: "model-secret",
          },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const [code] = await once(child, "close");
      assert.equal(code, 0, output + failures.join("\n"));
      assert.deepEqual(
        JSON.parse(readFileSync(join(outputDir, "finish.json"), "utf8")),
        { reply: resume ? "Follow-up through MCP" : "Finished through MCP" }
      );
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputDir, "pr-request.json"), "utf8")),
      {
        head: "backport/2026.5/123",
        base: "release/2026.5",
        title: "Backport",
        body: "Details",
      }
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(outputDir, "image-request.json"), "utf8")),
      { path: "/src/tmp/screenshot.png" }
    );
    assert.deepEqual(failures, []);
    assert.equal(next, actions.length);
    assert.equal(
      readFileSync(join(workspace, "example.txt"), "utf8"),
      "goodbye\n"
    );
    assert.throws(() => readFileSync(join(home, "example.txt")), /ENOENT/);
    const findings = readFileSync(
      join(outputDir, "findings.jsonl"),
      "utf8"
    ).trim();
    assert.deepEqual(JSON.parse(findings), {
      path: "example.txt",
      line: 1,
      body: "A review finding",
    });
    const results = requests
      .flatMap((request) => request.messages)
      .flatMap((message) =>
        Array.isArray(message.content) ? message.content : []
      )
      .filter((content) => content.type === "tool_result");
    assert.ok(results.length > 0);
    assert.ok(
      results.every((result) => !result.is_error),
      JSON.stringify(results)
    );
    const output = results
      .flatMap((result) => result.content ?? [])
      .map((content) => content.text)
      .join("\n");
    assert.match(output, /exit_code: 0/);
    assert.doesNotMatch(
      output,
      /model-secret|PERMISSION_DENIED|EXECUTION_FAILED/
    );
  }
);
