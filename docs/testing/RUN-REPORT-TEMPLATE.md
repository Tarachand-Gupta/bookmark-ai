# E2E run: <UTC timestamp>-<short label>

## Scope and identity

- Operator/harness and authorization: <what is permitted; denied actions remain denied>
- Repository revision: <full SHA>; dirty diff/source hash: <hash or clean>
- Modes: <U unit / I integration / L local UI / H hosted UI / S Release simulator / D physical>
- Web deployment: <deployment ID/revision if verified; public hostname>
- Hosts: <API and Live; no secrets>
- Tool versions: <Node/pnpm, Xcode/XcodeGen, browsers, SDK/JDK/ADB, wrapper/CLI versions>
- Start/end times and timezone: <both UTC and local if useful>
- Account roles: <A disposable owner, B disposable foreign, M migrated read-only; correlation booleans or redacted labels>
- Shared UI owner: <operator and handoff schedule>
- Initial state: <signed-in/out, profiles, fixture baseline, sync/Live state>

## Artifact ledger

| Surface | Source/snapshot hash | Configuration | Bundle/package/extension ID | Artifact hash | Installed/running exact path or profile | Sign/permissions | Build/install/runtime stages |
|---|---|---|---|---|---|---|---|
| Web/API | | | | | | | |
| Mac | | | | | | | |
| iOS simulator | | | | | | | |
| iOS phone | | | | | | | |
| Android emulator/hardware | | | | | | | |
| Chrome | | | | | | | |
| Firefox | | | | | | | |
| Safari companion/appex | | | | | | | |

## Case results

Do not merge build, protocol and GUI outcomes into one cell. Split a case by platform/mode when evidence differs.

| Case ID | Client/mode/account role | Prerequisite | Action and expected result | Actual result | Status | Evidence and time | Blocker/next step |
|---|---|---|---|---|---|---|---|
| AUTH-01 | | | | | NOT RUN | | |

Status rules: PASS requires the stated observed result; FAIL is an exercised mismatch; BLOCKED means a prerequisite/access/tool prevented exercise; NOT RUN is unattempted; N/A names the unsupported capability. A screenshot of provider login is not callback PASS. Backend corroboration is labeled separately from UI proof.

## Fixture ledger and cleanup

| Role/run | Object type | Exact new ID | Created by action/time | Pre-existing or newly created proof | Cleanup action/status | Preserved baseline proof |
|---|---|---|---|---|---|---|
| | | | | | | |

Record settings changes with exact baseline/restore checks. Record browser native node IDs separately from library IDs. Do not infer deletion ownership from matching URLs, titles, dates or account membership. If ownership is uncertain, leave it and report it.

## Source checks

- Exact command, configuration and exit status: <>
- Counts: <executed/pass/fail/skip; explain every skip class>
- Logs/test bundles: <relative archived paths>
- Tests with mocked provider/network vs live endpoints: <>

## Defects and remaining coverage

- Reproduction: <case, exact artifact, identity role, action, observed mismatch>
- Severity/impact: <>
- Evidence: <redacted screenshot/log/protected read>
- Current blocker and independent work completed: <>
- Acceptance still required: <>
- Final restored state: <running app, account role, profile, fixture residue>

## Evidence handling

Keep raw credentials, email codes, passwords, bearer/refresh tokens, provider keys, private exports and personal data in owner-approved private storage, not this report. Sanitize screenshots/HAR/logs before sharing. Use artifact file hashes, non-secret session correlation and minimal account-match booleans. Publish a manifest of sanitized evidence files and hashes alongside this report so another harness can audit it.
