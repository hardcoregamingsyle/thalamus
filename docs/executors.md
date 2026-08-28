# Code-mode Executors

`{"op":"cmd"}` ops are queued into the `codeCommands` table and consumed by one of two executors, picked once per branch by the `executor` field on `codeBranches` and never changed afterwards. The two executors never race — no code path targets both from the same branch.

| Executor | Where commands run | Trigger |
|---|---|---|
| `cloud` (default) | GitHub Actions worker inside the branch's build workspace — the `<repo>-vm` mirror, or a standalone `thalamus-vm-*` workspace when no user repo is connected (see below). Never requires the user to connect GitHub. | Server-scheduled via `bootVmForBranch` on `startPipeline` and every subsequent resume |
| `local` | The user's own machine, under `%LOCALAPPDATA%\Thalamus\...` per branch | Desktop app polls `codeCommands:listPendingForBranch` and executes locally |

## Command lifecycle (both executors)

```
Agent emits {"op":"cmd","command":"npm test"}
  → codePipeline parses the op
  → codeCommands.queueCommand inserts a row (status: "pending")
  → branch status transitions to "paused"
  → codePipeline.runPipelineAction returns without rescheduling itself
  → executor picks the row up (cloud worker poll OR desktop app poll)
  → executor runs the command, reports the result
    → callback flips the row to "completed" / "failed"
    → if no more pending/running commands on this branch:
        ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction)
      → pipeline self-resumes exactly where it paused
```

The branch "parks as paused, self-resumes" behaviour is symmetric across the two executors. Only the callback path differs.

## Cloud executor — GitHub Actions worker

Source: `src/convex/githubActionsRunner.ts`. Commands run on the branch's **build workspace**, never on the user's repo: GitHub will only run a workflow that sits beside the code, and the user's repo is code-only by product decision (no workflow files, no `.thalamus/` transcript — pushes filter system paths and pulls refuse to read them back). For a branch WITH a connected repo the workspace is a platform-owned mirror (`<repo>-vm`, public for unlimited Actions minutes) carrying the same code plus the managed workflows. **A branch whose user never connected GitHub needs nothing from the user**: `ensureVmMirror` provisions a standalone platform-owned workspace (`thalamus-vm-<branchId suffix>`, README-created `main` as its only branch) seeded from the branch's own Convex file store, and `saveVmMirror` upserts a *workspace-only* `githubConfigs` row (empty `owner`/`repo`/`repoUrl`) that exists solely to carry the `vm*` coordinates — the user is never asked to connect anything for execution to work. `ensureVmMirror` creates either shape once — seeding the working branch with the branch's current code BEFORE the workspace is recorded in the config, so a worker can never clone an empty scaffold — and `resolveVmTarget` is the single helper boot/sandbox/stop use for its coordinates and token (distinct mirror or standalone workspace → the platform `GITHUB_TOKEN`; legacy self-mirror → `resolveTokenForBranch`, where the "mirror" is the repo itself). A persistent worker workflow (`.github/workflows/thalamus-vm.yml`, provisioned by `ensureVmWorkflow` onto the workspace's default AND working branches) polls Convex every ~10s.

The worker is stateless across polls: before every batch it re-syncs its working tree from the branch ref it tracks (`git fetch origin` + `git checkout -B $BRANCH_REF origin/$BRANCH_REF`), so a command only ever sees what has actually been pushed to the mirror's working branch. The pipeline must therefore push files before their commands run. `codePipeline` does this synchronously on every round that both writes files and queues commands — the push is awaited before the queue is dispatched, and if it fails the batch is failed fast with the reason (a command that cannot see the files it depends on would otherwise produce a baffling "No such file" that agents answer by re-creating identical content forever). Every push (`autoPushToGithub`, and the manual "Sync with github" button) is two-legged: the user repo's default branch first, then the mirror's working branch via `pushMirrorCopy`, with a mirror-leg failure failing the push loudly. The push and the boot resolve the same identities, so a reconnected account cannot leave pushes behind the worker.

### Boot

- `codePipeline.startPipeline` calls `internal.githubActionsRunner.bootVmForBranch` the moment a message lands.
- `bootVmForBranch` is **idempotent**: if `vmLastSeenAt` is within `VM_ALIVE_WINDOW_MS` a live worker is heartbeating and no second dispatch happens; if the last-seen is stale (or a dispatch failed) the boot proceeds and stamps a fresh `vmNonce`.
- The dispatch calls the GitHub Actions `createWorkflowDispatch` API with inputs `branch_id`, `vm_nonce`, `callback_base` (= `CONVEX_SITE_URL`), `os` (from `RUNNERS[branch.runnerOs]` — `ubuntu-latest` / `windows-latest` / `macos-latest`), `branch`.
- Return values: `"booted"`, `"alive"`, `"local"` (desktop-executor branch), `"no-repo"` (legacy — kept in the union for old callers but unreachable since the executor self-provisions a standalone workspace when no user repo is connected), `"no-token"`, `"dispatch-error"`, `"workflow-scope-missing"`. The last three cause `executeBranchCommandsViaActions` to fail every backlogged command with an explanatory message and resume the pipeline — a branch cannot park silently forever.

