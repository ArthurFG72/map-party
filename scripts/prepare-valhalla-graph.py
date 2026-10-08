#!/usr/bin/env python3
"""Prepare (or explicitly build) local Valhalla data from an OSM PBF.

This is a workstation-only data tool. Its output belongs under data/, which is
ignored by Git and excluded from server/mobile releases. The mobile app must
receive only a validated route corridor, never this national graph.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def config_for(tile_dir: Path, tile_extract: Path) -> dict:
    # pyvalhalla supplies the version-matched defaults. It requires both paths
    # to exist when resolving them, so the empty extract is created first.
    from valhalla import get_config

    tile_dir.mkdir(parents=True, exist_ok=True)
    tile_extract.touch(exist_ok=True)
    config = get_config(tile_dir=tile_dir, tile_extract=tile_extract)
    config['logging']['type'] = ''
    config['mjolnir']['max_concurrent_reader_users'] = 1
    config['mjolnir']['data_processing']['use_admin_db'] = False
    return config


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pbf', type=Path, required=True, help='Validated OSM PBF input')
    parser.add_argument('--output', type=Path, required=True, help='Ignored local output directory')
    parser.add_argument('--threads', type=int, default=1, help='Bounded build concurrency (default: 1)')
    parser.add_argument('--build', action='store_true', help='Build graph tiles; omitted means prepare config only')
    args = parser.parse_args()

    pbf = args.pbf.resolve()
    if not pbf.is_file() or pbf.suffixes[-2:] != ['.osm', '.pbf']:
        parser.error('--pbf must point to an existing .osm.pbf file')
    if args.threads < 1 or args.threads > 4:
        parser.error('--threads must be between 1 and 4')

    output = args.output.resolve()
    tile_dir = output / 'tiles'
    tile_extract = output / 'tiles.tar'
    config_path = output / 'valhalla.json'
    output.mkdir(parents=True, exist_ok=True)
    config_path.write_text(json.dumps(config_for(tile_dir, tile_extract), indent=2), encoding='utf-8')
    print(f'Prepared {config_path}')

    if not args.build:
        print('Graph build not started. Re-run with --build after confirming disk and time budget.')
        return 0

    command = [sys.executable, '-m', 'valhalla', 'valhalla_build_tiles', '-c', str(config_path), '-j', str(args.threads), str(pbf)]
    return subprocess.call(command)


if __name__ == '__main__':
    raise SystemExit(main())
