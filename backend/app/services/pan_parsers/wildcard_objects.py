"""Convert Palo Alto wildcard address objects into FortiGate CLI commands.

PAN represents wildcard address matches as `ip-wildcard` with a value like
`10.0.0.0/0.0.255.255`. FortiGate expects `ip mask` with a *complement*
mask. For each non-trivial PAN mask byte, we round up to the next
`(2ⁿ − 1)` form so the block size is a clean power of two, then emit
`255 − r` on the Fortinet side and align the IP octet down to the block
boundary.

Output is a single FortiGate config snippet with one
`config firewall address` block per entry. Ported from
`xml_convert_wildard_objects_to_ftnt.py`.
"""

from __future__ import annotations

import io
from typing import Any

from app.services.pan_parsers import register

ADDRESS_XPATH = ".//address/entry"


def _round_pan_byte(b: int) -> int:
    """Round a PAN wildcard byte up to the next (2ⁿ − 1) form.

    Examples: 0→0, 31→31, 33→63, 63→63, 64→127, 200→255, 255→255.
    """
    if b in (0, 255):
        return b
    n = 1
    while (n - 1) < b and n < 256:
        n <<= 1
    return n - 1


def _repair_wildcard(ipmask: str) -> str:
    ip_str, pan_str = ipmask.split("/")
    ip = list(map(int, ip_str.split(".")))
    pan = list(map(int, pan_str.split(".")))

    forti = [0, 0, 0, 0]
    for i in range(4):
        r = _round_pan_byte(pan[i])
        block = r + 1
        fmask = 255 - r
        forti[i] = fmask

        ip[i] = (ip[i] // block) * block
        if fmask == 0:
            ip[i] = 0

    return "{}.{}.{}.{} {}.{}.{}.{}".format(*ip, *forti)


def parse(root: Any) -> dict[str, bytes]:
    buf = io.StringIO()

    for entry in root.findall(ADDRESS_XPATH):
        w = entry.find("ip-wildcard")
        if w is None or not w.text:
            continue

        name = entry.get("name") or ""
        fixed = _repair_wildcard(w.text.strip())

        buf.write("config firewall address\n")
        buf.write(f'    edit "{name}"\n')
        buf.write("        set type wildcard\n")
        buf.write(f"        set wildcard {fixed}\n")
        buf.write("    next\n")
        buf.write("end\n\n")

    return {"wildcard-objects.ftnt.txt": buf.getvalue().encode("utf-8")}


register(
    parser_id="wildcard_objects",
    label="Wildcard Address Objects",
    description="PAN wildcard address objects converted to FortiGate CLI `config firewall address` blocks with complement-form masks",
    parse=parse,
)
