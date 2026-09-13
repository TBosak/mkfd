# Releasing

Adopted for v3 and onward, replacing the `deploy` branch.

## How to release

From `main` (or the active release branch), with `package.json` already at the
version you intend to publish:

```bash
git tag v3.0.0
git push origin v3.0.0
```

That is the whole release. The tag push triggers
`.github/workflows/docker-deploy.yml`, which builds `linux/amd64` and
`linux/arm64` and publishes:

| Tag pushed | Images published | Moves `:latest` |
|---|---|---|
| `v3.0.0` | `3.0.0` on Docker Hub + GHCR | yes |
| `v3.0.0-rc.1` | `3.0.0-rc.1` on Docker Hub + GHCR | **no** |
| *(manual dispatch)* | the version you name | **no** |

Anything containing a hyphen is treated as a pre-release, so release candidates
and betas publish normally but never move the pointer most users pull.

## The version guard

The workflow refuses to build when the tag and `package.json` disagree:

```
Tag v3.0.1 does not match package.json version 3.0.0.
Bump package.json to 3.0.1, or retag to v3.0.0.
```

This is the point of the tag scheme. Under the old `deploy` branch the image tag
was read from `package.json` at merge time, so bumping the version and
publishing were two separate manual steps. Forgetting the bump silently
republished an existing tag with a different image — which nearly happened with
the Debian base-image hotfix, where `2.1.2` would have been overwritten with a
materially different image (bun 1.3.14 on trixie in place of bun 1.2.2 on
bullseye) under a tag users reasonably assume is immutable.

The guard runs **before** the registry logins, so a mismatched tag fails without
exchanging any credential.

## Republishing or rebuilding a version

Use the workflow's `workflow_dispatch` with an explicit `version`. It publishes
that tag only and never touches `:latest`, which makes it safe for smoke-testing
a published image before promoting anything.

Note that a manual dispatch with no version also no longer moves `:latest`.
`:latest` moves only on a real, non-pre-release tag push — it should never be a
side effect of a button.

## Why not the `deploy` branch

`deploy` was a button shaped like a branch. Across eleven merges it never
diverged from `main`, never merged back, and carried no file changes of its own
— `git diff $(git merge-base main deploy) deploy` was empty. Its only function
was to fire the publish workflow.

What it cost:

- A `deploy -> main` pull request always shows zero changes, because deploy
  contributes nothing back. That reversed direction was opened and closed at
  least twice (PR #75, and again during the base-image hotfix).
- The version and the publish were decoupled, as described above.
- Releases were not reproducible from a ref: "what shipped as 2.1.2" was only
  recoverable by reading through deploy's merge commits.

Tags fix all three, with less machinery rather than more.

## Retired

`docker-test.yml` published `test-latest` and `test-<version>` on pushes to a
`test` branch. That branch does not exist on the remote, so the workflow had
never run. Pre-release tags (`v3.0.0-rc.1`) now cover the same need through the
one release workflow, so it was removed rather than repointed.

The `deploy` branch itself is left in place but is no longer a trigger. It can
be deleted once v2 is no longer maintained from it.
