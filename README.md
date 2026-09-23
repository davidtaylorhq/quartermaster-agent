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
| `dev` | unset | Path to your development environment script |
| `dev-shims` | unset | Commands the sandbox passes to it rather than failing on |
| `trusted-associations` | `OWNER,MEMBER,COLLABORATOR` | Who may instruct the agent |
| `followup-window` | `60` | Seconds the sandbox is held open for a follow-up |
| `max-comment-age-hours` | `1` | Older mentions are left alone |
| `max-turns` | `60` | |
| `agent-timeout` | `10m` | |
| `term-llm-version` | pinned | |
| `runs-on` | `ubuntu-latest` | |
| `timeout-minutes` | `45` | |

## Running tests and linters

The sandbox holds git and little else, so anything needing a language runtime or a database happens in a development environment your project supplies. Point `dev` at a script in your repository that answers two verbs:

```
dev up      start it, or return at once if it is already up
dev exec    exec a shell in it, reading the command on stdin
```

`up` may be called more than once and must be cheap when there is nothing to do. Its output goes to a log the runner follows, so write progress to stdout. `exec` must hand over to a shell, because the agent's command arrives on standard input.

`WORKTREE_VOLUME` names a docker volume holding the checkout, already containing the agent's edits. Mount it wherever your environment expects the source.

Name the commands you want redirected in `dev-shims`. A shimmed name reaches the development environment instead of failing in the sandbox, so shimming an interpreter catches every script that starts with it:

```yaml
with:
  dev: .github/quartermaster/dev
  dev-shims: ruby bundle pnpm node npx psql rake rails
```

**The script is read from your default branch, never from the pull request.** It runs on the runner with the job token in scope, so a pull request must not be able to choose what it says.

With no `dev` set, the agent reads, writes and answers, and the gate refuses to run anything.

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
