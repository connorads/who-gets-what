"""`wgw-pipeline compile`: canonical tables, then the site data contract for one release."""

from __future__ import annotations

import re
import sys
from datetime import date

from wgw_pipeline.canonical import build as canonical
from wgw_pipeline.compile import decomposition, emit, models, neighbours, values
from wgw_pipeline.paths import SITE

RELEASE_ID = re.compile(r"^\d{4}-\d{2}-\d{2}\.\d+$")


def default_release() -> str:
    return f"{date.today().isoformat()}.1"


def run(release: str | None = None) -> str:
    release = release or default_release()
    if not RELEASE_ID.match(release):
        raise SystemExit(f"release id must look like YYYY-MM-DD.N, not {release!r}")
    tables = canonical.run()
    expected = models.Expected(tables)
    computed = values.compute(tables, derive=expected.rows)
    root = SITE / release
    emit.write(root, release, tables, computed, decomposition.compute(tables), expected, neighbours.compute(tables))
    print(f"compiled release {release} into {root}", file=sys.stderr)
    return release
