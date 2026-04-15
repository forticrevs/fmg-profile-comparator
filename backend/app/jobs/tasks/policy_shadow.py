"""Policy Shadow ARQ task.

Spawns the standalone `fmg-policy-shadow` analyzer as a subprocess. The
analyzer is an external CLI — we do NOT import it. Credentials travel via
environment variables so nothing sensitive ends up in argv / ps output.

The subprocess runs with:
- `--output-dir` pointed at the per-user job directory so reports land in
  a path the existing `/api/jobs/{id}/artifact/{filename}` route can serve.
- stdout/stderr captured, each capped at ~5 MiB to avoid runaway memory.
- A hard 10-minute wall-clock timeout; the process is killed if exceeded.

The returned summary mirrors the shape the PAN task uses (files + archive)
so the frontend job-polling layer can present it uniformly. Exit code is
also surfaced so the frontend can render 0=clean / 1=findings / 2=errors
badges.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
from pathlib import Path

from app.jobs.user_storage import job_dir

logger = logging.getLogger(__name__)

# Default install path — overridable so the tool can live elsewhere in dev.
_DEFAULT_SHADOW_PATH = "/home/kali/fortimanager/fmg-policy-shadow"

# 5 MiB soft cap on captured stdout / stderr. Enough for verbose debug
# logs on a large ADOM, well short of anything that would bloat Redis.
_MAX_STREAM_BYTES = 5 * 1024 * 1024

# Wall-clock timeout for the subprocess. Shadow analysis on large ADOMs
# can be slow but ten minutes is more than enough for the lab.
_TIMEOUT_SECONDS = 10 * 60


def _shadow_root() -> Path:
    return Path(os.getenv("POLICY_SHADOW_PATH", _DEFAULT_SHADOW_PATH))


async def _read_capped(stream: asyncio.StreamReader, cap: int) -> bytes:
    """Read up to `cap` bytes from a stream, discarding the rest.

    We still drain the stream after hitting the cap so the subprocess
    doesn't block on a full pipe buffer.
    """
    buf = bytearray()
    while True:
        chunk = await stream.read(64 * 1024)
        if not chunk:
            break
        remaining = cap - len(buf)
        if remaining > 0:
            buf.extend(chunk[:remaining])
    return bytes(buf)


async def policy_shadow(
    ctx: dict,
    *,
    username: str,
    job_id: str,
    fmg_host: str,
    fmg_username: str,
    fmg_password: str,
    adom: str,
    verify_ssl: bool,
    packages: list[str],
    package_regex: str | None,
    formats: list[str],
    include_disabled: bool,
) -> dict:
    """Run the policy shadow analyzer against an FMG instance.

    Package selection: if `packages` is non-empty those specific packages
    are analyzed; else if `package_regex` is set it's passed through;
    else `--all-packages` is used as the default behaviour.
    """
    out_dir = job_dir(username, job_id)
    # Clean slate in case this job id collided with a retry.
    if out_dir.exists():
        shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    shadow_root = _shadow_root()
    entry = shadow_root / "run_shadow.py"
    if not entry.is_file():
        return {
            "status": "error",
            "error": f"Policy shadow entry not found at {entry}",
        }

    # Build argv. Credentials go in env, never here.
    argv: list[str] = [
        "python3",
        str(entry),
        "--fmg", fmg_host,
        "--adom", adom,
        "--output-dir", str(out_dir),
        "--format", ",".join(formats) if formats else "html,xlsx,json",
    ]
    if verify_ssl:
        argv.append("--no-insecure")
    else:
        argv.append("--insecure")
    if include_disabled:
        argv.append("--include-disabled")

    if packages:
        for pkg in packages:
            argv.extend(["--package", pkg])
    elif package_regex:
        argv.extend(["--package-regex", package_regex])
    else:
        argv.append("--all-packages")

    # Env with credentials + stripped PATH-ish noise. Start from a minimal
    # copy of the parent env so PYTHONPATH etc. still work, then overlay.
    env = os.environ.copy()
    env["FMG_USER"] = fmg_username
    env["FMG_PASSWORD"] = fmg_password
    # Ensure the analyzer's own package is importable when launched from
    # an unrelated cwd.
    pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        f"{shadow_root}{os.pathsep}{pythonpath}" if pythonpath else str(shadow_root)
    )

    logger.info(
        "policy_shadow start user=%s job=%s host=%s adom=%s packages=%s regex=%s formats=%s",
        username,
        job_id,
        fmg_host,
        adom,
        packages or "(all)" if not package_regex else None,
        package_regex,
        formats,
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(shadow_root),
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        return {"status": "error", "error": f"Failed to launch analyzer: {exc}"}

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            asyncio.gather(
                _read_capped(proc.stdout, _MAX_STREAM_BYTES),
                _read_capped(proc.stderr, _MAX_STREAM_BYTES),
            ),
            timeout=_TIMEOUT_SECONDS,
        )
        exit_code = await proc.wait()
    except asyncio.TimeoutError:
        logger.warning("policy_shadow timeout user=%s job=%s", username, job_id)
        try:
            proc.kill()
            await proc.wait()
        except Exception:
            pass
        return {
            "status": "error",
            "error": f"Analyzer timed out after {_TIMEOUT_SECONDS}s",
            "exit_code": None,
        }

    # Decode captured streams, replace bad bytes rather than failing.
    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")

    # Enumerate every file the analyzer produced so the frontend can
    # offer downloads without needing to know filename conventions.
    files: list[str] = []
    for p in sorted(out_dir.iterdir()):
        if p.is_file():
            files.append(p.name)

    # Pick the primary HTML report (for iframe preview) if one exists.
    html_report = next(
        (f for f in files if f.endswith(".html")),
        None,
    )

    logger.info(
        "policy_shadow done user=%s job=%s exit=%s files=%d",
        username,
        job_id,
        exit_code,
        len(files),
    )

    return {
        "status": "ok" if exit_code in (0, 1) else "error",
        "exit_code": exit_code,
        "files": files,
        "html_report": html_report,
        # Tail the streams so large logs don't balloon the result payload.
        # Frontend shows the last 8 KiB only.
        "stdout_tail": stdout[-8192:],
        "stderr_tail": stderr[-8192:],
    }
