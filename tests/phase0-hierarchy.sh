#!/usr/bin/env bash
#
# phase0-hierarchy.sh — applePI Phase 0 hierarchy integration test.
#
# Reproduces, from a fresh clone, the verified workflow:
#
#   Human → Executive → manager-test → Worker → rig commit → reports up
#
# The test boots its OWN isolated city (a git clone of this repository in
# tests/work/) so it never touches the developer's running city or rigs.
# scratch-proj is used as the Phase 0 development fixture rig; the test
# binds it to a temporary git project created on the spot.
#
# Requires: gc v1.4.1, pi (authenticated), bd, dolt, tmux, git, jq.
# Runtime: several minutes (LLM-driven steps are polled, not assumed).
#
# Usage: tests/phase0-hierarchy.sh

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

EXPECTED_TEXT="applePI Phase 0 worker test"
TASK_TITLE="Phase 0 worker test"

gc_test_init "phase0"
gc_test_prereqs

step "1/7 prerequisites passed"

gc_test_boot

step "create manager-test (rig-scoped manager template)"
gc_test_new_manager "manager-test"
(
    cd "${CITY_DIR}"
    gc session submit manager-test "You own a trivial Phase 0 test workstream. Scope: the scratch-proj repository. Your only deliverable: when a Worker task arrives, review it and report a short compressed summary to executive. Do not implement code yourself." --intent follow_up >/dev/null 2>&1 || true
)

step "route Worker task (durable bead + sling)"
TASK_DESC="Create PHASE0_TEST.txt containing exactly: ${EXPECTED_TEXT}

REPORT_TO:
manager-test

OBJECTIVE:
Create the Phase 0 validation file.

ACCEPTANCE:
PHASE0_TEST.txt exists.
Contents exactly match requested text.
Commit the change.

CONSTRAINTS:
Modify no other files.

DEPENDENCIES:
None."
BEAD_ID="$(gc_test_sling "${TASK_TITLE}" "${TASK_DESC}")"
echo "bead: ${BEAD_ID}"

step "Worker materializes and claims (bd-backed hook claim)"
gc_test_worker_in_rig

step "Worker executes in the rig (file + commit)"
(
    cd "${RIG_DIR}"
    wait_for 300 "PHASE0_TEST.txt exists" test -f PHASE0_TEST.txt
    [ "$(cat PHASE0_TEST.txt)" = "${EXPECTED_TEXT}" ] || fail "PHASE0_TEST.txt content mismatch"
    wait_for 60 "task commit exists" bash -c "git log --oneline | grep -q 'TASK ${BEAD_ID}'"
    echo "commit: $(git log -1 --oneline)"
    git status --porcelain | grep -q . && fail "rig working tree not clean" || true
) || fail "worker did not complete the task in the rig"

step "bead terminal state (closed+shipped, or open with complete work record)"
(
    cd "${RIG_DIR}"
    # Terminal contract (observed v1.4.1 behavior): the Worker (or the
    # Manager on ACCEPT) closes the bead with gc.work_outcome=shipped.
    # Some models leave the bead in_progress for review; the durable work
    # record + Manager engagement are then the asserted contract.
    wait_for 720 "bead closed or manager engaged with task" bash -c "
        cd '${RIG_DIR}' && gc bd show ${BEAD_ID} --json 2>/dev/null | jq -e '.[0].status == \"closed\"' 2>/dev/null ||
        ( cd \"${CITY_DIR}\" && gc session peek manager-test 2>/dev/null | grep -q \"${BEAD_ID}\" )"
    gc_test_bead "${BEAD_ID}" '.metadata["gc.work_dir"]' | grep -q "${RIG_DIR}" \
        || fail "gc.work_dir mismatch — worker did NOT operate in the rig"
    STATE="$(gc_test_bead "${BEAD_ID}" '.status')"
    OUTCOME="$(gc_test_bead "${BEAD_ID}" '.metadata["gc.work_outcome"] // "unset"')"
    echo "bead ${BEAD_ID} status=${STATE} work_outcome=${OUTCOME} work_dir=$(gc_test_bead "${BEAD_ID}" '.metadata["gc.work_dir"]')"
    if [ "${STATE}" = "closed" ]; then
        [ "${OUTCOME}" = "shipped" ] || fail "closed but work_outcome=${OUTCOME}, expected shipped"
        echo "ok: bead closed with shipped outcome"
    else
        echo "note: bead left in_progress awaiting review (known model-variant behavior); durable work record verified"
    fi
) || fail "bead state invalid"

step "Worker → Manager report received"
(
    cd "${CITY_DIR}"
    wait_for 480 "manager transcript shows worker report" bash -c "gc session peek manager-test 2>/dev/null | grep -q PHASE0_TEST"
) || fail "manager never received the worker report"

step "Manager → Executive report issued"
(
    cd "${CITY_DIR}"
    wait_for 480 "manager submitted report to executive" bash -c "gc session peek manager-test 2>/dev/null | grep -qiE 'reported to executive|submit executive|queued follow-up|report.*executive|executive.*report'"
) || fail "manager never reported to executive"

step "PASS — phase 0 hierarchy verified end-to-end"
echo "  bead:     ${BEAD_ID}"
echo "  rig:      ${RIG_DIR}"
echo "  commit:   $(git -C "${RIG_DIR}" log -1 --oneline)"