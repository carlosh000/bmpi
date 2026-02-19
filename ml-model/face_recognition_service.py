#!/usr/bin/env python3
"""LEGACY WRAPPER: redirige comandos a face_server.py (servicio productivo)."""

import runpy
from pathlib import Path


if __name__ == "__main__":
    target = Path(__file__).with_name("face_server.py")
    runpy.run_path(str(target), run_name="__main__")
