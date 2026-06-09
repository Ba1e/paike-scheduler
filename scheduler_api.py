"""
智能排课 API 路由
集成到现有 Flask 应用
"""

from flask import Blueprint, jsonify, request, current_app
from datetime import time
import traceback

from scheduler import (
    SchedulerDependencyError,
    SchedulingProblem,
    SchedulingSolver,
    IncrementalScheduler,
    HeuristicScheduler,
    SolverConfig,
    TimeSlot,
    Room,
    Teacher,
    Course,
    Assignment
)

# 创建 Blueprint
scheduler_bp = Blueprint('scheduler', __name__, url_prefix='/api/scheduler')


def parse_time(time_str: str) -> time:
    """解析时间字符串 '08:00' -> time(8, 0)"""
    h, m = map(int, time_str.split(':'))
    return time(h, m)


def build_scheduling_problem(data: dict) -> SchedulingProblem:
    """从请求数据构建排课问题"""

    # 解析时段
    time_slots = []
    for slot_data in data.get('time_slots', []):
        time_range = slot_data.get('time', '').split('-')
        start_time = parse_time(time_range[0]) if len(time_range) >= 1 else time(8, 0)
        end_time = parse_time(time_range[1]) if len(time_range) >= 2 else time(10, 0)

        time_slots.append(TimeSlot(
            id=f"{slot_data['day']}_{slot_data['period']}",
            day=slot_data['day'],
            period=slot_data['period'],
            start_time=start_time,
            end_time=end_time
        ))

    # 解析教室
    rooms = []
    for room_data in data.get('rooms', []):
        rooms.append(Room(
            id=room_data['id'],
            name=room_data['name'],
            campus=room_data['campus'],
            capacity=room_data.get('capacity', 30),
            type=room_data.get('type', '普通教室'),
            facilities=room_data.get('facilities', [])
        ))

    # 解析教师
    teachers = {}
    for teacher_data in data.get('teachers', []):
        teachers[teacher_data['id']] = Teacher(
            id=teacher_data['id'],
            name=teacher_data['name'],
            subjects=teacher_data.get('subjects', []),
            max_hours_per_day=teacher_data.get('max_hours_per_day', 8),
            max_hours_per_week=teacher_data.get('max_hours_per_week', 40),
            unavailable_slots=set(teacher_data.get('unavailable_slots', [])),
            home_campus=teacher_data.get('home_campus', '')
        )

    # 解析课程
    courses = []
    for course_data in data.get('courses', []):
        courses.append(Course(
            id=course_data['id'],
            teacher_id=course_data['teacher_id'],
            teacher_name=course_data['teacher_name'],
            subject=course_data['subject'],
            grade=course_data['grade'],
            class_name=course_data['class_name'],
            campus=course_data['campus'],
            duration=course_data.get('duration', 2.0),
            room_type=course_data.get('room_type', '普通教室'),
            preferred_slots=course_data.get('preferred_slots', []),
            constraints=course_data.get('constraints', {})
        ))

    # 解析已有排课
    existing_assignments = []
    for assign_data in data.get('existing_assignments', []):
        existing_assignments.append(Assignment(
            course_id=assign_data['course_id'],
            slot_id=assign_data['slot_id'],
            room_id=assign_data['room_id'],
            confidence=assign_data.get('confidence', 1.0)
        ))

    problem = SchedulingProblem(
        courses=courses,
        teachers=teachers,
        rooms=rooms,
        time_slots=time_slots,
        existing_assignments=existing_assignments
    )

    return problem


