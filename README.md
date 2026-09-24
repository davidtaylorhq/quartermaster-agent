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
| `environments` | Alternative path to the development environment file |
| `trusted-associations` | Who may instruct the bot |
| `agent-timeout` | Agent time limit; default `10m` |

`provider-env` accepts multiple `NAME=value` lines. For a Claude subscription, use `provider: claude-bin` with `CLAUDE_CODE_OAUTH_TOKEN` instead of the API key above.

To use a GitHub App identity and let agent pushes trigger CI, also pass `app-id` and `app-private-key` under `secrets:`. Install the app on the repository with write access to contents, issues, and pull requests. Otherwise the bot uses `GITHUB_TOKEN` and replies as `github-actions[bot]`.

See the [workflow definition](.github/workflows/agent.yml) for all inputs and defaults.

## Architecture

- **Actions runner:** Holds GitHub credentials, controls access through an SSH gate, and publishes the agent's replies. Git fetches use a read-only forwarder; pushes go through a relay restricted to the permitted PR branch.
- **Agent container:** Runs term-llm with model credentials, read-only configuration, and a writable output directory. It has no checkout mount or Docker socket.
- **Workspace container:** Holds the checkout and exposes file/search tools over MCP/HTTP. The agent's `workspace_shell` wrapper runs commands here through SSH, with a ten-minute deadline.
- **Development containers:** Start on demand for tests and other runtime-dependent commands. They share the checkout and are reached through the workspace's `dev` wrapper and SSH gate.
- **GitHub MCP container:** Provides read-only GitHub API tools to the agent over SSH/stdio.

Workspace and development containers receive no model or GitHub credentials. Containers have outbound network access.
