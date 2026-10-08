"""Raw download cache keyed by request and retrieval date.

Layout: `build/raw/{source}/{key}/{YYYY-MM-DD}.{ext}` with a
`{YYYY-MM-DD}.meta.json` sidecar holding the URL, retrieval date, the publisher's file date (HTTP
Last-Modified) and the SHA-256. A lookup returns the newest retrieval; a
refresh writes a new dated file beside the old ones, so earlier retrievals
stay reproducible.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

from wgw_pipeline.paths import RAW

USER_AGENT = "Mozilla/5.0 (compatible; wgw-pipeline/0.1; +https://github.com/connorads/who-gets-what)"


@dataclass(frozen=True)
class RawFile:
    source: str
    url: str
    path: Path
    retrieved: date
    last_modified: date | None
    sha256: str

    def read_bytes(self) -> bytes:
        return self.path.read_bytes()

    def read_json(self) -> object:
        return json.loads(self.path.read_text(encoding="utf-8"))


def url_key(url: str) -> str:
    """A readable, collision-safe directory name for a URL."""
    tail = re.sub(r"[^A-Za-z0-9._-]+", "-", url.rstrip("/").rsplit("/", 1)[-1])[:48].strip("-")
    return f"{tail or 'index'}-{hashlib.sha1(url.encode()).hexdigest()[:10]}"


def _last_modified(headers: requests.structures.CaseInsensitiveDict[str]) -> date | None:
    value = headers.get("Last-Modified")
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).date()
    except TypeError, ValueError:
        return None


class RawCache:
    """Fetch-once cache. Every file handed out is also recorded in `ledger`."""

    def __init__(self, root: Path = RAW, *, refresh: bool = False, offline: bool = False) -> None:
        self.root = root
        self.refresh = refresh
        self.offline = offline
        self.ledger: list[RawFile] = []
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    # -------------------------------------------------------------- storage

    def _dir(self, source: str, key: str) -> Path:
        return self.root / source / key

    def latest(self, source: str, key: str) -> RawFile | None:
        folder = self._dir(source, key)
        if not folder.is_dir():
            return None
        metas = sorted(folder.glob("*.meta.json"))
        for meta_path in reversed(metas):
            meta = json.loads(meta_path.read_text())
            data = folder / meta["file"]
            if data.exists():
                return RawFile(
                    source=source,
                    url=meta["url"],
                    path=data,
                    retrieved=date.fromisoformat(meta["retrieved"]),
                    last_modified=date.fromisoformat(meta["lastModified"]) if meta.get("lastModified") else None,
                    sha256=meta["sha256"],
                )
        return None

    def put(
        self,
        source: str,
        key: str,
        url: str,
        content: bytes,
        ext: str,
        *,
        retrieved: date | None = None,
        last_modified: date | None = None,
    ) -> RawFile:
        retrieved = retrieved or datetime.now(UTC).date()
        folder = self._dir(source, key)
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{retrieved.isoformat()}.{ext}"
        (folder / name).write_bytes(content)
        sha = hashlib.sha256(content).hexdigest()
        meta = {
            "url": url,
            "file": name,
            "retrieved": retrieved.isoformat(),
            "lastModified": last_modified.isoformat() if last_modified else None,
            "sha256": sha,
            "bytes": len(content),
        }
        (folder / f"{retrieved.isoformat()}.meta.json").write_text(json.dumps(meta, indent=1))
        return RawFile(source, url, folder / name, retrieved, last_modified, sha)

    def seed(
        self, source: str, key: str, url: str, local: Path, ext: str, *, last_modified: date | None = None
    ) -> RawFile | None:
        """Copy a previously downloaded copy of `url` into the cache unless one exists."""
        existing = self.latest(source, key)
        if existing is not None:
            return existing
        retrieved = datetime.fromtimestamp(local.stat().st_mtime, UTC).date()
        folder = self._dir(source, key)
        folder.mkdir(parents=True, exist_ok=True)
        name = f"{retrieved.isoformat()}.{ext}"
        shutil.copyfile(local, folder / name)
        content = (folder / name).read_bytes()
        meta = {
            "url": url,
            "file": name,
            "retrieved": retrieved.isoformat(),
            "lastModified": last_modified.isoformat() if last_modified else None,
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
            "seededFrom": "prototype exploration download",
        }
        (folder / f"{retrieved.isoformat()}.meta.json").write_text(json.dumps(meta, indent=1))
        return self.latest(source, key)

    # ------------------------------------------------------------- fetching

    def get(
        self,
        source: str,
        key: str,
        url: str,
        ext: str,
        fetcher: Callable[[], tuple[bytes, date | None]],
    ) -> RawFile:
        cached = None if self.refresh else self.latest(source, key)
        if cached is None:
            if self.offline:
                raise RuntimeError(f"offline and not cached: {source} {url}")
            content, last_modified = fetcher()
            cached = self.put(source, key, url, content, ext, last_modified=last_modified)
        self.ledger.append(cached)
        return cached

    def fetch(
        self,
        source: str,
        url: str,
        *,
        ext: str,
        key: str | None = None,
        params: dict[str, object] | None = None,
        timeout: int = 300,
    ) -> RawFile:
        """GET a URL through the cache, retrying transient failures."""
        full = requests.Request("GET", url, params=params).prepare().url or url

        def fetcher() -> tuple[bytes, date | None]:
            response = self.request("GET", full, timeout=timeout)
            return response.content, _last_modified(response.headers)

        return self.get(source, key or url_key(full), full, ext, fetcher)

    def request(self, method: str, url: str, *, timeout: int = 300, **kwargs: object) -> requests.Response:
        delay = 5.0
        for attempt in range(6):
            try:
                response = self.session.request(method, url, timeout=timeout, **kwargs)
            except requests.RequestException as error:
                if attempt == 5:
                    raise
                print(f"  retry {url}: {error}", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == 5:
                    response.raise_for_status()
                wait = float(response.headers.get("Retry-After", delay))
                print(f"  {response.status_code} from {url}; waiting {wait:.0f}s", file=sys.stderr)
                time.sleep(wait)
                delay *= 2
                continue
            response.raise_for_status()
            return response
        raise RuntimeError(f"unreachable: {url}")
