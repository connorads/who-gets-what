"""The raw download cache."""

from __future__ import annotations

from datetime import date

from wgw_pipeline.cache import RawCache, url_key


def test_url_keys_are_readable_and_stable() -> None:
    assert url_key("https://example.org/a/b.ods").startswith("b.ods-")
    assert url_key("https://example.org/a/b.ods") == url_key("https://example.org/a/b.ods")


def test_raw_cache_returns_the_newest_retrieval(tmp_path) -> None:
    cache = RawCache(tmp_path)
    cache.put("s", "k", "https://example.org/x", b"old", "txt", retrieved=date(2026, 1, 1))
    cache.put(
        "s", "k", "https://example.org/x", b"new", "txt", retrieved=date(2026, 2, 1), last_modified=date(2026, 1, 30)
    )

    latest = cache.latest("s", "k")

    assert latest is not None and latest.read_bytes() == b"new"
    assert latest.retrieved == date(2026, 2, 1) and latest.last_modified == date(2026, 1, 30)
    offline = RawCache(tmp_path, offline=True)
    assert offline.get("s", "k", "https://example.org/x", "txt", lambda: (b"", None)).read_bytes() == b"new"
