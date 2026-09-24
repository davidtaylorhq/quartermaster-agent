#!/usr/bin/env bash
# Hold one line comment until the run finishes. Nothing is posted from here:
# the agent container has no GitHub credential.
set -euo pipefail
cat >> "${FINDINGS_FILE:-$HOME/findings.jsonl}"
printf '\n' >> "${FINDINGS_FILE:-$HOME/findings.jsonl}"
echo "Noted. It is posted as part of the review when you finish."
