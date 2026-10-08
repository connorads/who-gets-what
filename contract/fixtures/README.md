# Contract fixtures

Tiny synthetic files that both test suites read: Vitest parses them through
`src/domain`, and the pipeline's pytest checks that its writers produce the same
shapes. Values are made up and are not statistics. Area codes, names and hex
positions are real so that code and level rules apply.

- `series-mini.json` describes a series bundle as JSON (`null` is NaN).
  `series-mini.bin.hex` is that bundle encoded, as lowercase hex. A writer in
  any language must produce the same magic, version and section bytes, and a
  header that parses to the same JSON value. Header length and padding may
  differ.
- The area order hash is the first 16 hex characters of SHA-256 over the area
  codes joined by `\n`.
