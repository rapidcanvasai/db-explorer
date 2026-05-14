#!/usr/bin/env python3
"""Launch backend (FastAPI :8001) and frontend (Vite :5174) together.

Ctrl+C cleanly kills both plus any grandchildren (npm -> vite).
Uses POSIX process groups so npm's vite subprocess can't escape.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_PORT = 8001
FRONTEND_PORT = 5174


def color(code: str, msg: str) -> str:
    return f"\033[{code}m{msg}\033[0m"


def log(msg: str) -> None:
    print(color("32", "[dev]"), msg, flush=True)


def ensure_setup() -> None:
    if not (ROOT / ".venv").exists() or not (ROOT / "dashboard" / "node_modules").exists():
        log("first-time setup missing, running bootstrap...")
        subprocess.check_call([str(ROOT / "scripts" / "bootstrap.sh")])


def spawn(cmd: list[str], cwd: Path, label: str) -> subprocess.Popen:
    log(f"{label} → {' '.join(cmd)}  (cwd={cwd.relative_to(ROOT) if cwd != ROOT else '.'})")
    # start_new_session=True puts the child in its own process group so we can
    # kill it and all its descendants (e.g. npm -> vite) via os.killpg.
    return subprocess.Popen(cmd, cwd=str(cwd), start_new_session=True)


def kill_group(proc: subprocess.Popen, sig: int) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), sig)
    except ProcessLookupError:
        pass


def main() -> int:
    ensure_setup()
    venv_python = ROOT / ".venv" / "bin" / "python"
    if not venv_python.exists():
        print(f"[dev] missing {venv_python}. Run: make setup", file=sys.stderr)
        return 1

    backend = spawn(
        [str(venv_python), "run.py"],
        cwd=ROOT,
        label=f"backend  http://localhost:{BACKEND_PORT}",
    )
    frontend = spawn(
        ["npm", "run", "dev"],
        cwd=ROOT / "dashboard",
        label=f"frontend http://localhost:{FRONTEND_PORT}",
    )
    procs = [backend, frontend]

    def shutdown(signum=None, frame=None):
        print()
        log("shutting down...")
        for p in procs:
            kill_group(p, signal.SIGTERM)
        # give them a moment to exit cleanly
        deadline = time.time() + 3
        while time.time() < deadline and any(p.poll() is None for p in procs):
            time.sleep(0.1)
        for p in procs:
            kill_group(p, signal.SIGKILL)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # If either child dies, shut the other down too.
    while True:
        for p in procs:
            rc = p.poll()
            if rc is not None:
                log(f"child exited (code={rc}), stopping siblings")
                shutdown()
        time.sleep(0.5)


if __name__ == "__main__":
    sys.exit(main())
