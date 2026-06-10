import atexit
import os
import shutil
import tempfile
import unittest
from http.cookies import SimpleCookie


TEST_DATA_DIR = tempfile.mkdtemp(prefix='paike-auth-test-')
os.environ['SCHED_DATA_DIR'] = TEST_DATA_DIR
os.environ['SCHED_DB_PATH'] = os.path.join(TEST_DATA_DIR, 'schedule.db')
atexit.register(lambda: shutil.rmtree(TEST_DATA_DIR, ignore_errors=True))

import app  # noqa: E402


def cookie_value(response, name):
    cookies = SimpleCookie()
    for header in response.headers.getlist('Set-Cookie'):
        cookies.load(header)
    morsel = cookies.get(name)
    return morsel.value if morsel else ''


class AdminPasswordResetTest(unittest.TestCase):
    def setUp(self):
        app.login_attempts.clear()
        app.sqlite_store.clear_sessions()
        app.save_invites([])

        admin = {
            'id': 'admin-reset-test',
            'email': 'admin-reset@example.com',
            'name': 'Admin',
            'role': 'admin',
            'dept_id': None,
            'created_at': '2026-06-10 00:00:00',
        }
        app.set_user_password(admin, 'adminpass123')

        user = {
            'id': 'user-reset-test',
            'email': 'user-reset@example.com',
            'name': 'User',
            'role': 'user',
            'dept_id': 'gaozhi',
            'password': 'legacy-cleartext',
            'created_at': '2026-06-10 00:00:00',
        }
        app.set_user_password(user, 'oldpass123')
        user['password'] = 'legacy-cleartext'

        app.save_users([admin, user])
        self.client = app.app.test_client()
        login = self.client.post('/api/auth/login', json={
            'email': admin['email'],
            'password': 'adminpass123',
        })
        self.assertEqual(login.status_code, 200)
        self.csrf = cookie_value(login, app.CSRF_COOKIE)
        self.assertTrue(self.csrf)

    def test_admin_reset_password_updates_hash_and_clears_user_sessions(self):
        stale_user_token = app.create_session('user-reset-test')

        reset = self.client.post(
            '/api/admin/users/user-reset-test/reset-password',
            json={'password': 'newpass123'},
            headers={app.CSRF_HEADER: self.csrf},
        )
        self.assertEqual(reset.status_code, 200)
        payload = reset.get_json()
        self.assertTrue(payload.get('ok'))
        self.assertEqual(payload.get('user', {}).get('email'), 'user-reset@example.com')

        user = app.find_user_by_email('user-reset@example.com')
        self.assertTrue(app.verify_password('newpass123', user['salt'], user['password_hash']))
        self.assertFalse(app.verify_password('oldpass123', user['salt'], user['password_hash']))
        self.assertNotIn('password', user)
        self.assertIsNone(app.sqlite_store.get_session(stale_user_token, ttl=app.SESSION_TTL))

        login_client = app.app.test_client()
        old_login = login_client.post('/api/auth/login', json={
            'email': 'user-reset@example.com',
            'password': 'oldpass123',
        })
        self.assertEqual(old_login.status_code, 401)

        new_login = login_client.post('/api/auth/login', json={
            'email': 'user-reset@example.com',
            'password': 'newpass123',
        })
        self.assertEqual(new_login.status_code, 200)
        self.assertEqual(new_login.get_json(), {'ok': True})


if __name__ == '__main__':
    unittest.main()
