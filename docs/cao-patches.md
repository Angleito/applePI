# CAO 2.5.0 fixes for OMP 18.1.2 on this WSL2 machine (2026-09-01)

Problem: `cao launch --provider omp` with OMP 18.1.2 failed intermittently:
(1) shell-ready wait timed out after 60s (~50% of launches), (2) when the
session did start, the terminal status could stick at `idle` forever instead
of `completed` even after the model finished.

## Root causes (verified empirically + from CAO source)

1. **tmux pipe-pane -> FIFO forwarding is unreliable on this WSL2 box.**
   The pane output reaches the pipe command's socket only after a variable
   delay (4-20s+) or never within 60s. CAO's shell-ready wait depends on the
   FIFO-fed StatusMonitor buffer, so ~half of launches timed out. The
   pipe-pane liveness watchdog (cold-start re-arm) did not rescue them
   (probe/thread never fired during the failures).
2. **CAO's OmpProvider status patterns were captured from OMP 17.2.10
   fixtures and never match the 18.1.2 TUI.** `_WORKING_PATTERN` literally
   contains a `⟨esc⟩` placeholder that can never match; `_STATUS_LINE_PATTERN`
   (`in:/out:` line) and `_READY_FRAME_PATTERN` (`╰─…─╯` frame) are not
   rendered by 18.1.2 (verified: 0 matches in captured buffers; 18.1.2 draws
   `╭─── omp v18.1.2 ───╮` top frame only, and the working indicator is
   `⎋ Working…`). Result: after the welcome screen latched `idle`, every
   later detection was UNKNOWN (suppressed) -> status stuck at `idle`.
3. OMP 18.1.2 emits a native turn-completion notification:
   `\x1b]777;notify;warp://cli-agent;{"event":"stop",…}` (wrapped by tmux in
   a DCS passthrough `\x1bPtmux;\x1b…`). This is the reliable COMPLETED
   anchor; the `"event"` field is first in the JSON so truncation-safe.

## Fixes (files in this directory are the patched versions)

### providers/omp.py
- `_WORKING_PATTERN` rewritten to match 18.1.2's `⎋ Working…` line
  (glyph optional) and keep the `Running …` variant.
- Added `_NATIVE_DONE_PATTERN` matching the OSC 777 notify
  `…warp://cli-agent;…"event":"stop"` (ESC optional so it matches both the
  raw OSC bytes and pyte's screen rendering of the payload).
- `_get_status_from_clean()`: returns COMPLETED when the turn-stop marker is
  present and a task was dispatched (checked before the frame markers).
- `get_status()`: checks the raw (pre-strip) buffer for the marker (OSC is
  stripped by `strip_terminal_escapes`) and, when the pushed buffer is empty,
  falls back to reading the live pane via `get_backend().get_history()` so a
  stalled FIFO never blinds status detection.
- `get_status_from_screen()`: same empty-screen fallback routed through
  `get_status(history)`.

### utils/terminal.py (wait_for_shell)
- After 2s with an empty StatusMonitor buffer (tmux backend), falls back to
  the live pane history: if the pane has content, the shell is ready. Logs
  `Shell ready for <id> (pane-history fallback, N bytes)`.

## Re-applying after `uv tool reinstall cli-agent-orchestrator`

    SP=~/.local/share/uv/tools/cli-agent-orchestrator/lib/python3.13/site-packages/cli_agent_orchestrator
    cp /tmp/applepi-smoke/cao-patches/omp.py     $SP/providers/omp.py
    cp /tmp/applepi-smoke/cao-patches/terminal.py $SP/utils/terminal.py
    # then restart cao-server

## Verification (after fix, 2026-09-01 18:44-18:50)
- 8/8 `cao launch` smoke sessions reached `completed` (previously ~50%
  launch failure + ~1/3 stuck idle).
- Status transitions now clean: unknown -> idle -> processing -> completed.
- Fallback exercised: 5 of 8 runs logged `Shell ready (pane-history
  fallback, …)`; all completed.
- Log lines to watch: `Shell ready for <id> (pane-history fallback|buffer
  stable)`, `Terminal <id> status changed: …`, `pipe-pane forwarder …
  re-arming`.

## Post-e2e additions (same session)
- providers/omp.py: `_NATIVE_DONE_PATTERN` now REQUIRES the "query" key after
  "event":"stop" — worker subagent stop notifications (relayed through the
  executive terminal, payload has only "response") no longer latch COMPLETED;
  `_NATIVE_QUESTION_PATTERN` detects OMP 18.1.2's AskUserQuestion
  ("event":"question_asked") as WAITING_USER_ANSWER; `_ready_status()` never
  reports COMPLETED from frames (tool viewports draw ╰─…─╯ borders that
  matched the 17.2.10 ready frame); a Working marker dominates frame-based
  ready detection; `_build_omp_command` appends `--config <omp-noplan.yml>`
  (plan.defaultOnStartup: false) for the applepi-executive profile so the
  unattended flow skips OMP plan-mode approval gates.
- services/status_monitor.py: get_status() re-detects on demand when cached is
  PROCESSING/IDLE/UNKNOWN (poll-based callers see fresh state even when the
  FIFO stream freezes); COMPLETED stays sticky (no re-detect).
- utils/terminal.py: wait_for_shell pane-history fallback (unchanged).
