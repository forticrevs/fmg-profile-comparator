"""PAN XML extraction ARQ task.

Runs the user-selected subset of PAN parsers against a single uploaded
Palo Alto config XML and writes each parser's output into the per-user job
directory, plus a combined zip archive.

The task operates on a file path (not file bytes) so ARQ doesn't have to
shuttle multi-megabyte payloads through Redis.
"""

from __future__ import annotations

import logging
import zipfile
from pathlib import Path

from lxml import etree

from app.jobs.user_storage import job_dir
from app.services.pan_parsers import REGISTRY

logger = logging.getLogger(__name__)


async def pan_extract(
    ctx: dict,
    *,
    username: str,
    job_id: str,
    xml_path: str,
    parsers: list[str],
) -> dict:
    """Run the selected PAN parsers and write outputs into the job dir.

    Returns a summary dict (parsers run, files produced, any errors) that
    the frontend uses to render download links.
    """
    out_dir = job_dir(username, job_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    logger.info("pan_extract start user=%s job=%s parsers=%s", username, job_id, parsers)

    # Parse once, hand the same tree to every parser.
    try:
        tree = etree.parse(xml_path)
    except etree.XMLSyntaxError as exc:
        return {"status": "error", "error": f"Invalid XML: {exc}"}

    root = tree.getroot()

    results: list[dict] = []
    produced_files: list[str] = []

    for name in parsers:
        entry = REGISTRY.get(name)
        if entry is None:
            results.append({"parser": name, "status": "error", "error": "unknown parser"})
            continue
        try:
            outputs = entry["parse"](root)  # -> dict[str, bytes]
            for filename, data in outputs.items():
                (out_dir / filename).write_bytes(data)
                produced_files.append(filename)
            results.append({
                "parser": name,
                "status": "ok",
                "files": list(outputs.keys()),
            })
        except Exception as exc:
            logger.exception("parser %s failed", name)
            results.append({"parser": name, "status": "error", "error": str(exc)})

    # Bundle everything into one zip for convenience.
    zip_name = f"pan-extract-{job_id}.zip"
    zip_path = out_dir / zip_name
    if produced_files:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename in produced_files:
                zf.write(out_dir / filename, arcname=filename)

    # Remove the uploaded source XML once parsing is done — the user's
    # artifacts are the outputs, not the input.
    try:
        Path(xml_path).unlink(missing_ok=True)
    except Exception:
        pass

    return {
        "status": "ok",
        "parsers": results,
        "files": produced_files,
        "archive": zip_name if produced_files else None,
    }
