#!/usr/bin/env python3
"""Remote review sources for diff-review: GitHub pull requests and GitLab merge requests.

Used by `collect.py --pr <ref>` and `publish.py`. It turns a PR reference into pull request metadata and a
local git repository that holds the PR commits, so that collect.py can run its usual range diff on them.

A reference is a PR/MR URL (`https://<host>/<owner>/<repo>/pull/N`, `https://<host>/<group>/<proj>/-/merge_requests/N`,
trailing `/files`, `/diffs`, a query or a fragment are fine) or a shorthand: `#N`, `!N`, `pr N`, `mr N`, and a bare `pr`
or `mr` for the PR/MR of the current branch. Shorthands are resolved against the `origin` remote of the repository.

`gh` and `glab` are used only for metadata, the viewer login, the cache clone and publishing; commits arrive through
plain `git fetch` of `refs/pull/N/head` (GitHub) or `refs/merge-requests/N/head` (GitLab). The user's working tree,
index and branches are never touched. Standard library only.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

GITHUB, GITLAB = "github", "gitlab"
BODY_LIMIT = 20000
INSTALL_URL = {"gh": "https://cli.github.com", "glab": "https://gitlab.com/gitlab-org/cli"}
CLI_BY_PROVIDER = {GITHUB: "gh", GITLAB: "glab"}
GH_FIELDS = "number,title,author,state,isDraft,baseRefName,headRefName,baseRefOid,headRefOid,url,body"


class RemoteError(Exception):
    """A problem with the PR reference, the CLI, the network or the commits. collect.py reports it as exit 2."""


# --- running commands -------------------------------------------------------------------------------------------


def run(argv, *, input_text=None, cwd=None, env=None):
    """Run a command; returns (returncode, stdout, stderr). A missing executable raises RemoteError with a hint."""
    try:
        res = subprocess.run(
            argv,
            input=input_text.encode() if input_text is not None else None,
            stdin=None if input_text is not None else subprocess.DEVNULL,
            capture_output=True,
            cwd=cwd,
            env=env,
        )
    except FileNotFoundError:
        name = argv[0]
        raise RemoteError(f"`{name}` is not installed. Install it: {INSTALL_URL.get(name, name)}") from None
    return res.returncode, res.stdout.decode(errors="replace"), res.stderr.decode(errors="replace")


def trim(text, limit=2000):
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit] + "…"


def cli_failure(cli, host, what, stdout, stderr):
    """RemoteError for a failed gh/glab call: tells not authenticated, not found and the rest apart."""
    text = f"{stderr}\n{stdout}"
    low = text.lower()
    if any(s in low for s in ("auth login", "not logged in", "401", "bad credentials", "no token", "unauthenticated")):
        return RemoteError(
            f"`{cli}` is not authenticated for {host}. Run `{cli} auth login --hostname {host}` and retry."
        )
    if any(
        s in low for s in ("could not resolve to a", "404", "not found", "no pull requests found", "no merge request")
    ):
        return RemoteError(
            f"{what} was not found, or you have no access to it ({cli} on {host}). "
            "Check the reference and that the authenticated account can see the repository."
        )
    return RemoteError(f"`{cli}` failed while {what}: {trim(stderr or stdout, 600)}")


def call_json(cli, host, what, args, *, cwd=None, env=None):
    rc, stdout, stderr = run([cli, *args], cwd=cwd, env=env)
    if rc != 0:
        raise cli_failure(cli, host, what, stdout, stderr)
    try:
        return json.loads(stdout)
    except ValueError:
        raise RemoteError(f"`{cli}` returned unexpected output while {what}: {trim(stdout, 200)}") from None


# --- remote URLs and PR references ------------------------------------------------------------------------------


def split_remote_url(url):
    """(host, path) of a git remote URL, or None for a local path. ssh ports and user info are dropped; the path has
    no leading slash, no trailing slash and no `.git`."""
    url = (url or "").strip()
    if "://" in url:
        parts = urlsplit(url)
        if parts.scheme == "file" or not parts.hostname:
            return None
        host = parts.hostname.lower()
        if parts.scheme in ("http", "https") and parts.port:
            host = f"{host}:{parts.port}"
        path = unquote(parts.path)
    else:
        m = re.fullmatch(r"(?:[^@/\s]+@)?([^:/\s]+):(.+)", url)  # scp-like: git@host:group/proj.git
        if not m:
            return None
        host, path = m.group(1).lower(), m.group(2)
    path = path.strip("/").removesuffix(".git").strip("/")
    return (host, path) if host and path else None


def same_repo(a, b):
    """Whether two (host, path) pairs name the same repository: hosts and paths compare case-insensitively."""
    return bool(a and b) and a[0].lower() == b[0].lower() and a[1].lower() == b[1].lower()


class Ref:
    """A parsed PR reference. host/repo are None for a shorthand; number is None for the current branch."""

    def __init__(self, number=None, host=None, repo=None, provider=None):
        self.number, self.host, self.repo, self.provider = number, host, repo, provider


REF_HELP = "expected a PR/MR URL, `#N`, `!N`, `pr N`, `mr N`, or a bare `pr` / `mr` for the current branch"


def parse_ref(text):
    text = (text or "").strip()
    if re.match(r"https?://", text, re.I):
        return parse_url(text)
    m = re.fullmatch(r"#(\d+)", text)
    if m:
        return Ref(number=int(m.group(1)))
    m = re.fullmatch(r"!(\d+)", text)
    if m:
        return Ref(number=int(m.group(1)), provider=GITLAB)
    m = re.fullmatch(r"(pr|mr)(?:\s+#?!?(\d+))?", text, re.I)
    if m:
        return Ref(
            number=int(m.group(2)) if m.group(2) else None, provider=GITLAB if m.group(1).lower() == "mr" else None
        )
    raise RemoteError(f"cannot parse the PR reference `{text}`: {REF_HELP}.")


def parse_url(url):
    parts = urlsplit(url)
    host = parts.netloc.rpartition("@")[2].lower()  # drop user info
    path = unquote(parts.path)
    m = re.fullmatch(r"/(?P<repo>[^/]+/[^/]+)/pull/(?P<n>\d+)(?:/.*)?", path)
    if m:
        return Ref(int(m.group("n")), host, m.group("repo").removesuffix(".git"), GITHUB)
    m = re.fullmatch(r"/(?P<repo>.+?)/(?:-/)?merge_requests/(?P<n>\d+)(?:/.*)?", path)
    if m:
        return Ref(int(m.group("n")), host, m.group("repo"), GITLAB)
    raise RemoteError(f"`{url}` is not a PR or MR URL: {REF_HELP}.")


class Target:
    """What to review: provider, host, repo path and number."""

    def __init__(self, provider, host, repo, number):
        self.provider, self.host, self.repo, self.number = provider, host, repo, number

    @property
    def cli(self):
        return CLI_BY_PROVIDER[self.provider]

    @property
    def project_id(self):
        return quote(self.repo, safe="")

    def mr_path(self):
        return f"projects/{self.project_id}/merge_requests/{self.number}"


def git_run(root, *args, env=None):
    return run(["git", "-C", str(root), *args], env=env)


def is_git_repo(path):
    path = Path(path)
    return path.is_dir() and git_run(path, "rev-parse", "--git-dir")[0] == 0


def list_remotes(repo_dir):
    """[(name, [(host, path), ...])] of the repository remotes, `origin` first. The URL as configured comes first;
    the one after `url.<base>.insteadOf` rewriting follows when it differs."""
    rc, names, _ = git_run(repo_dir, "remote")
    names = names.split() if rc == 0 else []
    names.sort(key=lambda n: n != "origin")
    result = []
    for name in names:
        raw = git_run(repo_dir, "config", "--get", f"remote.{name}.url")[1].strip()
        rewritten = git_run(repo_dir, "remote", "get-url", name)[1].strip()
        found = [hp for hp in (split_remote_url(raw), split_remote_url(rewritten)) if hp]
        result.append((name, list(dict.fromkeys(found))))
    return result


def glab_knows_host(host):
    try:
        return run(["glab", "auth", "status", "--hostname", host])[0] == 0
    except RemoteError:  # glab is not installed: this is not a GitLab host for this user
        return False


def choose_provider(host, hint):
    if hint:
        return hint
    if host == "github.com":
        return GITHUB
    return GITLAB if glab_knows_host(host) else GITHUB


def current_branch_number(provider, host, repo_dir):
    """Number of the PR/MR of the checked-out branch, via gh / glab run inside the repository."""
    env = {**os.environ, "GH_HOST": host} if provider == GITHUB and host != "github.com" else None
    if provider == GITHUB:
        data = call_json(
            "gh",
            host,
            "looking up the PR of the current branch",
            ["pr", "view", "--json", "number"],
            cwd=repo_dir,
            env=env,
        )
        number = data.get("number")
    else:
        data = call_json(
            "glab", host, "looking up the MR of the current branch", ["mr", "view", "-F", "json"], cwd=repo_dir, env=env
        )
        number = data.get("iid")
    if not isinstance(number, int):
        raise RemoteError("the current branch has no PR/MR. Pass a number or a URL instead.")
    return number


def resolve(text, repo_dir):
    """Target for a reference. Shorthands use the origin remote (else the first remote) of repo_dir."""
    ref = parse_ref(text)
    if ref.host:
        return Target(ref.provider, ref.host, ref.repo, ref.number)
    remotes = list_remotes(repo_dir) if is_git_repo(repo_dir) else []
    remote = next(((n, hps[0]) for n, hps in remotes if hps), None)
    if not remote:
        raise RemoteError(
            f"`{text.strip()}` needs a git repository with a remote to tell which repository it belongs to. "
            "Run from inside the clone (or pass --repo), or pass the full PR/MR URL."
        )
    host, repo = remote[1]
    provider = choose_provider(host, ref.provider)
    number = ref.number or current_branch_number(provider, host, repo_dir)
    return Target(provider, host, repo, number)


# --- metadata ---------------------------------------------------------------------------------------------------


def clip_body(text):
    text = text or ""
    return text if len(text) <= BODY_LIMIT else text[:BODY_LIMIT] + "\n\n…"


def github_viewer(host):
    rc, stdout, _ = run(["gh", "api", "--hostname", host, "user", "--jq", ".login"])
    return stdout.strip() or None if rc == 0 else None


def gitlab_viewer(host):
    rc, stdout, _ = run(["glab", "api", "--hostname", host, "user"])
    if rc != 0:
        return None
    try:
        return json.loads(stdout).get("username") or None
    except (ValueError, AttributeError):
        return None


def fetch_github(t):
    what = f"reading PR #{t.number} of {t.host}/{t.repo}"
    d = call_json("gh", t.host, what, ["pr", "view", str(t.number), "-R", f"{t.host}/{t.repo}", "--json", GH_FIELDS])
    return {
        "provider": GITHUB,
        "host": t.host,
        "repo": t.repo,
        "number": t.number,
        "url": d.get("url") or f"https://{t.host}/{t.repo}/pull/{t.number}",
        "title": d.get("title") or "",
        "author": (d.get("author") or {}).get("login"),
        "state": {"OPEN": "open", "CLOSED": "closed", "MERGED": "merged"}.get(str(d.get("state")).upper(), "open"),
        "draft": bool(d.get("isDraft")),
        "baseRef": d.get("baseRefName"),
        "headRef": d.get("headRefName"),
        "baseSha": d.get("baseRefOid"),
        "headSha": d.get("headRefOid"),
        "startSha": None,
        "mergeBaseSha": None,  # filled in once the commits are local
        "body": clip_body(d.get("body")),
        "viewer": github_viewer(t.host),
    }


def fetch_gitlab(t):
    what = f"reading MR !{t.number} of {t.host}/{t.repo}"
    d = call_json("glab", t.host, what, ["api", "--hostname", t.host, t.mr_path()])
    refs = d.get("diff_refs") or {}
    if not (refs.get("base_sha") and refs.get("head_sha")):
        raise RemoteError(
            "MR has no diff refs — it may have been merged and its source branch deleted. "
            f"Nothing to review on {t.host}/{t.repo}!{t.number}."
        )
    state = {"opened": "open", "closed": "closed", "merged": "merged", "locked": "open"}.get(d.get("state"), "open")
    return {
        "provider": GITLAB,
        "host": t.host,
        "repo": t.repo,
        "number": t.number,
        "url": d.get("web_url") or f"https://{t.host}/{t.repo}/-/merge_requests/{t.number}",
        "title": d.get("title") or "",
        "author": (d.get("author") or {}).get("username"),
        "state": state,
        "draft": bool(d.get("draft") or d.get("work_in_progress")),
        "baseRef": d.get("target_branch"),
        "headRef": d.get("source_branch"),
        "baseSha": refs["base_sha"],
        "headSha": refs["head_sha"],
        "startSha": refs.get("start_sha"),
        "mergeBaseSha": refs["base_sha"],
        "body": clip_body(d.get("description")),
        "viewer": gitlab_viewer(t.host),
    }


def fetch_metadata(t):
    return fetch_github(t) if t.provider == GITHUB else fetch_gitlab(t)


# --- commits ----------------------------------------------------------------------------------------------------

NO_LAZY = {**os.environ, "GIT_NO_LAZY_FETCH": "1"}  # object checks must not hit the network of a partial clone


def has_commit(root, sha):
    return bool(sha) and git_run(root, "cat-file", "-e", f"{sha}^{{commit}}", env=NO_LAZY)[0] == 0


def head_ref(pr):
    return f"refs/pull/{pr['number']}/head" if pr["provider"] == GITHUB else f"refs/merge-requests/{pr['number']}/head"


def cache_dir(host, repo):
    parts = [host.replace(":", "_"), *repo.split("/")]
    if any(p in ("", ".", "..") for p in parts):
        raise RemoteError(f"refusing to cache a clone of `{host}/{repo}`: unsafe path")
    return Path(tempfile.gettempdir(), "diff-review", "repos", *parts)


def cache_clone(pr):
    """Path of the cache clone (blobless, no checkout), created on first use."""
    dest = cache_dir(pr["host"], pr["repo"])
    if (dest / ".git").exists():
        return dest
    if dest.exists():  # leftovers of an interrupted clone
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    flags = ["--", "--no-checkout", "--filter=blob:none"]
    if pr["provider"] == GITHUB:
        argv, env = ["gh", "repo", "clone", f"{pr['host']}/{pr['repo']}", str(dest), *flags], None
    else:
        argv, env = ["glab", "repo", "clone", pr["repo"], str(dest), *flags], {**os.environ, "GITLAB_HOST": pr["host"]}
    rc, stdout, stderr = run(argv, env=env)
    if rc != 0:
        shutil.rmtree(dest, ignore_errors=True)
        raise cli_failure(argv[0], pr["host"], f"cloning {pr['host']}/{pr['repo']}", stdout, stderr)
    return dest


def local_clone(pr, repo_dir):
    """(root, remote name) of the user's repository when one of its remotes is the PR repository, else None."""
    if not is_git_repo(repo_dir):
        return None
    want = (pr["host"], pr["repo"])
    for name, hps in list_remotes(repo_dir):
        if any(same_repo(hp, want) for hp in hps):
            _, top, _ = git_run(repo_dir, "rev-parse", "--show-toplevel")
            return Path(top.strip()), name
    return None


