#!/usr/bin/env bash
#
# worker-recovery.sh — Worker crash/kill recovery test.
#
# Scenario (observed real v1.4.1 behavior, not assumed):
#   1. A Worker task is slung and claimed.
#   2. The Worker session is force-killed mid-task (`gc session kill`).
#   3. Gas City keeps the durable task state: the bead remains in the store,
#      still assigned to the killed session, with its work record.
#   4. The session reconciler restarts the session (same session id).
#   5. The restarted session's startup claim returns its existing
#      assignment; the Worker resumes and finishes the task.
#      (Observed: no automatic requeue-to-a-different-session on kill;
#      recovery is same-session resume.)
#
# Uses an isolated clone-based city (see lib.sh). Requires pi (authenticated).
#
# Usage: tests/worker-recovery.sh

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TASK_TITLE="worker recovery probe"
TASK_DESC="Create REC_TEST.txt containing exactly: applePI recovery probe

REPORT_TO:
manager-test

OBJECTIVE:
Recovery validation file.

ACCEPTANCE:
REC_TEST.txt exists.
Contents exactly match requested text.
Commit the change.

CONSTRAINTS:
Modify no other files.

DEPENDENCIES:
None."

gc_test_init "worker-rec"
gc_test_prereqs
gc_test_boot

step "create manager-test (report target for the Worker task)"
gc_test_new_manager "manager-test"

step "route Worker task"
BEAD_ID="$(gc_test_sling "${TASK_TITLE}" "${TASK_DESC}")"
echo "bead: ${BEAD_ID}"

step "Worker materializes and claims"
gc_test_worker_in_rig
WORKER_SESSION_ID="$(
    cd "${CITY_DIR}"
    gc session list | awk '$2 == "scratch-proj/applepi-roles.worker" {print $1; exit}'
)"
[ -n "${WORKER_SESSION_ID}" ] || fail "could not determine worker session id"
wait_for 120 "bead claimed" bash -c "cd '${RIG_DIR}' && gc bd show '${BEAD_ID}' --json 2>/dev/null | jq -e '.[0].status == \"in_progress\"'"
(cd "${CITY_DIR}" && gc session kill "${WORKER_SESSION_ID}" >/dev/null) || fail "session kill failed"

step "durable task state survives the kill"
wait_for 30 "bead still exists and still assigned" bash -c "cd '${RIG_DIR}' && gc bd show '${BEAD_ID}' --json 2>/dev/null | jq -e '.[0].metadata[\"gc.session_id\"] == \"${WORKER_SESSION_ID}\"'"
echo "ok: bead ${BEAD_ID} durable; assignment to ${WORKER_SESSION_ID} preserved"

step "reconciler restarts the Worker session (same-session resume)"
(
    cd "${CITY_DIR}"
    wait_for 300 "worker session restarted" bash -c "gc session list | awk -v s=\"${WORKER_SESSION_ID}\" '\$1 == s && \$3 == \"active\" {found=1} END {exit !found}'"
) || fail "worker session did not restart"

step "task recovers to completion (file + commit)"
(
    cd "${RIG_DIR}"
    wait_for 480 "REC_TEST.txt exists" test -f REC_TEST.txt
    [ "$(cat REC_TEST.txt)" = "applePI recovery probe" ] || fail "REC_TEST.txt content mismatch"
    wait_for 60 "task commit exists" bash -c "git log --oneline | grep -q 'TASK ${BEAD_ID}'"
    echo "commit: $(git log -1 --oneline)"
    git status --porcelain | grep -q . && fail "rig working tree not clean" || true
) || fail "task did not recover to completion"

step "bead terminal state (work_dir in rig; closed+shipped or open w/ record)"
gc_test_bead "${BEAD_ID}" '.metadata["gc.work_dir"]' | grep -q "${RIG_DIR}" \
    || fail "gc.work_dir mismatch — worker did NOT operate in the rig"
STATE="$(gc_test_bead "${BEAD_ID}" '.status')"
OUTCOME="$(gc_test_bead "${BEAD_ID}" '.metadata["gc.work_outcome"] // "unset"')"
echo "bead ${BEAD_ID} status=${STATE} work_outcome=${OUTCOME}"
if [ "${STATE}" = "closed" ]; then
    [ "${OUTCOME}" = "shipped" ] || fail "closed but work_outcome=${OUTCOME}, expected shipped"
fi

step "PASS — worker recovery verified (kill → durable state → resume → completion)"
echo "  bead:     ${BEAD_ID}"
echo "  session:  ${WORKER_SESSION_ID} (killed, restarted, resumed)"
echo "  commit:   $(git -C "${RIG_DIR}" log -1 --oneline)"