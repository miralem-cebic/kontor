# Contributing to kontor

Thank you for taking the time to contribute. This document describes how to propose changes, what we expect from a pull request, and how releases are made.

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report bugs** using the [bug report template](https://github.com/miralem-cebic/kontor/issues/new?template=bug_report.yml).
- **Suggest features** using the [feature request template](https://github.com/miralem-cebic/kontor/issues/new?template=feature_request.yml).
- **Improve documentation**, typos and unclear wording included.
- **Submit code** via pull requests.

For security issues, do not open a public issue. See [SECURITY.md](SECURITY.md).

## Workflow

`main` is protected. Every change reaches it through a pull request:

1. **Discuss first** for anything larger than a small fix. Open an issue or comment on an existing one.
2. **Fork** the repository (or create a branch if you have write access).
3. **Create a branch** with a descriptive name, for example `feat/invoice-pdf` or `fix/iban-spaces`.
4. **Make your change** and keep it focused. One pull request should solve one problem.
5. **Commit** using [Conventional Commits](#commit-messages).
6. **Open a pull request** against `main` and fill in the template.
7. **Pass all checks.** CI must be green before a pull request can be merged.
8. **Get a review.** At least one maintainer approval is required.
9. **Merge.** We use squash merges, so the pull request title becomes the commit message on `main`.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). The pull request title must follow the same format, because it becomes the commit message after a squash merge and is used for release notes.

```text
<type>(<optional scope>): <short summary>
```

Allowed types:

| Type       | What it is for                               |
| ---------- | -------------------------------------------- |
| `feat`     | A new feature                                |
| `fix`      | A bug fix                                    |
| `docs`     | Documentation only                           |
| `refactor` | Restructuring code without changing behavior |
| `perf`     | Performance improvement                      |
| `test`     | Adding or fixing tests                       |
| `build`    | Build system or dependency changes           |
| `ci`       | CI configuration                             |
| `style`    | Formatting only, no logic change             |
| `chore`    | Maintenance that does not fit elsewhere      |
| `revert`   | Reverting a previous commit                  |

Breaking changes are marked with `!` after the type (for example `feat!: change data file format`) and explained in the pull request body.

Examples:

- `feat(invoices): issue an invoice and write its PDF`
- `fix(storage): handle files locked by OneDrive sync`
- `docs: explain how to share a company folder with a tax advisor`

## Coding guidelines

Set up the project and run the same checks as CI before you push (see [DEVELOPMENT.md](DEVELOPMENT.md) for details):

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run check:file
npm run test:e2e
```

- Keep changes small and focused. Avoid unrelated refactoring in the same pull request.
- Match the style of the surrounding code and existing naming conventions.
- Add or update tests for behavior you change.
- Update the documentation when behavior changes.
- Do not commit generated files, secrets, or local configuration. The `.gitignore` covers the common cases.
- Editor settings are shared via [`.editorconfig`](.editorconfig).
- Code, comments, log messages and tests are in English. The user interface is German first and also English (`src/i18n/messages.ts`); every new text needs both.
- Money is integer cents, never a float (see `src/domain/money.ts` and ADR 0003). Tax parameters that change by year live in `src/domain/tax/params/<year>.ts` with their legal source.
- The rules for data, finance and the `file://` build are listed in [CLAUDE.md](CLAUDE.md). They apply to every change.

## Pull request checklist

Before requesting a review, make sure that:

- [ ] The PR title follows Conventional Commits.
- [ ] Tests pass locally and in CI.
- [ ] New behavior is covered by tests.
- [ ] Documentation and the changelog are updated where relevant (`## [Unreleased]` in `CHANGELOG.md`).
- [ ] Breaking changes are called out in the description.

## Labels

Labels are used to sort the release notes automatically (see [`.github/release.yml`](.github/release.yml)):

| Label                         | Release notes section |
| ----------------------------- | --------------------- |
| `breaking-change`             | Breaking changes      |
| `enhancement`, `feature`      | Features              |
| `bug`                         | Bug fixes             |
| `documentation`               | Documentation         |
| `chore`, `dependencies`, `ci` | Maintenance           |
| `ignore-for-release`          | Excluded from notes   |

## Releasing

Releases are created by maintainers. A release is published when a version tag is pushed.

1. Make sure `main` is green and all planned changes are merged.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty `## [Unreleased]` section above it.
3. Merge that change through a pull request.
4. Create and push a tag on the resulting commit on `main`:

   ```bash
   git switch main && git pull
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

The [release workflow](.github/workflows/release.yml) then:

- refuses to release tags that do not point to a commit on `main`,
- builds the package and its SHA-256 checksum,
- publishes a GitHub release with the changelog section and the generated release notes.

Tags containing a hyphen (for example `v1.2.0-rc.1`) are published as pre-releases.

## Repository settings (maintainers)

These settings live in the GitHub UI and are not stored in the repository. Maintainers should configure them as follows.

**Branch protection or ruleset for `main`:**

- Require a pull request before merging, with at least 1 approving review.
- Dismiss stale approvals when new commits are pushed.
- Require status checks to pass: `pr-title`, `markdown-lint`, `e2e`, and `build / package`.
- Require branches to be up to date before merging.
- Require conversation resolution before merging.
- Require linear history and allow only squash merges.
- Block force pushes and deletions.

**Tag ruleset for `v*`:** restrict tag creation to maintainers so that only approved releases are published.

**Other settings:**

- Enable private vulnerability reporting under *Security*.
- Enable automatic deletion of head branches after merge.
- Set the repository description, website, and topics.

## Questions

Not sure about something? Open a [discussion](https://github.com/miralem-cebic/kontor/discussions) or an issue. There are no bad questions.
