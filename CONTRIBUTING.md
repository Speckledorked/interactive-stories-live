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

## Everything else

See `docs/ARCHITECTURE.md` for the project's actual architecture, current
state, Fix Log and Priority List — this file is intentionally just the one
convention above, not a general engineering guide. (`README.md` is setup and
quickstart only; it has never held any of those, which is how the 22
dangling citations in #424 came about — this line used to point there, and
so did the list of sanctioned targets above. `docReferences.test.ts` now
checks that every target named here, and every doc section cited from
`src/`, resolves to a real heading.)
