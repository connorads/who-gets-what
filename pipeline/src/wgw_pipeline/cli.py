"""`wgw-pipeline` command line: ingest, compile, release."""

from __future__ import annotations

import argparse
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="wgw-pipeline", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ingest = sub.add_parser("ingest", help="fetch sources into the raw cache and stage them")
    ingest.add_argument("--refresh", action="store_true", help="refetch even when a cached copy exists")
    ingest.add_argument("--offline", action="store_true", help="fail instead of fetching anything uncached")
    ingest.add_argument("--seed-from", type=Path, help="copy matching earlier downloads from this folder first")
    ingest.add_argument("--only", nargs="+", help="run only these ingest steps")

    compile_ = sub.add_parser("compile", help="build the canonical tables and the site data contract")
    compile_.add_argument("--release", help="release id YYYY-MM-DD.N (default: today's date, .1)")

    release = sub.add_parser("release", help="pack a compiled release and write data.lock.json")
    release.add_argument("--release", help="release id (default: the newest compiled release)")
    release.add_argument(
        "--publish",
        action="store_true",
        help="create the GitHub Release with gh; without it the command is printed, not run",
    )

    args = parser.parse_args(argv)
    if args.command == "ingest":
        from wgw_pipeline import ingest as step

        step.run(refresh=args.refresh, offline=args.offline, seed_from=args.seed_from, only=args.only)
    elif args.command == "compile":
        from wgw_pipeline.compile import build

        build.run(release=args.release)
    else:
        from wgw_pipeline import release as step

        step.run(release=args.release, publish=args.publish)


if __name__ == "__main__":
    main()
