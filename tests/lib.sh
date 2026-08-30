#!/usr/bin/env bash
#
# lib.sh — shared helpers for the applePI integration tests.
#
# Each test boots its OWN isolated city: a git clone of this repository in
# tests/work/, so the developer's running city and rigs are never touched.
# scratch-proj is used as the Phase 0 development fixture rig, bound to a
# temporary git project created on the spot.
#
# Set GC_TEST_KEEP=1 to keep the work directory on failure (for debugging).

set -euo pipefail

# shellcheck disable=SC2034
CITY_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_ROOT="${CITY_REPO}/tests/work"
WORK_DIR=""
CITY_DIR=""
RIG_DIR=""

step() { printf '\n=== %s ===\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

# wait_for <timeout_secs> <description> <command...>
wait_for() {
    local timeout="$1" desc="$2"
    shift 2
    local waited=0
    while [ "${waited}" -lt "${timeout}" ]; do
        if "$@" >/dev/null 2>&1; then
            echo "ok: ${desc}"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    fail "timed out after ${timeout}s: ${desc}"
}

gc_test_init() {
    local prefix="$1"
    mkdir -p "${WORK_ROOT}"
    WORK_DIR="$(mktemp -d "${WORK_ROOT}/${prefix}-XXXXXX")"
    CITY_DIR="${WORK_DIR}/city"
    RIG_DIR="${WORK_DIR}/rig"
}

gc_test_cleanup() {
    set +e
    if [ -n "${CITY_DIR:-}" ] && [ -d "${CITY_DIR}/.gc" ]; then
        (cd "${CITY_DIR}" && gc stop >/dev/null 2>&1)
        (cd "${CITY_DIR}" && gc unregister >/dev/null 2>&1)
    fi
    if [ -n "${WORK_DIR:-}" ]; then
        if [ "${GC_TEST_KEEP:-0}" = "1" ]; then
            echo "kept work dir: ${WORK_DIR}"
        else
            rm -rf "${WORK_DIR}"
        fi
    fi
}
trap gc_test_cleanup EXIT INT TERM

gc_test_prereqs() {
    gc version | grep -q "^1.4.1$" || fail "gc is not v1.4.1: $(gc version)"
    pi --version >/dev/null || fail "pi not found"
    bd version >/dev/null || fail "bd not found"
    dolt version >/dev/null || fail "dolt not found"
    tmux -V >/dev/null || fail "tmux not found"
    git --version >/dev/null || fail "git not found"
}

gc_test_boot() {
    step "fresh clone of applePI"
    git clone -q "${CITY_REPO}" "${CITY_DIR}"
    [ -f "${CITY_DIR}/city.toml" ] || fail "clone missing city.toml"
    [ -f "${CITY_DIR}/pack.toml" ] || fail "clone missing pack.toml"
    [ -f "${CITY_DIR}/agents/worker/agent.toml" ] || fail "clone missing worker agent"

    step "bootstrap city (canonical v1.4.1 structure preserved)"
    (
        cd "${CITY_DIR}"
        gc init --file city.toml --preserve-existing --skip-provider-readiness --no-start --yes . >/dev/null
        gc import install >/dev/null
        gc import check >/dev/null
    ) || fail "city bootstrap failed"

    step "create temporary rig project"
    mkdir -p "${RIG_DIR}"
    git -C "${RIG_DIR}" init -q -b main 2>/dev/null || git -C "${RIG_DIR}" init -q
    git -C "${RIG_DIR}" commit -q --allow-empty -m init
    (
        cd "${CITY_DIR}"
        gc rig add "${RIG_DIR}" --name scratch-proj >/dev/null
    ) || fail "rig registration failed"
    # Harness runtime state (beads store, dolt, pi extensions) is
    # machine-local; untrack and ignore it in the fixture rig so the tree
    # stays clean for worker commits and runtime bead updates.
    git -C "${RIG_DIR}" rm -r --cached .beads >/dev/null 2>&1 || true
    cat >"${RIG_DIR}/.gitignore" <<'EOF'
# Gas City / harness runtime state
.gc/
.beads/
.pi/
.dolt/
.dolt-backup/
EOF
    git -C "${RIG_DIR}" add .gitignore
    git -C "${RIG_DIR}" commit -q -m "gitignore harness runtime state"

    step "start city, wait for Executive (always-on named session)"
    (
        cd "${CITY_DIR}"
        gc start >/dev/null 2>&1 || true
        wait_for 120 "executive session exists" bash -c "gc session list | grep -q executive"
    ) || fail "executive did not come up"
}

gc_test_new_manager() {
    local alias="$1"
    (
        cd "${CITY_DIR}"
        gc session new scratch-proj/manager --alias "${alias}" --no-attach >/dev/null
        wait_for 60 "${alias} session exists" bash -c "gc session list | grep -q ${alias}"
    ) || fail "${alias} creation failed"
}

gc_test_sling() {
    local title="$1" desc="$2"
    local bead_id
    (
        cd "${RIG_DIR}"
        bead_id="$(gc sling scratch-proj/worker "${desc}" --title "${title}" --json 2>/dev/null | jq -r '.bead_id // .id // empty' 2>/dev/null || true)"
        if [ -z "${bead_id:-}" ]; then
            bead_id="$(gc bd list --json 2>/dev/null | jq -r ".[] | select(.title | startswith(\"${title}\")) | .id" | head -1 || true)"
        fi
        [ -n "${bead_id:-}" ] || fail "could not create/rout task bead"
        printf '%s' "${bead_id}"
    ) || fail "task routing failed"
}

gc_test_bead() { # gc_test_bead <bead_id> <jq-expr>
    local bead_id="$1" expr="$2"
    (cd "${RIG_DIR}" && gc bd show "${bead_id}" --json 2>/dev/null | jq -r ".[0] | ${expr}")
}

gc_test_worker_in_rig() { # waits for a worker session bound to the rig
    (
        cd "${CITY_DIR}"
        wait_for 600 "worker session bound to rig" bash -c "gc session list | awk -v r=\"${RIG_DIR}\" '\$2 == \"scratch-proj/worker\" && \$7 == r {found=1} END {exit !found}'"
    )
}

gc_test_manager_reviewed() { # true once the manager transcript engages with a task
    local bead_id="$1"
    (cd "${CITY_DIR}" && gc session peek manager-test 2>/dev/null | grep -q "${bead_id}")
}