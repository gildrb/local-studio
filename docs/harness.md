# Harness drivers: Claude Code and Codex threads in Local Studio

Lead's spec, 2026-11-17, followed by what the drivers rely on and what they cannot do.

## Why

Donovan is moving from T3 Code to Local Studio. Every thread he runs in T3 uses the real Claude Code CLI (provider `claudeAgent`) or the Codex CLI, so his skills, hooks, CLAUDE.md, MCP servers and sign-in all apply. Local Studio runs only Eukhe's own harness today. Without this, moving means losing his whole agent setup. This is the largest gap in the T3 parity study.

## Decision

Local Studio core gets two more harnesses beside Eukhe: **Claude Code** and **Codex**. A thread picks its harness when it starts and keeps it. Eukhe stays the default for new users; the importer and Donovan's settings make Claude Code his default.

## The seam

- New module `core/src/harness/` with `claude.rs` and `codex.rs`, owned by the Studio actor like the daemon client.
- Each driver translates its CLI's stream into the **same Eukhe types core already renders** (`eukhe_types::daemon::SessionEvent`, `StreamUpdate`, `eukhe_types::session::AgentMessage`). `transcript.rs`, `threads.rs` and both UIs then work unchanged. Where a CLI event has no Eukhe equivalent, map it to the nearest one; add a Local Studio type only when nothing fits, and list each one in `docs/harness.md`.
- `ThreadRow` and `ThreadInfo` gain `harness: Harness` (`Eukhe`, `ClaudeCode`, `Codex`). `store.rs` `ThreadFlags` gains `harness`, `native_session` (the CLI's session id) and `cwd`. Old `state.json` files load with `Eukhe`.
- Every `Studio` verb that acts on a thread routes by harness. Verbs a CLI can't do (for example `compact` on Codex, `edit_from_here`) return a clear `Update::Error`-style message rather than silently doing nothing; list them in the doc.
- The thread list for CLI threads comes from the Local Studio store only. Do not scan `~/.claude/projects` or `~/.codex`; that would pull in every session Donovan ever ran. The T3 importer (a later PR) adds his T3 threads to the store.

## Claude Code driver

- One long-lived process per active thread: `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --permission-prompts host --permission-mode <mode> --model <model>`, plus `--session-id <uuid>` on the first turn and `--resume <uuid>` after a restart. Kill it after 10 minutes idle; resume on the next send.
- Find the control protocol (permission requests, interrupt, responses) by running the installed CLI (`claude --version` is 2.1.303) and reading what it emits; do not guess. Record the frames you rely on in the doc.
- Access modes: Supervised to `manual`, AutoAcceptEdits to `acceptEdits`, Auto to `auto`, FullAccess to `bypassPermissions`. Permission requests become `Update::Approvals`; `answer_approval` answers them, including allow for the session.
- `abort` sends the CLI's interrupt. Steer and queue map onto streamed user messages.
- Usage and cost come from the CLI's result message and feed the usage report.
- Reopening a thread after a restart reads its history from the CLI's own session file and translates it to `AgentMessage`s.

## Codex driver

- `codex app-server` over stdio JSON-RPC (`codex-cli 0.163.0`). Generate the protocol schema with `codex app-server generate-json-schema` into a scratch dir and code against it.
- Thread start, turn start, interrupt, approval requests and responses, model list, history read for a reopened thread. Map access modes to Codex approval policy and sandbox the same way T3 does (`apps/server/src/provider/` in pingdotgg/t3code, a clone is at `~/.t3/scratch/2026-11-17-you-are-the-lead-for-a5ac7ec9/study/t3code`).

## Models and picker

`Update::Models` lists Claude Code models (aliases `opus`, `sonnet`, `haiku`, `fable` and their full ids) and Codex models (from app-server) as their own providers, so favorites and hidden work as today. Starting a thread on one of those models picks that harness. Linux picker shows the harness; the macOS picker gets the field through UniFFI and is finished on the Mac later.

## Account rules (hard)

- The CLIs run on Donovan's own sign-in. The driver removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `OPENAI_API_KEY` from the child environment and never sets any key. Never pass `--max-budget-usd` or any flag that implies API billing.
- If a CLI prints a quota, billing or sign-in prompt, surface it as a thread error and stop. Never retry on another account or provider.
- Never read `~/.claude/.credentials.json`, `~/.codex/auth.json` or any other auth file.

## Done check

1. AGENTS.md check: `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` (cargo `-j3`).
2. New e2e examples `harness_claude_smoke` and `harness_codex_smoke`, real models (Claude: `haiku`; Codex: the smallest model app-server lists), isolated `LOCAL_STUDIO_DATA_DIR` and `EUKHE_DAEMON_SOCKET`, scratch git repo as cwd. The CLIs keep their real config dirs so the sign-in works; the only thing they write is the session for the scratch cwd. Each smoke must:
   - start a thread and get a reply containing a word the prompt asked for;
   - in Supervised, ask for a file write: deny leaves no file, approve writes it;
   - abort a long turn and see the thread leave Working;
   - shut Studio down, start a new one on the same data dir, see the thread listed with its harness, open it, see the earlier turns, and get a second reply that proves the session resumed (ask for the word from turn 1);
   - print a usage line with real tokens.
3. Existing smokes still pass (`smoke`, `order_smoke`, `working_smoke`).
4. A Linux `--snapshot` scene with a Claude Code thread row showing its harness.

## What the build relies on

### Code map

- `core/src/harness/mod.rs`: the `Driver` enum, the `Event` stream each driver sends to the Studio actor, the usage ledger, and the shared message builders.
- `core/src/harness/claude.rs`: the Claude Code process, its stream translator, and the history reader for the CLI session file.
- `core/src/harness/codex.rs`: the `codex app-server` JSON-RPC client, its item translator, and the model list.
- `core/src/studio/cli.rs`: the Studio actor's side, one `Cli` per open CLI thread with a generation number so events from a killed process are dropped.
- `core/src/store.rs`: `ThreadFlags` keeps `harness`, `nativeSession`, `cwd`, `title`, `model` and `thinkingLevel` for CLI threads. An entry without `harness` loads as Eukhe.

### Environment

- `LOCAL_STUDIO_CLAUDE_BIN` and `LOCAL_STUDIO_CODEX_BIN` override the programs; otherwise `claude` and `codex` come from `PATH`.
- Every child loses `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`.
- Stderr lines and error frames are matched against sign-in, billing and quota words (`/login`, `not logged in`, `authentication_error`, `refresh token`, `unauthorized`, `credit balance`, `billing`, `usage limit`, `quota` and similar). A match ends the turn with that error, kills the process, raises a failed notification and sends nothing more until Donovan sends again.

### Claude Code 2.1.303 frames

The process runs as:

```
claude -p --input-format stream-json --output-format stream-json --verbose
  --include-partial-messages --replay-user-messages
  --permission-prompts host --permission-prompt-tool stdio
  --permission-mode <manual|acceptEdits|auto|bypassPermissions>
  [--model <m>] [--effort low|medium|high|xhigh|max]
  --session-id <uuid> | --resume <uuid>
```

`--permission-prompt-tool stdio` is not in `--help`, but without it the CLI denies writes on its own instead of asking the host.

We send, one JSON object per line:

- `{"type":"user","message":{"role":"user","content":...}}`. Images go as `{"type":"image","source":{"type":"base64","media_type":...,"data":...}}` blocks.
- `{"type":"control_request","request_id":ID,"request":{"subtype":"interrupt"}}`
- `{"type":"control_request","request_id":ID,"request":{"subtype":"set_permission_mode","mode":...}}`
- `{"type":"control_request","request_id":ID,"request":{"subtype":"set_model","model":...}}`
- `{"type":"control_response","response":{"subtype":"success","request_id":ID,"response":{"behavior":"allow","updatedInput":...,"updatedPermissions":[...]}}}` or `{"behavior":"deny","message":...}` to answer a permission request. Allow for the session adds the CLI's own `permission_suggestions` as `updatedPermissions`.

We read:

- `system` / `init`: sent at the start of every turn; carries the model in use.
- `user` with `isReplay: true`: the CLI took up a user message. This starts the run in Local Studio (`AgentStart`, then the user message). Replays of local commands (`<local-command-stdout>`, `<command-name>`) are skipped. `user` frames with `tool_result` blocks become tool results; `tool_use_result.structuredPatch` or a create becomes the diff on the edit card.
- `stream_event` (`message_start`, `content_block_start`, `content_block_delta` with `text_delta`, `thinking_delta` and `input_json_delta`, `content_block_stop`, `message_delta`, `message_stop`): streamed assistant text, thinking and tool calls.
- `assistant`: the finished message; used for tool names and inputs, and as the message itself when no stream events came.
- `control_request` with subtype `can_use_tool` (`tool_name`, `input`, `description`, `permission_suggestions`, `tool_use_id`): becomes an approval. Other subtypes get an error response.
- `control_cancel_request`: settles that approval.
- `result`: ends the turn. `terminal_reason` containing `abort` marks the turn aborted. `total_cost_usd` and `modelUsage` are cumulative for the life of the process, so the driver records the difference from the previous result per model. `usage` (the last call only) plus `modelUsage[*].contextWindow` give the context meter.
- `rate_limit_event` with a rejected status: treated as a quota stop.

History on reopen comes from `~/.claude/projects/<cwd with every non-alphanumeric character as '-'>/<session>.jsonl` (`CLAUDE_CONFIG_DIR` is respected). Assistant lines are merged by `message.id`; sidechain and meta lines, `<...>` command lines and `[Request interrupted` lines are skipped.

### Codex app-server (codex-cli 0.163.0) calls

Requests we send: `initialize` (then the `initialized` notification), `thread/start`, `thread/resume`, `turn/start`, `turn/steer`, `turn/interrupt`, `thread/name/set`, `thread/compact/start`, `model/list`.

Access modes follow T3:

| Mode | approvalPolicy | sandbox | approvalsReviewer |
| --- | --- | --- | --- |
| Supervised | `untrusted` | `read-only` | `user` |
| AutoAcceptEdits | `on-request` | `workspace-write` | `user` |
| Auto | `on-request` | `workspace-write` | `auto_review` |
| FullAccess | `granular` (only MCP elicitations ask) | `danger-full-access` | `user` |

Notifications we read: `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/textDelta`, `item/commandExecution/outputDelta`, `thread/tokenUsage/updated`, `error` (skipped while `willRetry` is true).

Items map to the Eukhe shapes: `userMessage` to a user message, `agentMessage` to assistant text, `reasoning` to thinking, `commandExecution` to a `bash` tool call with `command`, `fileChange` to an `edit` tool call with the diff, `mcpToolCall` to `server.tool`, `dynamicToolCall` to its tool name, `webSearch` to `web_search`.

Server requests we answer: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` with `accept`, `acceptForSession` or `decline`; the legacy `execCommandApproval` and `applyPatchApproval` with `approved`, `approved_for_session` or `denied`. Every other server request (`item/permissions/requestApproval`, `tool/requestUserInput`, `mcpServer/elicitation` and so on) gets a JSON-RPC error.

Token use comes from `thread/tokenUsage/updated`: the driver records the difference of `total` between updates (`last` for the first update after a resume). Codex reports no cost, so Codex rows show tokens with a cost of 0.

### Usage

Each turn's spend is appended to `<data dir>/harness/usage.jsonl` (`at`, `provider`, `model`, `thread`, `input`, `cacheRead`, `cacheWrite`, `output`, `cost`). The usage report adds these rows to the Eukhe sessions; each CLI thread with spend in the period counts as one session.

### Local Studio types added

- `Harness` on `ThreadRow`, `ThreadInfo` and `ThreadFlags`.
- Providers `claude-code` and `codex` in `Update::Models`. Model names carry `(Claude Code)` or `(Codex)`.
- A custom message with `customType: "harness"` for stop notices in the transcript.

## What the CLIs cannot do

| Verb | Claude Code | Codex |
| --- | --- | --- |
| Steer a running turn | Same as queue: the CLI holds a mid-turn message and runs it as the next turn | `turn/steer` |
| Send now / remove a queued message | No queue is visible; messages go straight to the CLI | Same |
| Images in a prompt | Yes | Error: not supported yet |
| Change thinking level mid-thread | Applies from the next process start; the idle process is restarted at once, a running one keeps its level until then | Next turn |
| Compact | Sends `/compact` as a message | `thread/compact/start` |
| Rename | Local Studio title only | `thread/name/set` too |
| Delete | Forgets the thread; the CLI session file stays | Same |
| Edit from an earlier message | Error | Error |
| Fork | Error | Error |
| Service tier | Error | Error |
| Cancel a subagent | Error | Error |
| Reopen an image from an earlier message | Error | Error |
| Regenerate title | Only with a text generation model set in Settings | Same |
| Switch the model to another harness | Error: start a new thread | Same |
| Switch the model within the harness | `set_model` | Next turn |

## Lifecycle

- A new thread gets a fresh UUID as its id. For Claude Code it is also the CLI session id (`--session-id`). For Codex the app-server thread id is stored as `nativeSession`.
- One process per open thread. A process idle for 10 minutes with no run and no pending approval is killed; the next send resumes it (`--resume` or `thread/resume`) and reloads history.
- Restart and stop-timeout kill the process and resume it.
- If Codex cannot resume its thread, the driver starts a new Codex thread for the same Local Studio thread and says so.
