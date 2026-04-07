"""Profile comparison engine — flattens nested configs and diffs them."""

from __future__ import annotations

from typing import Any

from app.models.schemas import ComparisonField


def flatten(obj: Any, prefix: str = "", sep: str = ".") -> dict[str, Any]:
    """Recursively flatten a nested dict/list into dot-notation keys."""
    items: dict[str, Any] = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_key = f"{prefix}{sep}{k}" if prefix else k
            items.update(flatten(v, new_key, sep))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            new_key = f"{prefix}[{i}]"
            items.update(flatten(v, new_key, sep))
    else:
        items[prefix] = obj
    return items


def _make_label(field_path: str) -> str:
    """Turn a.b[0].c into 'A > B [0] > C'."""
    parts = field_path.replace("[", " > [").replace("].", "] > ").split(".")
    return " > ".join(p.replace("_", " ").replace("-", " ").title() for p in parts if p)


# Fields that are internal identifiers — never meaningful to compare
EXCLUDED_FIELDS = {"oid", "uuid", "obj seq"}


def _is_excluded(key: str) -> bool:
    """Check if a flattened key ends with an excluded field name."""
    leaf = key.rsplit(".", 1)[-1] if "." in key else key
    # Strip array suffix like "[0]"
    leaf = leaf.split("[")[0] if "[" in leaf else leaf
    return leaf in EXCLUDED_FIELDS


def compare_profiles(
    profiles: dict[str, dict[str, Any]],
) -> list[ComparisonField]:
    """Compare N flattened profiles, returning one ComparisonField per unique key."""
    # Flatten all
    flat: dict[str, dict[str, Any]] = {}
    for name, data in profiles.items():
        flat[name] = flatten(data)

    # Collect all unique keys, excluding internal IDs
    all_keys: set[str] = set()
    for f in flat.values():
        all_keys.update(k for k in f.keys() if not _is_excluded(k))

    fields: list[ComparisonField] = []
    for key in sorted(all_keys):
        values = {}
        for pname, fdata in flat.items():
            values[pname] = fdata.get(key, "__MISSING__")

        unique_vals = set(str(v) for v in values.values())
        in_sync = len(unique_vals) == 1

        fields.append(
            ComparisonField(
                field_path=key,
                label=_make_label(key),
                values=values,
                in_sync=in_sync,
            )
        )

    return fields
