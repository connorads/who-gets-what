"""The archive of every download: complete, readable and byte-for-byte reproducible."""

import hashlib
import time
import zipfile
from pathlib import Path

from wgw_pipeline.compile.emit import write_archive


def _tables(folder: Path) -> None:
    folder.mkdir()
    (folder / "dim_area.csv").write_text("level,code\nconstituency,E14001063\n")
    (folder / "dim_area.parquet").write_bytes(b"PAR1 not really")
    (folder / "fact_spend_area-constituency-2024-25.csv").write_text("level,code\n")
    (folder / "notes.txt").write_text("left out")


def test_archive_holds_every_table_file_and_nothing_else(tmp_path: Path) -> None:
    folder = tmp_path / "downloads"
    _tables(folder)
    write_archive(folder, tmp_path / "all.zip")

    with zipfile.ZipFile(tmp_path / "all.zip") as archive:
        assert archive.namelist() == [
            "dim_area.csv",
            "dim_area.parquet",
            "fact_spend_area-constituency-2024-25.csv",
        ]
        assert archive.read("dim_area.csv") == (folder / "dim_area.csv").read_bytes()
        assert archive.testzip() is None


def test_archive_is_reproducible(tmp_path: Path) -> None:
    folder = tmp_path / "downloads"
    _tables(folder)
    write_archive(folder, tmp_path / "a.zip")
    time.sleep(2.1)  # zip timestamps have two-second resolution
    (folder / "dim_area.csv").touch()
    write_archive(folder, tmp_path / "b.zip")

    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    assert digest(tmp_path / "a.zip") == digest(tmp_path / "b.zip")
