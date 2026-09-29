# Contributing

## Referencing the origin of a non-obvious decision

The simulation core (`src/lib/game/tick/*`, `src/lib/game/integrity/*`, and
anywhere else a decision isn't self-evident from the code around it) already
does this informally: comments referencing "World Sim Phase N," a Priority
List item number, or a GitHub issue ("fixes #86"). This section
makes that convention explicit rather than leaving it to be picked up by
osmosis from existing comments.

**When a comment in the simulation core explains WHY, not WHAT** — a hidden
constraint, a subtle invariant, a workaround for a specific bug, a design
call that would otherwise look arbitrary — reference where that decision
came from, in whichever form is actually traceable:

- A GitHub issue: `issue #92`
- A commit that fixed something: `fixes #92` (matches this repo's existing
  commit-message convention, so `git log --grep` finds both at once)
- A named phase from the project plan: `Phase 0`, `Phase 1d`, `Phase 4`
- A `docs/ARCHITECTURE.md` Priority List or Fix Log entry, if there's no
  issue for it

Do **not** invent a new ticket-numbering scheme (e.g. `MYTH-076`) — this repo
tracks work in GitHub Issues already, and a second, parallel ID space would
just be one more thing to keep in sync with the first. Reference the real
issue number directly.

A comment doesn't need one of these tags to be worth writing — most WHY
comments in this codebase don't have one, and that's fine. The point isn't
"every comment must cite something," it's "when a comment already implies a
history (this was a bug, this was a deliberate tradeoff, this exists because
of a specific requirement), make that history findable" rather than leaving
a future reader to wonder whether it's safe to change.

## Closing issues from a pull request

GitHub closes an issue on merge only when the PR body contains a **closing
keyword** immediately before the number — `Closes #491`, `Fixes #487`,
`Resolves #498`. A bare `#491` is a *reference*: it adds a cross-link to that
issue's timeline, which looks almost identical in the UI and does nothing on
merge.

Two different ways to get this wrong, and only one of them is checkable.

**A comma-run after one keyword** — `Closes #436, #437, #438` — closes the
first number and silently drops the rest. That is #452, and it is caught:
`scripts/check-pr-closing-keywords.ts`, run by the `pr-closing-keywords`
workflow on open AND on body edit, fails the PR and prints the rewrite. The
daily `issue-hygiene` workflow is the backstop, comparing the tracker against
the docs.

**No keyword at all** is the other one, and nothing catches it. PR #511 closed
26 issues and listed every one as `**#491** — ...` in a summary section. The
keyword checker passed honestly — there were no closing references to
validate — the PR merged, and all 26 stayed open until someone noticed.

It cannot become a gate, because "mentions an issue without closing it" is
correct behaviour and the common case for any PR that explains its own
boundaries. #511 named #489, #490 and #508 specifically to say they were out
of scope, and referenced #500 because it did only part of it. A check that
flagged those would be wrong three times in one PR, and a check that is
routinely wrong is a check people learn to ignore.

So the defence is the template, not a gate. `.github/pull_request_template.md`
opens with a `Closes #` line before any prose. **Put the keywords there, one
per line, and keep the prose references separate:**

```
Closes #491
Closes #487
Closes #498

## What changed
The realtime channels were public (#491), ...
```

One per line is also what keeps the comma-run bug from reappearing.

The keywords have to be in the PR **body** — a closing keyword in a commit
message only fires for commits pushed to the default branch, which is not how
a squashed or merge-committed PR arrives.

When a PR closes only part of an issue, say which part in a comment on the
issue and leave it open. #511 did most of #500 and left the schema change to
#512; only #512 carried `Closes #500`.

## Everything else

See `docs/ARCHITECTURE.md` for the project's actual architecture, current
state, Fix Log and Priority List — this file is intentionally just the two
conventions above, not a general engineering guide. (`README.md` is setup and
quickstart only; it has never held any of those, which is how the 22
dangling citations in #424 came about — this line used to point there, and
so did the list of sanctioned targets above. `docReferences.test.ts` now
checks that every target named here, and every doc section cited from
`src/`, resolves to a real heading.)
