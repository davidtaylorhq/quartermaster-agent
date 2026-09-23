# Quartermaster

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
    uses: davidtaylorhq/quartermaster-agent/.github/workflows/quartermaster.yml@main
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
| `bot-login` | `github-actions[bot]` | Login the agent's comments appear under |
| `provider` | unset | Passed to term-llm as `--provider` |
| `term-llm-config` | unset | Path to a term-llm configuration of your own |
| `environments` | `.github/quartermaster/environments.yml` | What the agent may run commands in |
| `trusted-associations` | `OWNER,MEMBER,COLLABORATOR` | Who may instruct the agent |
| `followup-window` | `60` | Seconds the sandbox is held open for a follow-up |
| `max-comment-age-hours` | `1` | Older mentions are left alone |
| `max-turns` | `60` | |
| `agent-timeout` | `10m` | |
| `term-llm-version` | pinned | |
| `runs-on` | `ubuntu-latest` | |
| `timeout-minutes` | `45` | |

## Choosing a model

The agent runs [term-llm](https://github.com/samsaffron/term-llm), so it reaches any model term-llm does, and nothing here knows the name of a single provider.

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

They do reach term-llm's own environment, because a provider that shells out reads them from there. So two things take them back out again:

- **Every shell command the agent runs is stripped of them.** term-llm starts each one with `$SHELL`, which is a shell of ours that drops those names first.
- **Anything the agent publishes is redacted.** A reply is the one thing it writes that leaves the sandbox, and log masking does not reach a pull request comment.

Everything named in `provider-env` is redacted, not only the secret-looking ones, so avoid passing values you would want quoted back to you.

What remains is that the agent's own process holds them, and there is no egress filtering, so a determined prompt injection could still send them somewhere. Removing them from the container entirely needs a proxy on the runner, which is not built yet.

## Running tests and linters

The sandbox holds git and little else. Anything needing a language runtime or a database runs in a container you describe, in `.github/quartermaster/environments.yml`:

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

`mount` is where the checkout appears, already holding the agent's edits, and commands run there. `image`, `entrypoint` and `cmd` mean what Docker means by them; omit either of the last two for the image's own.

`setup` runs once, as `user`, when the container is created, and may assume a clean slate. An environment that stops is not started again, so nothing ever runs it twice. The image needs `bash`.

Write the commands here rather than calling a script in your repository. This file comes from your default branch, but the checkout it runs against is the pull request's, and a branch opened before you added that script does not have it. Its commands should read the work tree — installing what the pull request's lockfile says, not your default branch's — but what those commands *are* should not depend on the branch being worked on. Anything too long for this belongs in the image.

A failed `setup` is reported to the agent and the environment is still usable, because a half-prepared environment the agent knows about is more use than none. Expect to see it work round the gap, and say that it did.

Each environment starts only when the agent first asks for it, and a cold start costs a couple of minutes, so a project with several never pays for the ones a run did not use.

Two things are ours and not negotiable: `docker run` and its flags, so no project can open the sandbox by mounting the docker socket; and reconciling `user` to uid 1000, because that is what the sandbox writes the checkout as.

**The file is read from your default branch, never from the pull request.** It decides what runs on the runner, so a pull request must not be able to choose it.

With no such file the agent reads, writes and answers, and the gate refuses to run anything.

## How it works

The agent runs in a container with no credentials in it. Everything it needs is a service on the runner, reached through an SSH gate that accepts four verbs and nothing else.

- **Pushing.** The container's `origin` is a bare repository on the runner. A hook there refuses every ref but the pull request's own branch, and a second hook forwards what it accepts to GitHub using a token the container never sees. `GITHUB_TOKEN` permissions cannot be scoped to a ref, so this is the only way to say "this branch and no other".
- **Reading GitHub.** A read-only GitHub MCP server, started on the runner, reached through the gate.
- **Answering.** The agent calls `finish` once. The runner posts the reply. Nothing the agent does reaches GitHub on its own.

Who may instruct it is settled by GitHub's author association, so a comment from a passer-by is context, never an instruction.

## What this does not do yet

- **No egress filtering.** The container can reach the whole internet. A prompt injection in a pull request cannot steal a GitHub token, because there isn't one, but it can talk to anything.
- **The model credential is inside the container.** The GitHub token is not, but the key that pays for inference is. It is stripped from the agent's shell commands, which is not the same as it not being there.
- **The agent prompt still names Discourse.** Letting a project add its own instructions is the next change.
