import json
import os
import sqlite3
import time
from contextlib import contextmanager
from threading import Lock


SOURCE_DIR = os.path.dirname(__file__)
DATA_DIR = os.environ.get('SCHED_DATA_DIR', SOURCE_DIR)
DB_PATH = os.environ.get('SCHED_DB_PATH', os.path.join(DATA_DIR, 'schedule.db'))
_initialized = False
_init_lock = Lock()


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


@contextmanager
def transaction():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        with transaction() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS documents (
                  namespace TEXT PRIMARY KEY,
                  payload TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                )
                '''
            )
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS term_versions (
                  dept_id TEXT NOT NULL,
                  term_id TEXT NOT NULL,
                  version INTEGER NOT NULL DEFAULT 1,
                  updated_at TEXT NOT NULL,
                  updated_by TEXT DEFAULT '',
                  PRIMARY KEY (dept_id, term_id)
                )
                '''
            )
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS presence (
                  dept_id TEXT NOT NULL,
                  term_id TEXT NOT NULL,
                  user_id TEXT NOT NULL,
                  name TEXT DEFAULT '',
                  email TEXT DEFAULT '',
                  role TEXT DEFAULT '',
                  campus TEXT DEFAULT '',
                  cursor TEXT DEFAULT '',
                  activity TEXT DEFAULT '',
                  tab TEXT DEFAULT '',
                  course_id TEXT DEFAULT '',
                  field TEXT DEFAULT '',
                  last_seen REAL NOT NULL,
                  PRIMARY KEY (dept_id, term_id, user_id)
                )
                '''
            )
            cols = {row['name'] for row in conn.execute('PRAGMA table_info(presence)').fetchall()}
            for name in ['activity', 'tab', 'course_id', 'field']:
                if name not in cols:
                    conn.execute(f"ALTER TABLE presence ADD COLUMN {name} TEXT DEFAULT ''")
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS sessions (
                  token TEXT PRIMARY KEY,
                  user_id TEXT NOT NULL,
                  created_at REAL NOT NULL,
                  csrf_token TEXT NOT NULL
                )
                '''
            )
        _initialized = True


def now_text():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def get_document(namespace, default=None):
    init_db()
    conn = connect()
    try:
        row = conn.execute('SELECT payload FROM documents WHERE namespace=?', (namespace,)).fetchone()
    finally:
        conn.close()
    if not row:
        return default
    return json.loads(row['payload'])


def set_document(namespace, data):
    init_db()
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    with transaction() as conn:
        conn.execute(
            '''
            INSERT INTO documents(namespace, payload, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(namespace) DO UPDATE SET
              payload=excluded.payload,
              updated_at=excluded.updated_at
            ''',
            (namespace, payload, now_text()),
        )


def update_document(namespace, default, updater):
    init_db()
    conn = connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT payload FROM documents WHERE namespace=?', (namespace,)).fetchone()
        current = json.loads(row['payload']) if row else json.loads(json.dumps(default, ensure_ascii=False))
        new_data, result, should_write = updater(current)
        if should_write:
            payload = json.dumps(new_data, ensure_ascii=False, separators=(',', ':'))
            conn.execute(
                '''
                INSERT INTO documents(namespace, payload, updated_at)
                VALUES(?, ?, ?)
                ON CONFLICT(namespace) DO UPDATE SET
                  payload=excluded.payload,
                  updated_at=excluded.updated_at
                ''',
                (namespace, payload, now_text()),
            )
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_documents(defaults, updater):
    init_db()
    conn = connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        current = {}
        for namespace, default in defaults.items():
            row = conn.execute('SELECT payload FROM documents WHERE namespace=?', (namespace,)).fetchone()
            current[namespace] = json.loads(row['payload']) if row else json.loads(json.dumps(default, ensure_ascii=False))
        new_values, result = updater(current)
        for namespace, data in (new_values or {}).items():
            payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
            conn.execute(
                '''
                INSERT INTO documents(namespace, payload, updated_at)
                VALUES(?, ?, ?)
                ON CONFLICT(namespace) DO UPDATE SET
                  payload=excluded.payload,
                  updated_at=excluded.updated_at
                ''',
                (namespace, payload, now_text()),
            )
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_sessions(ttl=None, now=None):
    init_db()
    now = time.time() if now is None else float(now)
    with transaction() as conn:
        if ttl is not None:
            conn.execute('DELETE FROM sessions WHERE created_at < ?', (now - ttl,))
        rows = conn.execute('SELECT token, user_id, created_at, csrf_token FROM sessions').fetchall()
    return {
        row['token']: {
            'user_id': row['user_id'],
            'created_at': row['created_at'],
            'csrf_token': row['csrf_token'],
        }
        for row in rows
    }


