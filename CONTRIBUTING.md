# Contributing

Issues and pull requests are welcome. Corrections to figures matter most.

## Report a mistake in a figure

Open an issue with:

1. The page URL.
2. The figure you think is wrong, and what you expected.
3. Your source, if you have one.

Corrections ship in a new data release, and its release notes say what
changed.

## Send a pull request

1. Follow the setup in the [README](README.md), then run
   `git config --local core.hooksPath .hk-hooks` once.
2. Read the guide in [AGENTS.md](AGENTS.md#task-guides) for the part you
   change.
3. Keep one change per pull request, with its tests.
4. Run `hk check --all` before you push. The pre-commit hook runs the same
   checks; do not bypass it.

Some rules hold for every change:

- Copy and figures follow the neutrality rules in
  [ADR 0004](docs/adr/0004-neutrality-and-honesty-rules.md). Tests check every
  page for banned words.
- Prose uses British English.
- A dependency with an install script needs an `allowBuilds` entry in
  `pnpm-workspace.yaml`. The maintainer decides whether it may run.
- The film's narration is recorded with a paid voice service. To change its
  words, open an issue instead of editing `src/film/script.json`.
- A change to how a number is computed, or a new decision with trade-offs,
  comes with an ADR ([docs/adr](docs/adr/README.md)).

By contributing, you agree that your code is released under the
[MIT licence](LICENSE).
