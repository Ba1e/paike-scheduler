#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import tarfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / 'release-artifacts'

RELEASE_FILES = [
    '.dockerignore',
    '.env.example',
    '.gitignore',
    'Dockerfile',
    'LICENSE',
    'README.md',
    'app.py',
    'app.js',
    'app_utils.js',
    'auth.html',
    'code_generator.py',
    'departments.json',
    'docker-compose.yml',
    'index.html',
    'migrate_json_to_sqlite.py',
    'portal.html',
    'requirements.txt',
    'scheduler/__init__.py',
    'scheduler/constraints.py',
    'scheduler/models.py',
    'scheduler/solver.py',
    'scheduler_api.py',
    'scheduler_demo.py',
    'sqlite_store.py',
    'test_scheduler.py',
]

FORBIDDEN_PATTERNS = [
    '.db',
    '.db-wal',
    '.db-shm',
    '.xlsx',
    '.log',
]

FORBIDDEN_NAMES = {
    '.env',
    'BOOTSTRAP_CODE.txt',
    'data.json',
    'data_original.json',
    'departments',
    'deleted_terms',
    'export_temp.xlsx',
    'history',
    'invite_codes.json',
    'release-artifacts',
    'runtime-data',
    'schedule.db',
    'sessions.json',
    'users.json',
}


def sha1_short(path):
    digest = hashlib.sha1()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def ensure_safe_member(rel_path):
    name = Path(rel_path).name
    if rel_path in FORBIDDEN_NAMES or name in FORBIDDEN_NAMES:
        raise ValueError(f'禁止发布业务数据或运行时文件：{rel_path}')
    if any(rel_path.endswith(suffix) for suffix in FORBIDDEN_PATTERNS):
        raise ValueError(f'禁止发布运行时/导入文件：{rel_path}')


def build_manifest():
    missing = []
    files = []
    for rel in RELEASE_FILES:
        ensure_safe_member(rel)
        path = ROOT / rel
        if not path.is_file():
            missing.append(rel)
            continue
        files.append({
            'path': rel,
            'size': path.stat().st_size,
            'sha1': sha1_short(path),
        })
    if missing:
        raise FileNotFoundError('缺少发布文件：' + ', '.join(missing))
    return {
        'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'file_count': len(files),
        'files': files,
    }


def create_archive():
    manifest = build_manifest()
    DIST_DIR.mkdir(exist_ok=True)
    stamp = time.strftime('%Y%m%d_%H%M%S')
    archive = DIST_DIR / f'schedule-system-release-{stamp}.tar.gz'
    manifest_path = DIST_DIR / f'schedule-system-release-{stamp}.manifest.json'
    with tarfile.open(archive, 'w:gz') as tar:
        for item in manifest['files']:
            rel = item['path']
            ensure_safe_member(rel)
            tar.add(ROOT / rel, arcname=rel)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return archive, manifest_path, manifest


def main():
    parser = argparse.ArgumentParser(description='Build a safe code-only release package for the scheduling system.')
    parser.add_argument('--check', action='store_true', help='Only validate the release file list.')
    args = parser.parse_args()

    if args.check:
        manifest = build_manifest()
        print(json.dumps({'ok': True, **manifest}, ensure_ascii=False, indent=2))
        return

    archive, manifest_path, manifest = create_archive()
    print(json.dumps({
        'ok': True,
        'archive': str(archive),
        'manifest': str(manifest_path),
        'file_count': manifest['file_count'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
