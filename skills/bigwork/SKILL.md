---
name: bigwork
description: Carries out a large task as a dynamic workflow, following a fixed methodology for how subagents are briefed, sized, checked and reported on. The shape of the work is left to the task.
argument-hint: "<task>"
disable-model-invocation: true
---

# bigwork

Do the task below with the Workflow tool. Invoking this skill is the user's opt-in to run workflows for it.

Task: `$ARGUMENTS`

The user wants the result. Shape the orchestration to the task and run it through without pausing for sign-off; stop
only for a decision that is genuinely theirs. The rules below fix how the work is done, not what its steps are.

**In plan mode,** the plan gets an execution section: what the workflow fans out over, model and effort per group of
agents with the reason, how results are checked, what the report will hold. After approval, run it; its steps are
phases of the workflow, not separate sessions.

**The script follows the approved plan.** Use the models and effort the plan named. If you change any, say which and
why before launching, not after.

## Methodology

- **Scout before you script.** Find the real work list inline (files, call sites, questions, sources) so the fan-out
  runs over actual items, not guesses.
- **Choose `model` and `effort` on purpose.** Set both explicitly on every `agent()` call, picked by how hard that
  agent's job is. Never leave them to inherit by default, and never go above the session model. Agents doing the same
  job get the same values, so they share the prompt cache.
- **Brief each agent as a peer with no context.** State the objective, what to return (a `schema` for anything the
  script processes further), which tools or sources to use, and where its scope ends. Vague briefs produce duplicated
  work and gaps.
- **Never let two writers share a file.** Agents that edit in parallel get disjoint files, or `isolation: 'worktree'`
  when that can't be guaranteed.
- **Check in a separate context.** Findings, claims and changes that matter are checked by an agent whose job is to
  refute them, not by the one that produced them. Scale checking to the stakes; mechanical work may need none.
- **Prefer deterministic checks.** Where a build, test suite, type checker, linter or grep can settle a question, run
  it instead of asking an agent's opinion.
- **No silent caps.** Anything that bounds coverage (top-N, sampling, skipped items, agents that returned `null`) is
  `log()`ged during the run and named in the report.
- **Name for the progress view.** Phases are the steps of the approved plan, under the same names (`Stock`, not
  `1 Stock`: the view numbers phases itself), or the pipeline's stages when there is no plan. Agent labels read
  `<role>: <item>` in plain words, understandable without the plan (`verify: placement rules`, not `verify 5`). All
  names are in English; `meta.name` is a short kebab-case name, `meta.description` says in one sentence what the run
  produces.
- **Size to the work.** Agent count follows the amount of independent work, not the maximum available. The session's
  workflow size guideline does not bind this skill: don't split a job into several workflows to stay under it. Split
  only where the main session must check or decide something between parts.

## Report

Lead with the result. Then keep apart what was verified (name the check), what is believed but not checked, and what
is unknown or was left out, and why.
