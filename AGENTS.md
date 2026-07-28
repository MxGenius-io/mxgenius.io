# MXGenius Repository Working Rules

## One-branch workflow

This repository is developed concurrently from multiple threads and programs.
The owner requires one continuous shared branch so work does not leave dangling
branches, pull requests, or reconciliation work behind.

- Work directly on the branch that is checked out when the task begins. The
  normal shared branch is `main`.
- Do not create or switch to a safety branch, feature branch, worktree, fork,
  or pull request unless the user explicitly requests that exact workflow.
- A generic request to implement, publish, push, deploy, or "run it top to
  bottom" is not permission to create a branch or pull request.
- Make narrowly scoped commits and push the active branch directly to its
  configured upstream.
- Before pushing, verify the active branch, upstream, and remote URL. The live
  repository is `https://github.com/MxGenius-io/mxgenius.io.git`; the remote
  alias may change, so trust the URL rather than a remembered alias.
- After pushing, leave the working tree clean and the local branch synchronized
  with its upstream. Do not leave temporary local or remote branches or open
  pull requests.
- If platform policy or tooling would require a branch or pull request, stop
  before creating it and explain the conflict to the user.

## Credential and platform boundaries

- Use the MXGenius GitHub credential configured in `D:\AAog\.env` when GitHub
  authorization is required. Never print or commit its value.
- A limitation uploading source to Azure applies only to the Azure upload path.
  Never infer that it restricts GitHub pushes.
- Azure source-upload failures should be handed off through Azure Cloud Shell
  without altering the one-branch Git workflow.
