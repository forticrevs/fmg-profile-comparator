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


def _norm_value(x: Any) -> str:
    """Normalize a value for sync comparison.

    - Unwraps resolver display wrappers ({raw, display}).
    - Sorts scalar lists so e.g. ["smtp","pop3"] == ["pop3","smtp"].
    """
    if isinstance(x, dict) and "raw" in x:
        x = x["raw"]
    if isinstance(x, list):
        return str(sorted(x, key=str))
    return str(x)


def compare_profiles(
    profiles: dict[str, dict[str, Any]],
    resolver: Any = None,
    excluded_roots: list[str] | None = None,
    baseline: str | None = None,
) -> list[ComparisonField]:
    """Compare N flattened profiles, returning one ComparisonField per unique key.

    If a resolver is provided, values are enriched with human-readable names
    where applicable (category IDs, URL filter IDs, etc.).

    When ``baseline`` names a profile present in ``profiles``, drift is
    computed *against the baseline* rather than N-way symmetrically:
      - ``in_sync`` becomes "every non-baseline value matches the baseline".
      - ``differs_from_baseline[name]`` is True for non-baseline profiles
        whose normalized value differs from the baseline's, False otherwise
        (the baseline itself is always False).
    """
    collection_roots = set(excluded_roots or [])
    if baseline is not None and baseline not in profiles:
        # Silently ignore an unknown baseline rather than 500ing — the
        # router validates names exist before getting here, but defensive.
        baseline = None

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

        differs_from_baseline: dict[str, bool] = {}
        if baseline is not None:
            base_norm = _norm_value(values[baseline])
            any_drift = False
            for pname, val in values.items():
                if pname == baseline:
                    differs_from_baseline[pname] = False
                    continue
                drifted = _norm_value(val) != base_norm
                differs_from_baseline[pname] = drifted
                if drifted:
                    any_drift = True
            in_sync = not any_drift
        else:
            raw_vals = {_norm_value(v) for v in values.values()}
            in_sync = len(raw_vals) == 1

        fields.append(
            ComparisonField(
                field_path=key,
                label=_make_label(key),
                values=values,
                in_sync=in_sync,
                differs_from_baseline=differs_from_baseline,
            )
        )

    return fields
