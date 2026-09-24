# Workflow Agent

Multi-purpose agent for GitHub issues and pull requests. Connect any LLM, with your own keys.

Built on [term-llm](https://github.com/samsaffron/term-llm).

Mention it on an issue or a pull request and it does the work: answers questions, reviews a diff, writes a patch and pushes it. It runs in your own GitHub Actions, on your own credentials, and the agent itself holds no GitHub token and can push to exactly one branch.

## Use it

Add one workflow to your repository. Pick the name people will type; `@discoursebot`, `@acmebot`, whatever suits.

```yaml
name: Acmebot
on:
  issue_comment:
    types: [created]

jobs:
  respond:
    uses: davidtaylorhq/workflow-agent/.github/workflows/agent.yml@main
    permissions:
      contents: write
      pull-requests: write
      issues: write
    with:
      mention: '@acmebot'
    secrets:
      provider-env: |
        CLAUDE_CODE_OAUTH_TOKEN=${{ secrets.ANTHROPIC_OAUTH_TOKEN }}
```

## Settings

| Input | Default | |
|---|---|---|
| `mention` | *required* | What people type, including the `@` |
| `bot-name` | the mention without its `@` | Name on the agent's commits |
| `bot-login` | `github-actions[bot]` | Login the agent's comments appear under. A GitHub App settles this itself |
| `provider` | unset | Passed to term-llm as `--provider` |
| `term-llm-config` | unset | Path to a term-llm configuration of your own |
| `environments` | `.github/workflow-agent/environments.yml` | What the agent may run commands in |
| `trusted-associations` | `OWNER,MEMBER,COLLABORATOR` | Who may instruct the agent |
| `followup-window` | `60` | Seconds the sandbox is held open for a follow-up |
| `max-comment-age-hours` | `1` | Older mentions are left alone |
| `max-turns` | `60` | |
| `agent-timeout` | `10m` | |
| `runs-on` | `ubuntu-latest` | |
| `timeout-minutes` | `45` | |

## Giving it a name of its own

Out of the box the agent speaks as `github-actions[bot]`, which is Actions' own
identity and cannot be renamed. Pass a GitHub App instead and its comments
carry the app's name and avatar:

```yaml
secrets:
  app-id: ${{ secrets.WORKFLOW_AGENT_APP_ID }}
  app-private-key: ${{ secrets.WORKFLOW_AGENT_APP_KEY }}
```

The app needs write on issues, pull requests and contents, and it has to be
installed on the repository. `bot-login` then settles itself from the app.

This is worth more than a name. A push made with `GITHUB_TOKEN` never starts a
workflow, which GitHub does to stop runs triggering themselves, so the agent's
commits arrive on a pull request with no checks against them. An app's push
starts them.

The app is settled before anything else happens. The eyes the agent puts on a
comment are what claim it, and every run has to react as the same account for
that to work.

## Choosing a model

The agent runs [term-llm](https://github.com/samsaffron/term-llm), so it reaches any model term-llm does. Nothing here names a provider.

Credentials arrive as one secret you compose from your own:

```yaml
with:
  provider: openai
secrets:
  provider-env: |
    OPENAI_API_KEY=${{ secrets.MY_OPENAI_KEY }}
```

term-llm resolves those by its usual conventions. Leave `provider` unset and it chooses from whatever credentials it finds; set it to a name, or to `name:model`, to be explicit.

For a self-hosted or OpenAI-compatible endpoint, point `term-llm-config` at a term-llm configuration of your own:

```yaml
default_provider: local
providers:
  local:
    type: openai-compatible
    url: https://llm.internal/v1/chat/completions
    model: qwen3-coder
    api_key: ${MY_LLM_KEY}
```

term-llm also reads `op://` for 1Password, `file://`, `srv://` and `$(...)` in any config value, so a multi-line credential can be passed base64-encoded and decoded there.

### Where the credentials go

They are masked before they reach a log, never written into the docker command line, and kept out of `$GITHUB_ENV`.

The model client runs in its own container with the provider credentials. It calls providers directly, including the Claude CLI for subscriptions. Provider URLs and TLS keep their normal behaviour.

Repository work happens in a separate sandbox. That container receives neither model nor GitHub credentials. It runs `term-llm serve mcp`, exposing only `read_file`, `write_file`, `edit_file`, `glob`, `grep`, and `shell`. The agent connects over Docker's private bridge using a per-run bearer token; the tool server has no published port.

The agent container has no repository mount or Docker socket. Its configuration and SSH gate key are mounted read-only. A separate writable output directory holds `finish.json` and `findings.jsonl`, which the runner reads directly. Conversation state stays inside the container. Both containers use the same runtime image, but have separate filesystems. Only the work sandbox mounts the checkout.

GitHub credentials stay on the runner. Neither container receives them; access still goes through the GitHub read service and push gate.

## Running tests and linters

The sandbox holds git and little else. Anything needing a language runtime or a database runs in a container you describe, in `.github/workflow-agent/environments.yml`:

```yaml
environments:
  - name: rails
    description: Ruby, the database and the Rails app. Specs, migrations, rubocop.
    image: discourse/discourse_dev:release
    cmd: /sbin/boot          # optional, as Docker means CMD
    user: discourse
    mount: /src
    setup: |                 # once, on boot, inside, at the mount point
      until pg_isready -q; do sleep 2; done
      bundle install --jobs "$(nproc)" --retry 3
      bin/rake db:create db:migrate

  - name: frontend
    description: Node and pnpm. Lint, prettier, ember tests.
    image: node:22-bookworm
    cmd: sleep infinity
    user: node
    mount: /src
    setup: pnpm install --frozen-lockfile
```

The agent names the one it wants:

```
dev rails bin/rspec spec/lib/text_sentinel_spec.rb
dev frontend pnpm lint
```

There are no shortcuts into an environment, so the agent always knows a command is leaving the sandbox, and the log says where it ran.

`description` is what the agent reads to choose between them, so write it for the agent.

`mount` is where the checkout appears, already holding the agent's edits, and commands run there. `image`, `entrypoint` and `cmd` mean what Docker means by them; omit either of the last two for the image's own. `cmd` may be a list or a string split on spaces.

The container has to stay up, so an image whose default command exits needs a `cmd` that does not.

`setup` runs once, as `user`, when the container is created, and may assume a clean slate. An environment that stops is not started again, so nothing ever runs it twice. The image needs `bash`. It runs under `-e -o pipefail`, so the first command that fails ends it.

Write the commands here rather than calling a script in your repository. This file comes from your default branch, but the checkout it runs against is the pull request's, and a branch opened before you added that script does not have it. Its commands should read the work tree — installing what the pull request's lockfile says, not your default branch's — but what those commands *are* should not depend on the branch being worked on. Anything too long for this belongs in the image.

Progress resumes even when preparation fails. If the configured user could not be established, later commands refuse to reuse the container.

A failed `setup` is reported to the agent and the environment is still usable, because a half-prepared environment the agent knows about is more use than none. Expect to see it work round the gap, and say that it did.

Each environment starts only when the agent first asks for it, and a cold start costs a couple of minutes, so a project with several never pays for the ones a run did not use.

Two things are ours and not negotiable: `docker run` and its flags, so no project can open the sandbox by mounting the docker socket; and reconciling `user` to uid 1000, because that is what the sandbox writes the checkout as.

**The file is read from your default branch, never from the pull request.** It decides what runs on the runner, so a pull request must not be able to choose it.

With no such file the agent can use the workspace shell, but no development environments are available.

## How it works

The model client and workspace tools run in separate containers, neither holding a GitHub credential. Everything it can ask the runner for goes through an SSH gate with a fixed list of commands, and anything else is refused:

| | said by |
|---|---|
| `dev <environment>` | the agent, to run a command somewhere with a runtime |
| `mcp` | term-llm, to reach the GitHub MCP server |
| `git-receive-pack` | git, when the agent runs `git push` |

The last is not a command the agent writes. It runs `git push` and git speaks the protocol; the gate's hooks decide what reaches the branch. Reads do not go through the gate at all: `origin` fetches from a forwarder on the runner that allows two paths, both of them `upload-pack`, and adds the credential the container has not got. The model credential is held only by the agent container; the work sandbox cannot read it.

- **Pushing.** The container pushes to a bare repository on the runner. A hook there refuses every ref but the pull request's own branch, and a second hook forwards what it accepts to GitHub using a token the container never sees. `GITHUB_TOKEN` permissions cannot be scoped to a ref, so this is the only way to say "this branch and no other".
- **Reading GitHub.** A read-only GitHub MCP server, started on the runner, reached through the gate.
- **Fetching.** The work tree arrives with the pull request's head and the commit it branched from, so a diff needs no network. `git fetch` reaches the rest through the forwarder, which serves this repository and nothing else.
- **Answering.** The agent calls `finish` once. The runner posts the reply. Nothing the agent does reaches GitHub on its own.

Who may instruct it is settled by GitHub's author association, so a comment from a passer-by is context, never an instruction.

Association is not permission. `MEMBER` means a member of the organisation and `COLLABORATOR` means someone invited to this repository, and neither says they can write to it. The agent pushes with its own token, so anyone listed here can reach the branch through it. Narrow `trusted-associations` to `OWNER` if that is not what you want.

## What this does not do yet

- **The sandbox image floats.** Scripts, prompt and assets come from the commit the workflow was called at, but the image is always `sandbox:latest`, so pinning a caller to a tag does not pin what it runs in.
- **The runner has to be a fresh one.** State goes in fixed places: one directory under `HOME`, fixed ports, fixed container names, and nothing is torn down at the end. A second run on the same self-hosted machine finds the first one's keys and containers.

- **No egress filtering.** The container can reach the whole internet. A prompt injection in a pull request cannot steal a GitHub token, because there isn't one, but it can talk to anything.
- **The agent container holds the model credential.** Repository tools run elsewhere, but there is no OS restriction on subprocesses inside the agent container. Its configuration, provider clients, and workflow-owned scripts must remain trusted.
- **Repository instructions are read through tools.** The agent is instructed to read `AGENTS.md` and relevant `SKILL.md` files in the work sandbox. Repository skills are not automatically registered in the agent container; their scripts can be run through the workspace shell.

## Developing this workflow

Run `npm test`, `npm run check`, and `npm run lint`. To include the MCP integration test, set `TERM_LLM_BINARY` to the term-llm binary matching `TERM_LLM_VERSION` in `sandbox/Dockerfile`. CI installs that version automatically. The test runs a real tool server and agent against a scripted model endpoint, without provider or GitHub credentials, and checks workspace operations, review findings, and session resume.

CI also builds the runtime and runs `test/docker-smoke` on a disposable Docker runner. It checks actual read-only configuration and writable output mounts, uid ownership, SSH gate authentication, MCP authentication, and service exit. The smoke test uses placeholder credentials and does not call a model or write to GitHub.