@scheduler_bp.route('/solve', methods=['POST'])
def solve_schedule():
    """自动排课主接口

    POST /api/scheduler/solve
    Body: {
      "courses": [...],
      "teachers": [...],
      "rooms": [...],
      "time_slots": [...],
      "config": {
        "max_time_seconds": 30,
        "optimization_level": 2
      }
    }

    Response: {
      "success": true,
      "schedule": [...],
      "statistics": {...},
      "unscheduled_courses": [...]
    }
    """
    try:
        data = request.get_json(silent=True) or {}

        # 1. 构建问题
        problem = build_scheduling_problem(data)

        # 验证问题定义
        errors = problem.validate()
        if errors:
            return jsonify({
                'success': False,
                'error': '问题定义有误',
                'details': errors
            }), 400

        current_app.logger.info(f"开始求解排课问题: {problem.summary()}")

        # 2. 配置求解器
        config_data = data.get('config', {})
        config = SolverConfig(
            max_time_seconds=config_data.get('max_time_seconds', 30),
            num_workers=config_data.get('num_workers', 4),
            optimization_level=config_data.get('optimization_level', 2)
        )

        # 3. 求解
        solver = SchedulingSolver(problem, config)
        success, assignments = solver.solve()

        if not success:
            return jsonify({
                'success': False,
                'error': '无法找到可行解',
                'suggestions': [
                    '减少课程数量',
                    '增加可用时段',
                    '放宽教师工作时间限制'
                ]
            }), 200

        # 4. 格式化输出
        scheduled_course_ids = set(a.course_id for a in assignments)
        unscheduled_courses = [
            {
                'course_id': c.id,
                'teacher': c.teacher_name,
                'subject': c.subject,
                'reason': '约束冲突或资源不足'
            }
            for c in problem.courses
            if c.id not in scheduled_course_ids
        ]

        return jsonify({
            'success': True,
            'schedule': [
                {
                    'course_id': a.course_id,
                    'slot_id': a.slot_id,
                    'room_id': a.room_id,
                    'confidence': a.confidence
                }
                for a in assignments
            ],
            'statistics': {
                'total_courses': len(problem.courses),
                'scheduled': len(assignments),
                'unscheduled': len(unscheduled_courses),
                'solve_time_seconds': solver.solve_time,
                'success_rate': (len(assignments) / len(problem.courses) * 100) if problem.courses else 0
            },
            'unscheduled_courses': unscheduled_courses
        })

    except SchedulerDependencyError as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'scheduler_dependency_missing',
            'fallback': '/api/scheduler/heuristic'
        }), 501
    except Exception as e:
        current_app.logger.error(f"排课求解失败: {str(e)}\n{traceback.format_exc()}")
        return jsonify({
            'success': False,
            'error': '排课求解失败，请检查输入数据或服务器日志'
        }), 500


@scheduler_bp.route('/incremental', methods=['POST'])
def incremental_schedule():
    """增量排课接口

    用于在已有排课基础上增量添加新课程

    POST /api/scheduler/incremental
    Body: {
      "courses": [新课程],
      "teachers": [...],
      "rooms": [...],
      "time_slots": [...],
      "fixed_assignments": [已有排课]
    }
    """
    try:
        data = request.get_json(silent=True) or {}

        # 构建问题
        problem = build_scheduling_problem(data)

        # 提取固定分配
        fixed_assignments = []
        for assign_data in data.get('fixed_assignments', []):
            fixed_assignments.append(Assignment(
                course_id=assign_data['course_id'],
                slot_id=assign_data['slot_id'],
                room_id=assign_data['room_id'],
                confidence=1.0
            ))

        current_app.logger.info(f"增量排课: {len(problem.courses)}门新课, {len(fixed_assignments)}门固定")

        # 配置
        config_data = data.get('config', {})
        config = SolverConfig(
            max_time_seconds=config_data.get('max_time_seconds', 30)
        )

        # 求解
        solver = IncrementalScheduler(problem, fixed_assignments, config)
        success, all_assignments = solver.solve()

        if not success:
            return jsonify({
                'success': False,
                'error': '无法找到增量解',
            }), 200

        # 区分新增和固定
        fixed_ids = set(a.course_id for a in fixed_assignments)
        new_assignments = [a for a in all_assignments if a.course_id not in fixed_ids]

        return jsonify({
            'success': True,
            'new_schedule': [
                {
                    'course_id': a.course_id,
                    'slot_id': a.slot_id,
                    'room_id': a.room_id
                }
                for a in new_assignments
            ],
            'statistics': {
                'new_courses': len(new_assignments),
                'fixed_courses': len(fixed_assignments)
            }
        })

    except SchedulerDependencyError as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'code': 'scheduler_dependency_missing',
            'fallback': '/api/scheduler/heuristic'
        }), 501
    except Exception as e:
        current_app.logger.error(f"增量排课失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': '增量排课失败，请检查输入数据或服务器日志'
        }), 500


