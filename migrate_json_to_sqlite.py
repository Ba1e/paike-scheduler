import json
import os

import sqlite_store
from app import (
    BASE_DIR,
    DEPTS_CONFIG,
    INVITES_FILE,
    SESSIONS_FILE,
    USERS_FILE,
    term_changelog_file,
    term_data_file,
    term_history_meta_file,
    term_metadata_file,
    term_original_file,
    term_workflow_file,
)


def read_json_file(path, default):
    if not os.path.exists(path):
        return default
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def seed_file(namespace, path, default):
    if os.path.exists(path):
        sqlite_store.set_document(namespace, read_json_file(path, default))


def migrate():
    sqlite_store.init_db()
    seed_file('config:departments', DEPTS_CONFIG, [])
    seed_file('auth:users', USERS_FILE, [])
    seed_file('auth:invites', INVITES_FILE, [])
    seed_file('auth:sessions', SESSIONS_FILE, {})

    for dept in read_json_file(DEPTS_CONFIG, []):
        dept_id = dept.get('id')
        if not dept_id:
            continue
        terms = read_json_file(os.path.join(BASE_DIR, 'departments', dept_id, 'terms.json'), [])
        sqlite_store.set_document(f'dept:{dept_id}:terms', terms)
        resources = os.path.join(BASE_DIR, 'departments', dept_id, 'resources')
        seed_file(f'dept:{dept_id}:teachers', os.path.join(resources, 'teachers.json'), [])
        seed_file(f'dept:{dept_id}:classrooms', os.path.join(resources, 'classrooms.json'), [])
        seed_file(f'dept:{dept_id}:campus_config', os.path.join(resources, 'campus_config.json'), None)
        for term in terms:
            term_id = term.get('id')
            if not term_id:
                continue
            seed_file(f'term:{dept_id}:{term_id}:data', term_data_file(dept_id, term_id), [])
            seed_file(f'term:{dept_id}:{term_id}:original', term_original_file(dept_id, term_id), [])
            seed_file(f'term:{dept_id}:{term_id}:changelog', term_changelog_file(dept_id, term_id), [])
            seed_file(f'term:{dept_id}:{term_id}:workflow', term_workflow_file(dept_id, term_id), {'status': 'draft', 'updated_at': '', 'updated_by': '', 'history': []})
            seed_file(f'term:{dept_id}:{term_id}:history_meta', term_history_meta_file(dept_id, term_id), {})
            meta = read_json_file(term_metadata_file(dept_id, term_id), {})
            sqlite_store.touch_term_version(dept_id, term_id, {'name': meta.get('updated_by', '')})


if __name__ == '__main__':
    migrate()
    print(f'迁移完成：{sqlite_store.DB_PATH}')
