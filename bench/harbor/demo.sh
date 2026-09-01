#!/usr/bin/env bash
# Harbor oracle demo — pinned v0.22.0, terminal-bench@2.0, exactly 2 tasks.
# Oracle agent (gold patch + tests), 1 attempt, concurrency 1, Harbor-native
# Docker task containers. No LLM, no auth, no token cost.
set -euo pipefail

HARBOR_VERSION="0.22.0"
DATASET="terminal-bench@2.0"
TASK_IDS=("overfull-hbox" "filter-js-from-html")
JOBS_DIR="$HOME/.cache/harbor/jobs"

# 1. Pin check — the demo is only valid against the pinned Harbor.
if [ "$(harbor --version)" != "$HARBOR_VERSION" ]; then
  echo "FAIL: harbor $(harbor --version), expected $HARBOR_VERSION" >&2
  exit 1
fi

# 2. Download the dataset if absent (cache mode). Retry once on failure.
if ! ls "$HOME/.cache/harbor/tasks/"*/"${TASK_IDS[0]}" >/dev/null 2>&1; then
  harbor download --cache "$DATASET" \
    || harbor download --cache "$DATASET"
fi

# 3. Run the oracle on exactly the two hardcoded task IDs.
harbor run \
  -d "$DATASET" \
  -a oracle \
  -i "${TASK_IDS[0]}" -i "${TASK_IDS[1]}" \
  -k 1 -n 1 \
  -o "$JOBS_DIR" \
  -y