@scheduler_bp.route('/heuristic', methods=['POST'])
def heuristic_schedule():
    """启发式快速排课

    使用贪心算法快速生成初始解，适用于大规模问题的快速预览

    POST /api/scheduler/heuristic
    """
    try:
        data = request.get_json(silent=True) or {}
        problem = build_scheduling_problem(data)

        current_app.logger.info(f"启发式排课: {len(problem.courses)}门课")

        solver = HeuristicScheduler(problem)
        success, assignments = solver.solve()

        return jsonify({
            'success': success,
            'schedule': [
                {
                    'course_id': a.course_id,
                    'slot_id': a.slot_id,
                    'room_id': a.room_id,
                    'confidence': a.confidence
                }
                for a in assignments
            ],
            'statistics': {
                'total_courses': len(problem.courses),
                'scheduled': len(assignments),
                'method': 'heuristic'
            }
        })

    except Exception as e:
        current_app.logger.error(f"启发式排课失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': '启发式排课失败，请检查输入数据或服务器日志'
        }), 500


@scheduler_bp.route('/validate', methods=['POST'])
def validate_schedule():
    """验证排课方案

    检查给定的排课方案是否违反硬约束

    POST /api/scheduler/validate
    Body: {
      "courses": [...],
      "teachers": [...],
      "assignments": [...]
    }

    Response: {
      "valid": true,
      "violations": []
    }
    """
    try:
        data = request.get_json(silent=True) or {}
        problem = build_scheduling_problem(data)

        assignments_data = data.get('assignments', [])
        assignments = [
            Assignment(
                course_id=a['course_id'],
                slot_id=a['slot_id'],
                room_id=a['room_id']
            )
            for a in assignments_data
        ]

        # 验证逻辑
        violations = []

        # 构建占用表
        teacher_occupied = {}
        room_occupied = {}
        class_occupied = {}

        for assign in assignments:
            course = next((c for c in problem.courses if c.id == assign.course_id), None)
            if not course:
                violations.append(f"课程 {assign.course_id} 不存在")
                continue

            # 检查教师冲突
            key = (course.teacher_id, assign.slot_id)
            if key in teacher_occupied:
                other_course = teacher_occupied[key]
                violations.append(
                    f"教师冲突: {course.teacher_name} 在 {assign.slot_id} 同时有课程 {course.id} 和 {other_course}"
                )
            teacher_occupied[key] = course.id

            # 检查教室冲突
            key = (assign.room_id, assign.slot_id)
            if key in room_occupied:
                other_course = room_occupied[key]
                violations.append(
                    f"教室冲突: {assign.room_id} 在 {assign.slot_id} 同时有课程 {course.id} 和 {other_course}"
                )
            room_occupied[key] = course.id

            # 检查班级冲突
            key = (course.grade, course.class_name, assign.slot_id)
            if key in class_occupied:
                other_course = class_occupied[key]
                violations.append(
                    f"班级冲突: {course.grade}{course.class_name} 在 {assign.slot_id} 同时有课程 {course.id} 和 {other_course}"
                )
            class_occupied[key] = course.id

        return jsonify({
            'valid': len(violations) == 0,
            'violations': violations,
            'checked_assignments': len(assignments)
        })

    except Exception as e:
        current_app.logger.error(f"验证失败: {str(e)}")
        return jsonify({
            'valid': False,
            'error': '验证失败，请检查输入数据或服务器日志'
        }), 500


# 注册到 Flask app
def register_scheduler_routes(app):
    """将排课路由注册到 Flask app"""
    app.register_blueprint(scheduler_bp)
    app.logger.info("智能排课 API 已注册")


if __name__ == '__main__':
    print("智能排课 API 模块")
    print("使用方法:")
    print("  from scheduler_api import register_scheduler_routes")
    print("  register_scheduler_routes(app)")