def create_session(token, user_id, csrf_token, created_at=None, ttl=None):
    init_db()
    created_at = time.time() if created_at is None else float(created_at)
    with transaction() as conn:
        if ttl is not None:
            conn.execute('DELETE FROM sessions WHERE created_at < ?', (created_at - ttl,))
        conn.execute(
            '''
            INSERT INTO sessions(token, user_id, created_at, csrf_token)
            VALUES(?, ?, ?, ?)
            ON CONFLICT(token) DO UPDATE SET
              user_id=excluded.user_id,
              created_at=excluded.created_at,
              csrf_token=excluded.csrf_token
            ''',
            (token, user_id, created_at, csrf_token),
        )


def get_session(token, ttl=None, now=None):
    init_db()
    now = time.time() if now is None else float(now)
    conn = connect()
    try:
        row = conn.execute(
            'SELECT user_id, created_at, csrf_token FROM sessions WHERE token=?',
            (token,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    if ttl is not None and now - float(row['created_at']) > ttl:
        delete_session(token)
        return None
    return {
        'user_id': row['user_id'],
        'created_at': row['created_at'],
        'csrf_token': row['csrf_token'],
    }


def delete_session(token):
    init_db()
    with transaction() as conn:
        conn.execute('DELETE FROM sessions WHERE token=?', (token,))


def delete_sessions_for_user(user_id):
    init_db()
    with transaction() as conn:
        conn.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))


def clear_sessions():
    init_db()
    with transaction() as conn:
        conn.execute('DELETE FROM sessions')


def set_term_document_and_touch_version(namespace, data, dept_id, term_id, user=None, expected_version=None):
    init_db()
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    updated_by = ''
    if user:
        updated_by = user.get('name') or user.get('email') or ''
    updated_at = now_text()
    conn = connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute(
            'SELECT version, updated_at, updated_by FROM term_versions WHERE dept_id=? AND term_id=?',
            (dept_id, term_id),
        ).fetchone()
        current_version = int(row['version']) if row else 0
        current_by = (row['updated_by'] or '') if row else ''
        if expected_version is not None and current_version and int(expected_version) != current_version:
            conn.rollback()
            return {
                'ok': False,
                'current': {
                    'version': current_version,
                    'updated_at': row['updated_at'] if row else '',
                    'updated_by': current_by,
                },
            }
        conn.execute(
            '''
            INSERT INTO documents(namespace, payload, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(namespace) DO UPDATE SET
              payload=excluded.payload,
              updated_at=excluded.updated_at
            ''',
            (namespace, payload, updated_at),
        )
        if row:
            next_version = current_version + 1
            if not updated_by:
                updated_by = current_by
            conn.execute(
                'UPDATE term_versions SET version=?, updated_at=?, updated_by=? WHERE dept_id=? AND term_id=?',
                (next_version, updated_at, updated_by, dept_id, term_id),
            )
        else:
            next_version = 1
            conn.execute(
                'INSERT INTO term_versions(dept_id, term_id, version, updated_at, updated_by) VALUES(?, ?, 1, ?, ?)',
                (dept_id, term_id, updated_at, updated_by),
            )
        conn.commit()
        return {'ok': True, 'current': {'version': next_version, 'updated_at': updated_at, 'updated_by': updated_by}}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def has_document(namespace):
    init_db()
    conn = connect()
    try:
        row = conn.execute('SELECT 1 FROM documents WHERE namespace=?', (namespace,)).fetchone()
    finally:
        conn.close()
    return row is not None


