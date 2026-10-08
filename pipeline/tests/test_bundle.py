"""The TADB writer agrees with the TypeScript reader's golden fixture."""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from wgw_pipeline.compile import bundle


def golden(fixtures_dir) -> tuple[dict, bytes]:
    fixture = json.loads((fixtures_dir / "series-mini.json").read_text())
    expected = bytes.fromhex((fixtures_dir / "series-mini.bin.hex").read_text().strip())
    return fixture, expected


def encode_fixture(fixture: dict) -> bytes:
    header = {k: v for k, v in fixture["header"].items() if k != "sections"}
    values = np.array([math.nan if v is None else v for v in fixture["values"]], dtype=np.float32)
    flags = np.array(fixture["flags"], dtype=np.uint8)
    return bundle.encode(header, [("values", "f32", values), ("flags", "u8", flags)])


def split(data: bytes) -> tuple[bytes, dict, bytes]:
    length = int.from_bytes(data[8:12], "little")
    return data[:8], json.loads(data[12 : 12 + length]), data[12 + length :]


def section_bytes(data: bytes) -> bytes:
    """Section payloads with the alignment padding removed."""
    _header, arrays = bundle.decode(data)
    return b"".join(a.tobytes() for a in arrays)


def test_magic_version_and_sections_match_the_golden_encoding(fixtures_dir) -> None:
    fixture, expected = golden(fixtures_dir)
    ours = encode_fixture(fixture)

    assert ours[:8] == expected[:8]
    assert section_bytes(ours) == section_bytes(expected)


def test_header_parses_to_the_same_json(fixtures_dir) -> None:
    fixture, expected = golden(fixtures_dir)
    _, ours, _ = split(encode_fixture(fixture))
    _, theirs, _ = split(expected)

    assert ours == theirs == fixture["header"]


def test_sections_start_on_four_byte_boundaries_and_the_file_ends_with_the_last(fixtures_dir) -> None:
    fixture, _ = golden(fixtures_dir)
    data = encode_fixture(fixture)
    header, arrays = bundle.decode(data)

    assert [a.size for a in arrays] == [s["length"] for s in header["sections"]]
    assert np.isnan(arrays[0][5]) and arrays[1].tolist() == fixture["flags"]


def test_decode_rejects_foreign_and_truncated_files(fixtures_dir) -> None:
    fixture, _ = golden(fixtures_dir)
    data = encode_fixture(fixture)

    with pytest.raises(ValueError, match="magic"):
        bundle.decode(b"PK" + data[2:])
    with pytest.raises(ValueError):
        bundle.decode(data[:-1])


def test_area_order_hash_matches_the_fixture(fixtures_dir) -> None:
    areas = json.loads((fixtures_dir / "areas-constituency.json").read_text())
    codes = [a["code"] for a in areas["areas"]]

    assert bundle.area_order_hash(codes) == areas["areaOrderHash"]
    assert bundle.area_order_hash([]) == "e3b0c44298fc1c14"
