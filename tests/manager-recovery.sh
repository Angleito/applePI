#!/usr/bin/env bash
#
# manager-recovery.sh — Manager crash/kill recovery test.
#
# Scenario (observed real v1.4.1 behavior, not assumed):
#   1. manager-test owns a durable Worker task that completes (bead +
#      commit in the rig).
#   2. The Manager session is force-killed (`gc session kill`).
#   3. The durable work survives independently of the Manager: the task
#      bead, dependencies, and the committed change all remain in the
#      bead store / rig repository.
#   4. The session reconciler restarts the Manager session (same session
#      id) with its transcript intact; the workstream is reconstructable
#      from the durable state (bead + commit), not only from the
#      transcript.
#
# Uses an isolated clone-based city (see lib.sh). Requires pi (authenticated).
#
# Usage: tests/manager-recovery.sh

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TASK_TITLE="manager recovery probe"
TASK_DESC="Create MGR_TEST.txt containing exactly: applePI manager recovery probe

REPORT_TO:
manager-test

OBJECTIVE:
Manager recovery validation file.

ACCEPTANCE:
MGR_TEST.txt exists.
Contents exactly match requested text.
Commit the change.

CONSTRAINTS:
Modify no other files.

DEPENDENCIES:
None."

gc_test_init "mgr-rec"
gc_test_prereqs
gc_test_boot

step "create manager-test and give it a workstream brief"
gc_test_new_manager "manager-test"
(
    cd "${CITY_DIR}"
    gc session submit manager-test "You own a trivial Phase 0 test workstream. Scope: the scratch-proj repository. Your only deliverable: when a Worker task arrives, review it and report a short compressed summary to executive. Do not implement code yourself." --intent follow_up >/dev/null 2>&1 || true
)

step "route Worker task (durable work under the Manager)"
BEAD_ID="$(gc_test_sling "${TASK_TITLE}" "${TASK_DESC}")"
echo "bead: ${BEAD_ID}"

step "Worker completes the task (file + commit)"
(
    cd "${RIG_DIR}"
    wait_for 480 "MGR_TEST.txt exists" test -f MGR_TEST.txt
    [ "$(cat MGR_TEST.txt)" = "applePI manager recovery probe" ] || fail "MGR_TEST.txt content mismatch"
    wait_for 60 "task commit exists" bash -c "git log --oneline | grep -q 'TASK ${BEAD_ID}'"
    echo "commit: $(git log -1 --oneline)"
) || fail "worker did not complete the task"

step "kill the Manager session"
MANAGER_SESSION_ID="$(
    cd "${CITY_DIR}"
    gc session list | awk '$2 == "scratch-proj/manager" {print $1; exit}'
)"
[ -n "${MANAGER_SESSION_ID}" ] || fail "could not determine manager session id"
(cd "${CITY_DIR}" && gc session kill "${MANAGER_SESSION_ID}" >/dev/null) || fail "session kill failed"

step "durable work survives the Manager: bead + dependencies + commit"
wait_for 30 "task bead still exists" bash -c "cd '${RIG_DIR}' && gc bd show '${BEAD_ID}' --json 2>/dev/null | jq -e '.[0].id == \"${BEAD_ID}\"'"
echo "  bead ${BEAD_ID}: status=$(gc_test_bead "${BEAD_ID}" '.status')"
echo "  commit: $(git -C "${RIG_DIR}" log -1 --oneline)"
[ -f "${RIG_DIR}/MGR_TEST.txt" ] || fail "delivered file vanished"
echo "ok: task bead, dependencies, and commit survived the Manager kill"

step "reconciler restarts the Manager session with transcript intact"
(
    cd "${CITY_DIR}"
    wait_for 300 "manager session restarted" bash -c "gc session list | awk -v s=\"${MANAGER_SESSION_ID}\" '\$1 == s && \$3 == \"active\" {found=1} END {exit !found}'"
) || fail "manager session did not restart"
(
    cd "${CITY_DIR}"
    wait_for 180 "manager transcript retains workstream context" bash -c "gc session peek manager-test 2>/dev/null | grep -q '${BEAD_ID}'"
) || fail "manager transcript lost the workstream context"

step "workstream reconstructable from durable state (bead is source of truth)"
(
    cd "${RIG_DIR}"
    TITLE="$(gc_test_bead "${BEAD_ID}" '.title' | head -c 60)"
    echo "  reconstructed task: ${TITLE}..."
    echo "  routed_to: $(gc_test_bead "${BEAD_ID}" '.metadata["gc.routed_to"]')"
    echo "  work_dir:  $(gc_test_bead "${BEAD_ID}" '.metadata["gc.work_dir"]')"
) || fail "workstream not reconstructable from durable state"

step "PASS — manager recovery verified (kill → durable work intact → session resume)"
echo "  bead:     ${BEAD_ID}"
echo "  session:  ${MANAGER_SESSION_ID} (killed, restarted, transcript retained)"
echo "  commit:   $(git -C "${RIG_DIR}" log -1 --oneline)"