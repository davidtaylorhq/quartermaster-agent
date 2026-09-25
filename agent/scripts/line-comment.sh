#!/usr/bin/env bash
# Hold one line comment until the run finishes. Nothing is posted from here:
# the agent container has no GitHub credential.
set -euo pipefail
cat >> "${OUTPUT_DIR:?}/findings.jsonl"
printf '\n' >> "${OUTPUT_DIR:?}/findings.jsonl"
echo "Noted. It is posted as part of the review when you finish."
