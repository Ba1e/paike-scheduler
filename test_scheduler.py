import unittest
from datetime import time

from flask import Flask

from scheduler import (
    Course,
    HeuristicScheduler,
    Room,
    SchedulerDependencyError,
    SchedulingProblem,
    SchedulingSolver,
    Teacher,
    TimeSlot,
)
from scheduler_api import register_scheduler_routes


def sample_problem():
    slots = [
        TimeSlot('sat_A', '周六', 'A', time(8, 30), time(10, 30)),
        TimeSlot('sat_B', '周六', 'B', time(10, 40), time(12, 40)),
    ]
    rooms = [
        Room('r1', '101', '友邦金融中心教学区', 30),
        Room('r2', '102', '友邦金融中心教学区', 30),
    ]
    teachers = {
        't1': Teacher('t1', '张老师', subjects=['数学']),
        't2': Teacher('t2', '李老师', subjects=['英语']),
    }
    courses = [
        Course('c1', 't1', '张老师', '数学', '高一', '1班', '友邦金融中心教学区', 2),
        Course('c2', 't1', '张老师', '数学', '高一', '2班', '友邦金融中心教学区', 2),
        Course('c3', 't2', '李老师', '英语', '高一', '1班', '友邦金融中心教学区', 2),
    ]
    return SchedulingProblem(courses, teachers, rooms, slots)


def assert_no_basic_conflicts(testcase, problem, assignments):
    course_by_id = {course.id: course for course in problem.courses}
    seen_teachers = set()
    seen_rooms = set()
    seen_classes = set()
    for assignment in assignments:
        course = course_by_id[assignment.course_id]
        teacher_key = (course.teacher_id, assignment.slot_id)
        room_key = (assignment.room_id, assignment.slot_id)
        class_key = (course.grade, course.class_name, assignment.slot_id)
        testcase.assertNotIn(teacher_key, seen_teachers)
        testcase.assertNotIn(room_key, seen_rooms)
        testcase.assertNotIn(class_key, seen_classes)
        seen_teachers.add(teacher_key)
        seen_rooms.add(room_key)
        seen_classes.add(class_key)


class SchedulerPrototypeTest(unittest.TestCase):
    def test_heuristic_scheduler_generates_conflict_free_preview(self):
        problem = sample_problem()
        success, assignments = HeuristicScheduler(problem).solve()

        self.assertTrue(success)
        self.assertEqual(len(assignments), len(problem.courses))
        assert_no_basic_conflicts(self, problem, assignments)

    def test_exact_scheduler_missing_dependency_is_explicit(self):
        try:
            import ortools  # noqa: F401
        except ModuleNotFoundError:
            with self.assertRaises(SchedulerDependencyError):
                SchedulingSolver(sample_problem())
        else:
            self.assertIsNotNone(SchedulingSolver(sample_problem()))

    def test_scheduler_api_heuristic_route_works_without_ortools(self):
        app = Flask(__name__)
        register_scheduler_routes(app)
        client = app.test_client()

        payload = {
            'time_slots': [
                {'day': '周六', 'period': 'A', 'time': '08:30-10:30'},
                {'day': '周六', 'period': 'B', 'time': '10:40-12:40'},
            ],
            'rooms': [
                {'id': 'r1', 'name': '101', 'campus': '友邦金融中心教学区'},
                {'id': 'r2', 'name': '102', 'campus': '友邦金融中心教学区'},
            ],
            'teachers': [
                {'id': 't1', 'name': '张老师', 'subjects': ['数学']},
                {'id': 't2', 'name': '李老师', 'subjects': ['英语']},
            ],
            'courses': [
                {
                    'id': 'c1',
                    'teacher_id': 't1',
                    'teacher_name': '张老师',
                    'subject': '数学',
                    'grade': '高一',
                    'class_name': '1班',
                    'campus': '友邦金融中心教学区',
                },
                {
                    'id': 'c2',
                    'teacher_id': 't2',
                    'teacher_name': '李老师',
                    'subject': '英语',
                    'grade': '高一',
                    'class_name': '1班',
                    'campus': '友邦金融中心教学区',
                },
            ],
        }

        response = client.post('/api/scheduler/heuristic', json=payload)
        data = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(data['success'])
        self.assertEqual(data['statistics']['method'], 'heuristic')
        self.assertEqual(len(data['schedule']), 2)

    def test_scheduler_api_exact_route_reports_missing_dependency(self):
        try:
            import ortools  # noqa: F401
        except ModuleNotFoundError:
            app = Flask(__name__)
            register_scheduler_routes(app)
            response = app.test_client().post('/api/scheduler/solve', json={
                'time_slots': [{'day': '周六', 'period': 'A', 'time': '08:30-10:30'}],
                'rooms': [{'id': 'r1', 'name': '101', 'campus': '友邦金融中心教学区'}],
                'teachers': [{'id': 't1', 'name': '张老师'}],
                'courses': [{
                    'id': 'c1',
                    'teacher_id': 't1',
                    'teacher_name': '张老师',
                    'subject': '数学',
                    'grade': '高一',
                    'class_name': '1班',
                    'campus': '友邦金融中心教学区',
                }],
            })
            data = response.get_json()
            self.assertEqual(response.status_code, 501)
            self.assertEqual(data['code'], 'scheduler_dependency_missing')
        else:
            self.skipTest('ortools is installed; missing dependency path is not active')


if __name__ == '__main__':
    unittest.main()
