"""Unified diff engine for the Diff utility.

Operates exclusively on already-validated ValidatedFile objects (see
`app.services.file_security`). No parsing, no decoding, no I/O — just
canonical-string → canonical-string difflib with a hard line cap so a
pathological input can't blow the response payload.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass

from app.services.file_security import ValidatedFile


# Hard ceiling on emitted diff lines per pair. Config diffs are usually tiny;
# hitting this cap means something unusual is going on and we stop rendering
# to protect the browser.
MAX_DIFF_LINES = 20_000


@dataclass
class PairDiff:
    """A single file-vs-baseline diff result."""

    index: int          # candidate file's position in the original input list
    name: str           # candidate filename
    unified: str        # unified-diff text (possibly truncated)
    added: int          # lines present in candidate but not baseline
    removed: int        # lines present in baseline but not candidate
    truncated: bool     # True when MAX_DIFF_LINES was hit


def _split_lines(text: str) -> list[str]:
    # splitlines(keepends=True) preserves user line endings for display.
    return text.splitlines(keepends=True)


def diff_pair(baseline: ValidatedFile, other: ValidatedFile) -> PairDiff:
    base_lines = _split_lines(baseline.canonical)
    other_lines = _split_lines(other.canonical)

    diff_iter = difflib.unified_diff(
        base_lines,
        other_lines,
        fromfile=baseline.name,
        tofile=other.name,
        lineterm="",
        n=3,
    )

    lines: list[str] = []
    added = 0
    removed = 0
    truncated = False
    for line in diff_iter:
        if len(lines) >= MAX_DIFF_LINES:
            truncated = True
            break
        # Strip embedded newlines so the client can render line-by-line without
        # double-spacing. The +/- markers stay intact.
        lines.append(line.rstrip("\n"))
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed += 1

    return PairDiff(
        index=0,  # caller sets this
        name=other.name,
        unified="\n".join(lines),
        added=added,
        removed=removed,
        truncated=truncated,
    )


def diff_against_baseline(
    files: list[ValidatedFile],
    baseline_index: int = 0,
) -> list[PairDiff]:
    """Compute unified diffs between every non-baseline file and the baseline."""
    if not 0 <= baseline_index < len(files):
        raise ValueError(f"baseline_index {baseline_index} out of range")
    baseline = files[baseline_index]
    out: list[PairDiff] = []
    for i, f in enumerate(files):
        if i == baseline_index:
            continue
        pair = diff_pair(baseline, f)
        pair.index = i
        out.append(pair)
    return out
