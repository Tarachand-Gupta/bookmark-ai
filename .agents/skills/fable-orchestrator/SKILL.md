---
name: fable-orchestrator
description: "How to run this repo the way the Fable 5.1 orchestrator did: research cheaply, brief builders/QA with complete context, verify with evidence, commit yourself. Use for ANY feature request, bug fix, or build cycle — especially when running on a smaller model (GLM etc.) that should inherit Fable's working method. Covers request triage, agent handoff prompt format, model ladder, scratchpad contracts, mid-build steering, and reporting."
---

# Fable-style orchestration for Bookmark AI

Distilled from the 2026-09-03→13 session (53 Agent spawns, ~10 days) of the previous
orchestrator. This is a working method, not theory. Every step below is something the
orchestrator actually did repeatedly and successfully.

## The loop (run it in this order for every non-trivial request)

1. **Orient yourself cheaply (≤15 tool calls, never more).**
   - `git log --oneline -10`, `git status`, `git diff --stat` for the affected area.
   - Read the relevant `CLAUDE.md` files (root, then the app: `apps/<app>/CLAUDE.md` or README).
   - `ls` the target tree; check package.json scripts for the right test/type-check commands.
   - Check env keys BY NAME only: `grep -E "^[A-Z_]+=" .env` — never read values.
   - Do NOT read big source files yourself. That is what recon agents are for.

2. **Fan out read-only recon agents BEFORE delegating builds** (one message, 2–3 parallel
   Explore agents, `model: "sonnet"`). Each recon prompt demands: "facts, not opinions" with
   "exact file:line references", verbatim snippets of the specific functions/configs that
   matter, and a word cap. Purpose: "so I can brief the build agents precisely." Builders
   then never burn their own context rediscovering the code.

3. **Say what you're doing + flag risks to the user FIRST**, in 2–4 sentences, before the
   heavy work starts. Name the flags you found (race conditions, env prerequisites, things
   that will block, what you deliberately will NOT change). Example pattern: "I'll start by
   getting oriented… so I can brief the build agents precisely. Two risks: X depends on Y
   landing first; Z touches prod data so QA must not exercise it."

4. **Write shared state to a scratchpad for big cycles.** For multi-agent parallel builds:
   write a `CONTRACT.md` (§0 = exclusive per-agent path-ownership table; then numbered wire
   contracts per feature area; coordination rules: ONE dev server, who may restart it, no
   commits by builders, fixture hygiene, polish bar) and a `QA-BRIEF.md` (ground rules +
   PASS/FAIL acceptance items per platform + report format + S1/S2/S3 severity ladder).
   Put them in a gitignored `.work/` dir inside the repo (the /tmp scratchpad is WIPED when
   the Claude Code process restarts — anything you spend minutes producing goes in the repo
   or gets lost). Builders read the contract file instead of you pasting it 5 times.

5. **Spawn builders with COMPLETE briefs.** The handoff prompt format (copy this shape):

   ```
   You are the <ROLE> agent for <task> in /Users/tara/Developer/bookmark-ai.
   FIRST read <contract file / CLAUDE.md files / memory notes by exact path>.
   Then read these specific files: <exact list>.

   ## Facts already verified (so you don't re-explore)
   - <file:line> — <what it does today, verbatim snippet of the load-bearing part>
   - <env/db/toolchain facts, commands that work>

   ## Deliverables (numbered, each concrete)
   1. …
   2. …

   ## Verification (exact commands)
   <build/type-check/test commands, what must be green, what to screenshot>

   ## Constraints
   Do NOT commit (the orchestrator commits). Do NOT touch <other agents' paths>.
   Never <pkill / vercel / prod Turso / git add -A / .env files>.

   ## Report back (concise, facts only)
   files touched (one line each), test counts verbatim, screenshot paths,
   contract deviations (top), anything you could NOT verify — stated plainly.
   ```

   - 4–9 KB prompt is normal for a big build. Small fixes: 3–4 KB. The prompt IS the spec;
     a builder with a thin prompt wanders and redoes work.
   - State Tara's UX words verbatim when she gave a spec ("treat as the spec").
   - Tell builders what OTHER agents are doing right now and the exact boundary.
   - Tell them what is BLOCKED and must be marked BLOCKED, not faked.

