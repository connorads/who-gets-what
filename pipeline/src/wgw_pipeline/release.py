"""`wgw-pipeline release`: pack a compiled release as GitHub Release assets (ADR 0002).

Writes to `build/release/{release}/`:

- `site-data-{release}.tar.gz`: the `/data/{release}/` tree, members under `{release}/`.
- `canonical-{release}.tar.gz`: the canonical Parquet tables.
- `manifest-{release}.json`: the release manifest.

Archives are reproducible (sorted members, zero timestamps and owners), so a
rebuild of the same release has the same hash. `data.lock.json` at the
repository root pins the site asset by SHA-256.

Creating the GitHub Release is a remote write: without `--publish` the `gh`
command is printed and not run.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import shlex
import subprocess
import sys
import tarfile
from pathlib import Path

from wgw_pipeline.canonical.build import TABLES
from wgw_pipeline.paths import RELEASES, REPO_ROOT, SITE, canonical

REPO = "connorads/who-gets-what"
LOCK = REPO_ROOT / "data.lock.json"


def newest_release() -> str:
    releases = sorted(p.name for p in SITE.glob("*") if (p / "manifest.json").exists()) if SITE.exists() else []
    if not releases:
        raise SystemExit("no compiled release: run `pnpm run data:compile` first")
    return releases[-1]


def verify(root: Path) -> dict:
    """Check every file against the manifest; return the manifest."""
    manifest = json.loads((root / "manifest.json").read_text())
    listed = manifest["files"]
    on_disk = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} - {"manifest.json"}
    if set(listed) != on_disk:
        raise SystemExit(f"manifest and files differ: {sorted(set(listed) ^ on_disk)[:5]}")
    for rel, meta in listed.items():
        data = (root / rel).read_bytes()
        if len(data) != meta["bytes"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise SystemExit(f"{rel} does not match the manifest")
    return manifest


def reproducible_tar_gz(files: list[tuple[Path, str]], out: Path) -> str:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as tar:
        dirs = sorted({str(Path(arc).parent) for _, arc in files if str(Path(arc).parent) != "."})
        for d in dirs:
            info = tarfile.TarInfo(d)
            info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o755, 0
            tar.addfile(info)
        for path, arc in sorted(files, key=lambda f: f[1]):
            data = path.read_bytes()
            info = tarfile.TarInfo(arc)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))
    with out.open("wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        gz.write(buffer.getvalue())
    return hashlib.sha256(out.read_bytes()).hexdigest()


def run(release: str | None = None, publish: bool = False) -> None:
    release = release or newest_release()
    root = SITE / release
    manifest = verify(root)
    if manifest["release"] != release:
        raise SystemExit(f"manifest names release {manifest['release']}, not {release}")
    out = RELEASES / release
    out.mkdir(parents=True, exist_ok=True)

    site_asset = out / f"site-data-{release}.tar.gz"
    site_files = [(p, f"{release}/{p.relative_to(root).as_posix()}") for p in root.rglob("*") if p.is_file()]
    site_sha = reproducible_tar_gz(site_files, site_asset)

    canonical_asset = out / f"canonical-{release}.tar.gz"
    tables = [(canonical(name), f"canonical-{release}/{name}.parquet") for name in TABLES]
    reproducible_tar_gz(tables, canonical_asset)

    manifest_asset = out / f"manifest-{release}.json"
    manifest_asset.write_bytes((root / "manifest.json").read_bytes())

    lock = {"release": release, "tag": f"data-{release}", "asset": site_asset.name, "sha256": site_sha}
    LOCK.write_text(json.dumps(lock, indent=2) + "\n")

    command = [
        "gh",
        "release",
        "create",
        f"data-{release}",
        "--repo",
        REPO,
        "--title",
        f"Data {release}",
        "--notes",
        f"Data release {release}. Pipeline commit {manifest['pipelineCommit']}.",
        str(site_asset),
        str(canonical_asset),
        str(manifest_asset),
    ]
    print(f"packed {release}: {site_asset.name} sha256 {site_sha}", file=sys.stderr)
    print(f"wrote {LOCK.relative_to(REPO_ROOT)}", file=sys.stderr)
    if publish:
        subprocess.run(command, check=True)
    else:
        print("not published; to create the GitHub Release run:", file=sys.stderr)
        print(shlex.join(command))
