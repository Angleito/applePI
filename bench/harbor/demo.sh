#!/usr/bin/env bash
# Harbor oracle demo — pinned v0.22.0, terminal-bench@2.0, exactly 2 tasks.
# Oracle agent (gold patch + tests), 1 attempt, concurrency 1, Harbor-native
# Docker task containers. No LLM, no auth, no token cost.
set -euo pipefail

HARBOR_VERSION="0.22.0"
DATASET="terminal-bench@2.0"
TASK_IDS=("overfull-hbox" "filter-js-from-html")
JOBS_DIR="$HOME/.cache/harbor/jobs"

# Assert the newest job under $1 (default $JOBS_DIR) ran exactly the two
# pinned tasks, each with reward 1.0. Harbor v0.22.0 proceeds silently when
# only SOME requested task filters match, so the job result is the proof.
assert_job_results() {
  local jobs_dir="${1:-$JOBS_DIR}" job_dir result actual expected
  job_dir="$(ls -1t "$jobs_dir" 2>/dev/null | head -1 || true)"
  if [ -z "${job_dir:-}" ]; then
    echo "FAIL: no job directory found under $jobs_dir" >&2
    return 1
  fi
  result="$jobs_dir/$job_dir/result.json"
  if [ ! -f "$result" ]; then
    echo "FAIL: $result missing" >&2
    return 1
  fi
  actual="$(jq -r '[.stats.evals[] | .reward_stats.reward | to_entries[] | .key as $r | .value[] | (. | split("__")[0]) + "=" + $r] | sort | join(" ")' "$result")"
  expected="$(printf '%s=1.0\n%s=1.0' "${TASK_IDS[0]}" "${TASK_IDS[1]}" | sort | paste -sd ' ' -)"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: expected exactly '${TASK_IDS[0]}=1.0 ${TASK_IDS[1]}=1.0', found: ${actual:-<none>}" >&2
    return 1
  fi
}

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

# 3. Run the oracle on exactly the two hardcoded task IDs, then prove the
#    job really contained both tasks and both passed.
set +e
harbor run \
  -d "$DATASET" \
  -a oracle \
  -i "${TASK_IDS[0]}" -i "${TASK_IDS[1]}" \
  -k 1 -n 1 \
  -o "$JOBS_DIR" \
  -y
run_status=$?
set -e
assert_job_results
[ "$run_status" -eq 0 ] || exit "$run_status"
echo "PASS: oracle ran exactly ${TASK_IDS[0]} and ${TASK_IDS[1]}, both reward 1.0"