6. **QA as a second wave, while builders still run where independent.** QA agents verify and
   report; they NEVER fix product code. Route defects back to the SAME builder via
   SendMessage (its context is warm; fix rounds are cheap). Fix→re-QA loops 1–2 times, then
   escalate to a fresh agent or the orchestrator does it directly.

7. **Orchestrator commits.** Builders never commit. You `git add <explicit paths> && git
   commit` (NEVER `git add -A` — the tree always has unrelated changes). Commit style:
   `fix(scope): …` / `feat(scope): …`, short body with numbers, ending with:
   `Co-Authored-By: Claude Code <noreply@anthropic.com>`. Deploys are Tara's decision
   (`vercel deploy --prod` from repo root — never from apps/web, never in a subagent).

8. **After prod deploy: launch a smoke agent** (signed-out surfaces + the feature's flow,
   headless Chrome/curl), relay pass/fail compressed. See the `test-release` skill for the
   canonical ship loop + smoke suite.

## Model ladder (Tara's standing rule)

- **Big builds, audits, packaging, anything with design judgment** → `model: "fable"`.
- **Small well-scoped fixes** → `model: "opus"`.
- **QA / testing walkthroughs** → `opus`; `sonnet` ONLY for testing small fixes or scripted
  screenshot checklists. A Sonnet QA round once let a broken signed-out Mac state ship twice —
  never let Sonnet be the only gate on a large or auth-related change.
- **Recon** → Explore agents on `sonnet`.
- Justify every agent in one line. Prefer ONE builder at a time; extend a running agent via
  SendMessage instead of spawning a duplicate. Parallel builders only for genuinely disjoint
  platforms (web/backend/macOS/mobile/extension) with a CONTRACT.md.
- When the orchestrator itself is a small model (GLM etc.): delegate even harder. The
  orchestrator decides and briefs; screenshots, builds, curl checks, git surveys all go to
  subagents that return VERDICTS, not raw output. Keep own tool calls minimal.

## Decision rules

- **Do it yourself only when:** orientation reads, infra boot (dev server, Redis), git
  commits, or the remaining work is small AND you already have all context loaded (then say:
  "I'll do it directly rather than delegate").
- **Mid-build steering:** broadcast cross-cutting facts to running agents (exact constant
  names so copy doesn't drift); sequence deploys ("hold until that fix lands"); gate
  dependent agents on signals.
- **Failure handling:** a 429/529-killed agent is resumed or relaunched with the SAME brief.
  When a stopped agent is unresumable, `git stash` its partial work and tell the fresh
  builder to pop the stash and continue — recover context from the CODE, not transcripts.
  State plainly what failed and why.
- **Two failed fix attempts ⇒ stop guessing.** The orchestrator stops delegating theories,
  reproduces the bug itself with instrumentation, then hands the PROVEN root cause to a
  fixer.
- **Honesty rules:** builders/QA must state what they could NOT verify, plainly ("never
  claim Firefox/Safari behavior you did not observe"). When something is blocked (no
  credentials, blocked surface), say so and switch to paste-ready text for Tara rather than
  pretending. Report test counts verbatim. "Half-baked is a review failure" even when
  functional (Tara's polish bar).

## Reporting style to the user

- One-line acks for small asks.
- Completions: "Done. Commit X" + 3–6 bullets.
- QA results: "passed X, found N fixable issues; sending them back to <builder>".
- End-of-cycle: short headed sections with counts ("619 web tests pass", "14/14 assertions").
- Model/cost table when asked.
- Always end with "still open / waiting on X" when something is in flight.
- Never claim unverified behavior.

## Anti-patterns (all observed as real failures once — do not repeat)

1. An own-fix leaked scope: an orchestrator-written workaround matched EVERY request of a
   kind instead of only the extension's own (broke the web page's Clerk). Scope fixes
   narrowly + regression test.
2. Resume-vs-restart confusion: two failed resumes of a killed agent led to a fresh agent
   redoing work. Tara caught it. Fix = stash-handoff (rule above).
3. Spec gaps surfaced by Tara, not QA (signed-out UI showed too much; email missing).
   Re-spec explicitly and record the correction; don't let QA accept a plausible reading.
4. Two background agents collided on shared state (both reset the same demo password, broke
   the other's sign-in mid-capture). One shared resource = one owner.
5. Degenerate output loops (output-token limit → repeated spam). Keep replies compressed;
   break work into smaller pieces.
6. Cost: Tara twice challenged agent spend. Justify agents; QA on the cheapest capable model.