def git_fetch(root, remote, refs):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    args = ["-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "--no-tags", "--no-recurse-submodules"]
    # An empty --refmap stops git from updating remote-tracking branches: only FETCH_HEAD and objects change.
    return git_run(root, *args, "--refmap=", remote, *refs, env=env)


def ensure_commits(pr, repo_dir):
    """Make baseSha/headSha available locally; returns the repository root. Sets pr["mergeBaseSha"] for GitHub."""
    found = local_clone(pr, repo_dir)
    root, remote = found if found else (cache_clone(pr), "origin")
    head_ok = has_commit(root, pr["headSha"])
    base_ok = has_commit(root, pr["baseSha"])
    # GitLab's base_sha is an ancestor of the head, so the head ref brings it along.
    if not head_ok or (pr["provider"] == GITHUB and not base_ok):
        wanted = []
        if not head_ok:
            wanted.append(head_ref(pr))
        base_variants = []
        if pr["provider"] == GITHUB and not base_ok:
            base_variants = [[pr["baseSha"]], [pr["baseRef"]] if pr["baseRef"] else []]
        for base in base_variants or [[]]:
            rc, _, stderr = git_fetch(root, remote, [*base, *wanted])
            if rc == 0:
                break
        else:
            raise RemoteError(
                f"git fetch from `{remote}` failed: {trim(stderr, 600)}. "
                "Check network access and git credentials (for GitHub: `gh auth setup-git`)."
            )
    for label, sha in (("head", pr["headSha"]), ("base", pr["baseSha"])):
        if not has_commit(root, sha):
            raise RemoteError(
                f"the PR {label} commit {sha} is not available after fetching "
                f"(the branch may have been force-pushed or deleted). Repository: {root}"
            )
    if pr["provider"] == GITHUB:
        rc, out, err = git_run(root, "merge-base", pr["baseSha"], pr["headSha"], env=NO_LAZY)
        if rc != 0 or not out.strip():
            raise RemoteError(f"no merge base between {pr['baseSha'][:10]} and {pr['headSha'][:10]}: {trim(err, 300)}")
        pr["mergeBaseSha"] = out.strip()
    return root


def prepare(text, repo_dir):
    """Resolve a reference and return (root, pr) where pr is the meta.json `pr` object and root holds its commits."""
    target = resolve(text, repo_dir)
    pr = fetch_metadata(target)
    root = ensure_commits(pr, repo_dir)
    return root, pr
