# Workflow Agent

Mention a bot on a GitHub issue or pull request to ask questions, review code, or make changes. Powered by [term-llm](https://github.com/samsaffron/term-llm), using your model credentials and GitHub Actions.

## Get started

Add a model credential as a repository secret, then save this as `.github/workflows/agent.yml` on your **default branch**:

```yaml
name: Agent
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
      actions: read
      checks: read
      statuses: read
    with:
      mention: '@mybot'
      provider: anthropic
    secrets:
      provider-env: |
        ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
```

Comment `@mybot review this PR` or `@mybot fix this and run the tests`. The bot posts progress and a reply. Follow-ups within 60 seconds reuse the session.

By default, only `OWNER`, `MEMBER`, and `COLLABORATOR` comments can instruct it. These are GitHub associations, not write permissions; set `trusted-associations: OWNER` to restrict access to the owner. Use a fresh Linux runner with Docker; the default is `ubuntu-latest`.

## Run tests and linters

For language runtimes and services, add `.github/workflow-agent/environments.yml` on your default branch:

```yaml
environments:
  - name: node
    description: Node.js tests and linting
    image: node:22-bookworm
    cmd: sleep infinity
    user: node
    mount: /src
    setup: npm ci
```

The agent runs commands such as `dev node npm test`. Each environment starts on demand, shares the checkout, and runs `setup` once. Images need Bash and a command that stays running. Without this file, the agent still has file tools, Git, and a basic shell.

## Configure

Pass these under the caller's `with:`:

| Input | Purpose |
| --- | --- |
| `mention` | Required trigger, including `@` |
| `provider` | term-llm provider or `provider:model`; omit for automatic selection |
| `term-llm-config` | Optional config file, read from your default branch |
| `allowed-branches` | Additional push destinations: one full branch-name JavaScript regex per line |
| `task` | Task authorized by a calling workflow, executed once without mention checks |
| `instructions` | Optional Markdown file appended to the system prompt, read from your default branch |
| `environments` | Alternative path to the development environment file |
| `trusted-associations` | Who may instruct the bot |
| `agent-timeout` | Agent time limit; default `10m` |

Set `instructions: .github/workflow-agent/instructions.md` for bot-specific guidance such as tone and review priorities. The file supplements the built-in prompt; it does not change tools or publishing. An explicitly configured file must exist. Repository `AGENTS.md` files and skills are still read from the working checkout.

The original same-repository PR branch is writable. To permit additional branches, set `allowed-branches`, for example `backport/[0-9]+\.[0-9]+/${{ github.event.issue.number }}`. Patterns match the whole name; the default branch, tags and deletions are blocked. Pushes reject changes made to the destination since startup. The `open_pull_request` tool opens a PR from an allowed head branch to an existing base branch, or returns the existing open PR. It cannot merge.

A follow-on job can call this workflow with `task` to handle the result of earlier automation. The caller is responsible for authorization. Task runs use the original `issue_comment` event for repository/thread context, bypass mention discovery and commenter checks, and do not claim reactions or wait for follow-ups. Include a link to any detailed result comment in the task; thread excerpts are truncated.

`provider-env` accepts multiple `NAME=value` lines. For a Claude subscription, use `provider: claude-bin` with `CLAUDE_CODE_OAUTH_TOKEN` instead of the API key above.

To use a GitHub App identity and let agent pushes trigger CI, also pass `app-id` and `app-private-key` under `secrets:`. Install the app on the repository with write access to contents, issues, and pull requests, plus read access to Actions, checks, and commit statuses. Each run's token is restricted to the calling repository and those permissions; the app's private key itself remains app-wide. Otherwise the bot uses `GITHUB_TOKEN` and replies as `github-actions[bot]`.

The GitHub tools can read CI results and Actions logs. Existing callers must include the read permissions shown above; existing app installations must approve the added permissions.

See the [workflow definition](.github/workflows/agent.yml) for all inputs and defaults.

## Architecture

- **Actions runner:** Holds all credentials and orchestrates containers. Runs brokers for Git operations and PR creation, and an SSH -> `docker exec` broker for development-container commands.

- **Agent container:** Runs term-llm with model credentials. Repository file tools and shell commands operate in the workspace container; workflow-specific tools run locally.

- **Workspace container:** Holds the project code and exposes file, search, and shell tools over MCP/HTTP (`term-llm serve mcp`).

- **Development containers:** Can be started on-demand by the agent. They all share the project code with the workspace container via a volume mount. Commands are run through the SSH -> `docker exec` broker.

- **GitHub MCP container:** Provides read-only GitHub API tools to the agent over SSH/stdio.

Workspace and development containers receive no model or GitHub credentials.

Containers have unrestricted outbound network access.