### Worker poll (`POST /code/vm-poll`)

The worker's only credential to Convex is `vmNonce`. The endpoint is unauthenticated by necessity (a public-repo Actions job has no other secret of ours); a wrong or missing nonce is a silent 404, because naming a valid nonce shape would be free reconnaissance.

Each poll cycle (`src/convex/http.ts:1049` handler):

1. Validate `{ branchId, vmNonce }` against `codeBranches.vmNonce`.
2. `claimPendingCommandsForVm` (in `codeCommands.ts`): atomically flip all `pending` rows for this branch to `running`, stamp each with a fresh 32-hex `callbackNonce` (Web Crypto — this file has no `"use node"`), return `[{id, nonce, command}]`.
3. Heartbeat: `setVmInfo({ branchId, lastSeenAt: now })` — proves this worker is alive so a redundant boot backs off.
4. Compute `keepAlive`:
   - If work was claimed OR pending/running commands remain → `keepAlive = true`.
   - Else, compare `now - lastActivityAt` to the idle window: **300s while the task is incomplete, 600s once completed**. Within the window → `keepAlive = true`. `lastActivityAt` is bumped on every status change, message, and command completion.
5. Return `{ keepAlive, commands: claimed }`.

The worker executes each returned command in its shell, captures stdout/stderr and exit code, then posts one `POST /code/command-result` per completion.

### Result callback (`POST /code/command-result`)

Fields: `{ commandId, nonce, output, exitCode }`. Handler in `http.ts:1006`, delegates to `codeCommands.completeFromRunner`. The nonce is single-use and cleared on spend — a replay or a guess finds nothing to match. On success:

- Patch the command to `completed` / `failed` with the trimmed output (max 20 KB).
- Bump the branch's `lastActivityAt` — a long-running command's callback must not look like idleness.
- If no `pending` and no `running` commands remain, schedule `internal.codePipeline.runPipelineAction` — the pipeline resumes.

### Sandbox tunnel callback (`POST /code/sandbox-callback`)

Separate callback used by the sandbox dev-server workflow to report the tunnel URL. Query string carries `branchId` and a single-use `nonce` (generated per dispatch in `githubActionsRunner.ts:448`); body carries `{ tunnelUrl, status, error }`. Handler delegates to `codeBranches.completeSandboxCallback`, which sets `sandboxUrl` and `sandboxStatus` on the branch.

## Desktop executor — local machine

When the WPF app calls `startPipeline`, it passes `executor: "local"`. That value is written once to the branch and never changes — `bootVmForBranch` returns `"local"` immediately and never dispatches a cloud worker for that branch.

### Poll and execute

- `CodeView.xaml.cs` (thalamus-native) polls `codeCommands:listPendingForBranch({ token, branchId })` — an owner-checked public query (`requireSession` + `assertBranchOwner`), because the reply names shell commands to run on the user's machine.
- The desktop app runs each command in a per-branch workspace under `%LOCALAPPDATA%\Thalamus\...`, captures the output, then calls `codeCommands:completeCommand({ token, commandId, output, exitCode })`.
- `completeCommand` is a public mutation (auth-required, owner-checked). It flips the row to `completed` and — if no `pending` commands remain — schedules `internal.codePipeline.runPipelineAction`, resuming the pipeline exactly like the cloud path.

### Why they cannot race

- A local branch is never scheduled server-side: `bootVmForBranch` bails at `"local"`, `executeBranchCommandsViaActions` never fires.
- A cloud branch is never polled by the desktop app: the desktop only looks at branches it created with `executor: "local"`.

## `request-api-key` — the other pausing op

`{"op":"request-api-key","name":…,"description":…,"howToGet":…}` writes a `codeApiKeyRequests` row and genuinely blocks on the user. The pipeline sets the branch to `paused` and returns. When the user submits the key via `codeApiKeys.fulfillApiKeyRequest`, that mutation reschedules `runPipelineAction` and the pipeline resumes. The key is AES-256-GCM encrypted with `API_KEY_ENCRYPTION_SECRET` before insertion into `codeApiKeys`; the write path fails closed if the secret is missing.

## Diagnosing a stuck branch

Check `codeCommands` and `codeApiKeyRequests` for rows with `status: "pending"`. Nine times out of ten a branch sitting in `paused` has a row nobody picked up:

- Cloud executor: check the build workspace's Actions history (the workspace's owner/repo are on the branch's `githubConfigs` row as `vmOwner`/`vmRepo` — present even when the user never connected GitHub, on a workspace-only row). If the `thalamus-vm.yml` workflow errored on boot, `vmLastSeenAt` will be stale and the next `startPipeline` / message will attempt to re-boot; if the failure is `no-token` / `dispatch-error` / `workflow-scope-missing`, the pipeline already failed the backlog with an explainer and resumed. Commands running old or missing files means the mirror leg of a push failed — re-sync from the Git Sync tab, whose sync button fails loudly in exactly that case.
- Local executor: confirm the desktop app is still polling. If the app crashed, restarting it resumes the poll and picks up the pending row.
