"""Spreadsheet reading through calamine: ODS, XLSX and legacy XLS, fast and without LibreOffice."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from python_calamine import CalamineWorkbook


class Workbook:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._book = CalamineWorkbook.from_path(str(path))

    @property
    def sheet_names(self) -> list[str]:
        return list(self._book.sheet_names)

    def rows(self, sheet: str) -> list[list[object]]:
        """Raw cell values; empty cells are None."""
        return [[None if c == "" else c for c in row] for row in self._book.get_sheet_by_name(sheet).to_python()]

    def frame(self, sheet: str) -> pd.DataFrame:
        """The sheet as an object-dtype DataFrame with integer column labels and no header."""
        rows = self.rows(sheet)
        width = max((len(r) for r in rows), default=0)
        return pd.DataFrame([r + [None] * (width - len(r)) for r in rows], dtype=object)


def number(value: object) -> float | None:
    """A float, or None for blanks and markers such as '-', '[c]', '..' or '[x]'."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if pd.isna(value) else float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def is_marker(value: object) -> bool:
    """True for a non-numeric, non-empty cell: a suppression or not-available marker."""
    return value is not None and number(value) is None and str(value).strip() != ""
