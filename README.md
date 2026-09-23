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
    # Keep this condition. Without it every comment starts a runner.
    if: contains(github.event.comment.body, '@acmebot')
    uses: davidtaylorhq/quartermaster-agent/.github/workflows/quartermaster.yml@main
    permissions:
      contents: write
      pull-requests: write
      issues: write
    with:
      mention: '@acmebot'
    secrets:
      anthropic-oauth-token: ${{ secrets.ANTHROPIC_OAUTH_TOKEN }}
```

## Settings

| Input | Default | |
|---|---|---|
| `mention` | *required* | What people type, including the `@` |
| `bot-name` | the mention without its `@` | Name on the agent's commits |
| `bot-login` | `github-actions[bot]` | Login the agent's comments appear under |
| `environments` | `.github/quartermaster/environments.yml` | What the agent may run commands in |
| `trusted-associations` | `OWNER,MEMBER,COLLABORATOR` | Who may instruct the agent |
| `followup-window` | `60` | Seconds the sandbox is held open for a follow-up |
| `max-comment-age-hours` | `1` | Older mentions are left alone |
| `max-turns` | `60` | |
| `agent-timeout` | `10m` | |
| `term-llm-version` | pinned | |
| `runs-on` | `ubuntu-latest` | |
| `timeout-minutes` | `45` | |

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
    setup: bin/agent-setup   # once, on boot, inside, at the mount point

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
- **The model credential is inside the container.** The GitHub token is not, but the key that pays for inference is.
- **The agent prompt still names Discourse.** Letting a project add its own instructions is the next change.
- **One provider.** Claude, through `claude-bin`.