def get_term_version(dept_id, term_id):
    init_db()
    conn = connect()
    try:
        row = conn.execute(
            'SELECT version, updated_at, updated_by FROM term_versions WHERE dept_id=? AND term_id=?',
            (dept_id, term_id),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        touch_term_version(dept_id, term_id)
        return get_term_version(dept_id, term_id)
    return {'version': row['version'], 'updated_at': row['updated_at'], 'updated_by': row['updated_by'] or ''}


def touch_term_version(dept_id, term_id, user=None):
    init_db()
    updated_by = ''
    if user:
        updated_by = user.get('name') or user.get('email') or ''
    updated_at = now_text()
    with transaction() as conn:
        row = conn.execute(
            'SELECT version, updated_by FROM term_versions WHERE dept_id=? AND term_id=?',
            (dept_id, term_id),
        ).fetchone()
        if row:
            next_version = int(row['version']) + 1
            if not updated_by:
                updated_by = row['updated_by'] or ''
            conn.execute(
                'UPDATE term_versions SET version=?, updated_at=?, updated_by=? WHERE dept_id=? AND term_id=?',
                (next_version, updated_at, updated_by, dept_id, term_id),
            )
        else:
            conn.execute(
                'INSERT INTO term_versions(dept_id, term_id, version, updated_at, updated_by) VALUES(?, ?, 1, ?, ?)',
                (dept_id, term_id, updated_at, updated_by),
            )
    return get_term_version(dept_id, term_id)


def update_presence(dept_id, term_id, user_id, info, ttl=60, now=None):
    init_db()
    now = time.time() if now is None else float(now)
    expires_before = now - ttl
    with transaction() as conn:
        conn.execute('DELETE FROM presence WHERE last_seen < ?', (expires_before,))
        conn.execute(
            '''
            INSERT INTO presence(dept_id, term_id, user_id, name, email, role, campus, cursor, activity, tab, course_id, field, last_seen)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dept_id, term_id, user_id) DO UPDATE SET
              name=excluded.name,
              email=excluded.email,
              role=excluded.role,
              campus=excluded.campus,
              cursor=excluded.cursor,
              activity=excluded.activity,
              tab=excluded.tab,
              course_id=excluded.course_id,
              field=excluded.field,
              last_seen=excluded.last_seen
            ''',
            (
                dept_id,
                term_id,
                user_id,
                info.get('name', ''),
                info.get('email', ''),
                info.get('role', ''),
                info.get('campus', ''),
                info.get('cursor', ''),
                info.get('activity', ''),
                info.get('tab', ''),
                info.get('course_id', ''),
                info.get('field', ''),
                now,
            ),
        )
        rows = conn.execute(
            '''
            SELECT name, email, role, campus, cursor, activity, tab, course_id, field, last_seen
            FROM presence
            WHERE dept_id=? AND term_id=? AND user_id<>? AND last_seen>=?
            ORDER BY last_seen DESC, name ASC
            ''',
            (dept_id, term_id, user_id, expires_before),
        ).fetchall()
    return [
        {
            'name': row['name'],
            'email': row['email'],
            'role': row['role'],
            'campus': row['campus'],
            'cursor': row['cursor'],
            'activity': row['activity'],
            'tab': row['tab'],
            'course_id': row['course_id'],
            'field': row['field'],
            'seconds_ago': int(max(0, now - float(row['last_seen']))),
        }
        for row in rows
    ]


def clear_presence(dept_id=None, term_id=None):
    init_db()
    with transaction() as conn:
        if dept_id is None and term_id is None:
            conn.execute('DELETE FROM presence')
        elif term_id is None:
            conn.execute('DELETE FROM presence WHERE dept_id=?', (dept_id,))
        else:
            conn.execute('DELETE FROM presence WHERE dept_id=? AND term_id=?', (dept_id, term_id))
