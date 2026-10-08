"""TADB binary bundle writer; the reader is `parseBundle` in src/domain/bundle.ts.

    0   4 bytes  magic "TADB"
    4   u16 LE   format version (1)
    6   u16      reserved, 0
    8   u32 LE   header length H
    12  H bytes  header, UTF-8 JSON
    then each section in header order, each starting at the next multiple of 4

The file ends exactly where the last section ends.
"""

from __future__ import annotations

import hashlib
import json
import struct
from collections.abc import Sequence
from typing import Any

import numpy as np

MAGIC = b"TADB"
FORMAT_VERSION = 1
DTYPES = {"f32": np.dtype("<f4"), "u8": np.dtype("u1"), "u16": np.dtype("<u2"), "u32": np.dtype("<u4")}


def area_order_hash(codes: Sequence[str]) -> str:
    """First 16 hex characters of SHA-256 over the codes joined by newlines."""
    return hashlib.sha256("\n".join(codes).encode()).hexdigest()[:16]


def encode(header: dict[str, Any], sections: Sequence[tuple[str, str, np.ndarray]]) -> bytes:
    """Encode a bundle. `sections` are (name, dtype, values); the header's
    `sections` list is written from them, in order."""
    arrays = []
    described = []
    for name, dtype, values in sections:
        array = np.ascontiguousarray(values, dtype=DTYPES[dtype]).ravel()
        arrays.append(array)
        described.append({"name": name, "dtype": dtype, "length": int(array.size)})
    full = {**header, "sections": described}
    head = json.dumps(full, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    out = bytearray(MAGIC + struct.pack("<HHI", FORMAT_VERSION, 0, len(head)) + head)
    for array in arrays:
        out += b"\0" * (-len(out) % 4)
        out += array.tobytes()
    return bytes(out)


def decode(data: bytes) -> tuple[dict[str, Any], list[np.ndarray]]:
    """Decode a bundle written by `encode` (used by tests and the release check)."""
    if data[:4] != MAGIC:
        raise ValueError("bad magic")
    version, _, length = struct.unpack("<HHI", data[4:12])
    if version != FORMAT_VERSION:
        raise ValueError(f"unsupported version {version}")
    header = json.loads(data[12 : 12 + length].decode())
    offset = 12 + length
    arrays = []
    for section in header["sections"]:
        offset += -offset % 4
        dtype = DTYPES[section["dtype"]]
        size = section["length"] * dtype.itemsize
        arrays.append(np.frombuffer(data, dtype=dtype, count=section["length"], offset=offset))
        offset += size
    if offset != len(data):
        raise ValueError("trailing or missing bytes")
    return header, arrays
