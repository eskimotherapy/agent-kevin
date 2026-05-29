---
title: Audit Premise Decay
sources: [seeded by /agent-kevin:init]
created: {{INIT_DATE}}
updated: {{INIT_DATE}}
---

# Audit Premise Decay

A piece of logic — an audit, a diagnostic threshold, a metric, a prompt scope, a code path's premise — was correct against its world-state at write-time. The world moved. The logic stayed. Re-validating against current state typically refutes a meaningful fraction of what the logic claimed.

The original frame was inherited audits. The pattern generalizes: anywhere a time-stamped premise embeds a snapshot of the world, that snapshot decays.

## Pattern

1. An audit (or threshold, metric, code premise) lands as a task. The recommendations look concrete and actionable.
2. Pulling them straight into execution feels efficient.
3. Verifying each recommendation against live state before executing reveals that some work was already done elsewhere (sibling rollout, upstream fix) or that the underlying diagnosis was wrong.
4. Executing without that check duplicates work or runs against an invalidated diagnosis.

## Common shapes

**Inherited audits.** An SEO audit, a security review, a code-quality report from N weeks ago. Some of the "fixes" already shipped through unrelated work. Some of the diagnoses were guesses from inference, not measurement.

**Decayed metrics.** A KPI sourced from data that was fresh once. The metric reads broken; the data source is months behind. The site/system is fine.

**Decayed thresholds.** A timeout, a rate limit, a heuristic sized for workloads that have since grown. The threshold trips on legitimate work because its premise ("3 minutes of silence = stuck") drifted against current shape.

**Decayed code premises.** A function written when the world had property X. The world expanded; X is now sometimes false. The function silently produces wrong output rather than failing loudly.

**Decayed cited facts.** A number, a deadline, a brand behavior, a regulatory policy. Verified once at write-time, embedded in N downstream artifacts, never re-verified. The world updated; the artifacts didn't.

## Why it happens

Time-stamped premises embed a snapshot. Between write-time and read-time:
- Adjacent work shipped (sibling rollouts, upstream fixes solving the same problem from a different angle).
- The external world changed (vendor APIs evolved, scores moved, regulations updated).
- Workloads grew past the size the original threshold or scope was sized for.
- The diagnosis was inference from indirect signals, not direct measurement.

The original author wasn't wrong; their information was current at write-time. The reader inheriting the logic later doesn't share that frame.

## How to apply

Before executing inherited work or trusting an existing diagnostic:

1. **Verify the premise, not just the recommendations.** "Desktop is slow" → measure it now. "These pages lack X" → read them now. "Idle threshold is N seconds" → check what current workloads actually take. "Vendor charges X%" → check their pricing page now.
2. **Triangulate with a measurement, not a second inference.** When one inferred cause is refuted, don't substitute another inferred cause without ground truth. Find a way to measure.
3. **Expect to drop a meaningful fraction of recommendations on first pass.** If you don't, you probably skipped the verification step.
4. **Re-scope rather than re-execute.** When the premise is wrong, don't twist the recommendations to fit a new theory; close the task as misframed and file a replacement with the correct framing.
5. **For code premises: fix at the source.** If the premise is encoded in a function ("refs get pruned with files", "180s idle = stuck"), manual cleanup is a band-aid. Fix the function so the premise stays true, or remove the premise entirely if it never was.
6. **For cited facts: schedule freshness checks.** Numbers in landing pages, decks, and plans need a periodic re-verify, not just a one-off citation tag at write-time.

## Sibling concepts

- [[concepts/self-evolution-loop]] — verify-before-claim is the identity-level rule. Audit-premise-decay is the same shape applied to inherited work products instead of single facts.
- [[concepts/karpathy-wiki]] — the wiki itself decays; concept articles need periodic re-validation against current code, not just appends.
