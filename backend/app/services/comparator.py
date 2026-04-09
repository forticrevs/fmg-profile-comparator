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
        # Arrays of pure scalars (e.g. ["smtp", "pop3", "imap"]) are kept as
        # a single list value rather than exploded into indexed leaves — the
        # UI renders them as a comma-joined cell.
        if len(obj) > 0 and all(not isinstance(x, (dict, list)) for x in obj):
            items[prefix] = obj
        else:
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
EXCLUDED_FIELDS = {"oid", "uuid", "obj seq", "name"}


def _is_excluded(key: str) -> bool:
    """Check if a flattened key ends with an excluded field name."""
    leaf = key.rsplit(".", 1)[-1] if "." in key else key
    # Strip array suffix like "[0]"
    leaf = leaf.split("[")[0] if "[" in leaf else leaf
    return leaf in EXCLUDED_FIELDS


def _is_object_collection(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(item, dict) for item in value)
    )


def _walk_for_collections(value: Any, path: str, out: set[str]) -> None:
    """Recursively walk a profile, recording dot-paths to every list-of-dicts
    encountered. Stops descending once a collection is found at a path so we
    don't double-register children (those are rendered nested by the UI)."""
    if _is_object_collection(value):
        out.add(path)
        # Don't descend into the entries — the UI will handle nesting itself.
        return
    if isinstance(value, dict):
        for subkey, subvalue in value.items():
            new_path = f"{path}.{subkey}" if path else subkey
            _walk_for_collections(subvalue, new_path, out)


def find_collection_keys(profiles: dict[str, dict[str, Any]]) -> list[str]:
    """Return dot-paths to every object-collection (list-of-dicts) found at
    any depth in any profile.  These get rendered structurally by the UI
    and are excluded from the flat field comparison."""
    keys: set[str] = set()
    for profile in profiles.values():
        if not isinstance(profile, dict):
            continue
        _walk_for_collections(profile, "", keys)
    return sorted(keys)


def _belongs_to_collection(key: str, collection_roots: set[str]) -> bool:
    for root in collection_roots:
        if key == root or key.startswith(root + ".") or key.startswith(root + "["):
            return True
    return False


def compare_profiles(
    profiles: dict[str, dict[str, Any]],
    resolver: Any = None,
    excluded_roots: list[str] | None = None,
) -> list[ComparisonField]:
    """Compare N flattened profiles, returning one ComparisonField per unique key.

    If a resolver is provided, values are enriched with human-readable names
    where applicable (category IDs, URL filter IDs, etc.).
    """
    collection_roots = set(excluded_roots or [])

    # Flatten all
    flat: dict[str, dict[str, Any]] = {}
    for name, data in profiles.items():
        flat[name] = flatten(data)

    # Collect all unique keys, excluding internal IDs
    all_keys: set[str] = set()
    for f in flat.values():
        all_keys.update(
            k
            for k in f.keys()
            if not _is_excluded(k) and not _belongs_to_collection(k, collection_roots)
        )

    fields: list[ComparisonField] = []
    for key in sorted(all_keys):
        values: dict[str, Any] = {}
        for pname, fdata in flat.items():
            raw = fdata.get(key, "__MISSING__")
            if resolver and raw != "__MISSING__":
                values[pname] = resolver.resolve_value(key, raw)
            else:
                values[pname] = raw

        # For sync comparison, extract raw values (ignore display wrappers).
        # Scalar lists are compared order-independently so e.g.
        # ["smtp","pop3"] and ["pop3","smtp"] are considered in sync.
        def _norm(x: Any) -> str:
            if isinstance(x, dict) and "raw" in x:
                x = x["raw"]
            if isinstance(x, list):
                return str(sorted(x, key=str))
            return str(x)

        raw_vals = {_norm(v) for v in values.values()}
        in_sync = len(raw_vals) == 1

        fields.append(
            ComparisonField(
                field_path=key,
                label=_make_label(key),
                values=values,
                in_sync=in_sync,
            )
        )

    return fields
