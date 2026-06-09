"""
智能排课系统完整演示
演示如何使用智能排课算法
"""

from datetime import time

from scheduler import (
    TimeSlot,
    Room,
    Teacher,
    Course,
    SchedulingProblem,
    SchedulerDependencyError,
    SchedulingSolver,
    HeuristicScheduler,
    SolverConfig
)


def create_demo_problem():
    """创建一个演示用的排课问题"""

    # 1. 定义时间段（周一到周五，每天5个时段）
    time_slots = []
    days = ['周一', '周二', '周三', '周四', '周五']
    periods = [
        ('早一', '08:00', '10:00'),
        ('早二', '10:20', '12:20'),
        ('下一', '13:30', '15:30'),
        ('下二', '15:50', '17:50'),
        ('晚', '18:30', '20:30')
    ]

    for day in days:
        for period, start, end in periods:
            time_slots.append(TimeSlot(
                id=f"{day}_{period}",
                day=day,
                period=period,
                start_time=time(*map(int, start.split(':'))),
                end_time=time(*map(int, end.split(':')))
            ))

    print(f"✅ 创建时间段: {len(time_slots)}个")

    # 2. 定义教室
    rooms = [
        # 友邦金融中心教学区
        Room('r1', '301', '友邦金融中心教学区', 30, '普通教室'),
        Room('r2', '302', '友邦金融中心教学区', 30, '普通教室'),
        Room('r3', '303', '友邦金融中心教学区', 25, '实验室'),

        # 映月湖环宇城教学区
        Room('r4', '201', '映月湖环宇城教学区', 35, '普通教室'),
        Room('r5', '202', '映月湖环宇城教学区', 30, '普通教室'),

        # 新南万教学区
        Room('r6', '101', '新南万教学区', 30, '普通教室'),
        Room('r7', '102', '新南万教学区', 28, '多媒体'),
    ]

    print(f"✅ 创建教室: {len(rooms)}间")

    # 3. 定义教师
    teachers = {
        't1': Teacher(
            id='t1',
            name='张三',
            subjects=['数学'],
            max_hours_per_day=8,
            max_hours_per_week=40,
            unavailable_slots={'周五_晚'},  # 周五晚上不可用
            home_campus='友邦金融中心教学区'
        ),
        't2': Teacher(
            id='t2',
            name='李四',
            subjects=['英语'],
            max_hours_per_day=6,
            max_hours_per_week=30,
            unavailable_slots=set(),
            home_campus='友邦金融中心教学区'
        ),
        't3': Teacher(
            id='t3',
            name='王五',
            subjects=['物理'],
            max_hours_per_day=8,
            max_hours_per_week=40,
            unavailable_slots=set(),
            home_campus='映月湖环宇城教学区'
        ),
        't4': Teacher(
            id='t4',
            name='赵六',
            subjects=['化学'],
            max_hours_per_day=6,
            max_hours_per_week=35,
            unavailable_slots={'周一_早一', '周三_早一'},  # 周一周三早上不可用
            home_campus='新南万教学区'
        ),
    }

    print(f"✅ 创建教师: {len(teachers)}位")

    # 4. 定义课程
    courses = [
        # 友邦金融中心教学区 - 张三（数学）
        Course('c1', 't1', '张三', '数学', '高一', '1班', '友邦金融中心教学区', 2.0,
               preferred_slots=['周一_早一', '周三_早一']),
        Course('c2', 't1', '张三', '数学', '高一', '2班', '友邦金融中心教学区', 2.0,
               preferred_slots=['周一_早二']),
        Course('c3', 't1', '张三', '数学', '高二', '1班', '友邦金融中心教学区', 2.0),

        # 友邦金融中心教学区 - 李四（英语）
        Course('c4', 't2', '李四', '英语', '高一', '1班', '友邦金融中心教学区', 2.0),
        Course('c5', 't2', '李四', '英语', '高一', '2班', '友邦金融中心教学区', 2.0),
        Course('c6', 't2', '李四', '英语', '高二', '1班', '友邦金融中心教学区', 2.0),

        # 映月湖环宇城教学区 - 王五（物理）
        Course('c7', 't3', '王五', '物理', '高一', '3班', '映月湖环宇城教学区', 2.0),
        Course('c8', 't3', '王五', '物理', '高一', '4班', '映月湖环宇城教学区', 2.0),
        Course('c9', 't3', '王五', '物理', '高二', '2班', '映月湖环宇城教学区', 2.0),

        # 新南万教学区 - 赵六（化学）
        Course('c10', 't4', '赵六', '化学', '高一', '5班', '新南万教学区', 2.0),
        Course('c11', 't4', '赵六', '化学', '高二', '3班', '新南万教学区', 2.0),

        # 跨校区课程（测试跨校区惩罚）
        Course('c12', 't1', '张三', '数学', '高一', '3班', '映月湖环宇城教学区', 2.0),
    ]

    print(f"✅ 创建课程: {len(courses)}门")

    # 5. 创建排课问题
    problem = SchedulingProblem(
        courses=courses,
        teachers=teachers,
        rooms=rooms,
        time_slots=time_slots,
        existing_assignments=[]
    )

    # 验证问题
    errors = problem.validate()
    if errors:
        print("❌ 问题定义错误:")
        for err in errors:
            print(f"   - {err}")
        return None

    print(f"\n{problem.summary()}\n")

    return problem


def print_schedule(problem, assignments):
    """打印排课结果"""

    print("\n" + "="*80)
    print("📅 排课结果")
    print("="*80 + "\n")

    # 按教师分组
    teacher_schedules = {}
    for assign in assignments:
        course = next((c for c in problem.courses if c.id == assign.course_id), None)
        if not course:
            continue

        if course.teacher_name not in teacher_schedules:
            teacher_schedules[course.teacher_name] = []

        slot = next((s for s in problem.time_slots if s.id == assign.slot_id), None)
        room = next((r for r in problem.rooms if r.id == assign.room_id), None)

        teacher_schedules[course.teacher_name].append({
            'course': course,
            'slot': slot,
            'room': room
        })

    # 打印每个教师的排课
    for teacher_name, schedules in sorted(teacher_schedules.items()):
        print(f"👨‍🏫 {teacher_name}")
        print("-" * 80)

        # 按时间排序
        schedules.sort(key=lambda x: (x['slot'].day, x['slot'].period))

        total_hours = 0
        campuses = set()

        for item in schedules:
            course = item['course']
            slot = item['slot']
            room = item['room']

            total_hours += course.duration
            campuses.add(course.campus)

            print(f"  {slot.day:6} {slot.period:4} | "
                  f"{course.subject:6} {course.grade}{course.class_name:4} | "
                  f"{room.campus:20} {room.name:6} | "
                  f"{course.duration}h")

        print(f"\n  总课时: {total_hours}h  |  涉及校区: {len(campuses)}个")

        if len(campuses) > 1:
            print(f"  ⚠️  跨校区: {', '.join(campuses)}")

        print()

    # 检查跨校区情况
    print("\n" + "="*80)
    print("🚗 跨校区统计")
    print("="*80 + "\n")

    for teacher_name, schedules in sorted(teacher_schedules.items()):
        days = {}
        for item in schedules:
            day = item['slot'].day
            if day not in days:
                days[day] = set()
            days[day].add(item['course'].campus)

        cross_campus_days = {day: campuses for day, campuses in days.items() if len(campuses) > 1}

        if cross_campus_days:
            print(f"👨‍🏫 {teacher_name}")
            for day, campuses in sorted(cross_campus_days.items()):
                print(f"   {day}: {len(campuses)}个校区 - {', '.join(campuses)}")
        else:
            print(f"👨‍🏫 {teacher_name}: ✅ 无跨校区")

    print()


def main():
    """主函数"""

    print("="*80)
    print("🎓 智能排课系统演示")
    print("="*80 + "\n")

    # 1. 创建问题
    problem = create_demo_problem()
    if not problem:
        return

    # 2. 配置求解器
    config = SolverConfig(
        max_time_seconds=30,  # 最多30秒
        num_workers=4,        # 4个并行worker
        optimization_level=2  # 质量优先
    )

    print(f"⚙️  求解器配置:")
    print(f"   最大时间: {config.max_time_seconds}秒")
    print(f"   并行度: {config.num_workers}")
    print(f"   优化级别: {config.optimization_level}\n")

    # 3. 求解
    print("="*80)
    try:
        solver = SchedulingSolver(problem, config)
        success, assignments = solver.solve()
    except SchedulerDependencyError as exc:
        print(f"精确求解器不可用：{exc}")
        print("改用启发式排课器生成预览方案。")
        solver = HeuristicScheduler(problem)
        success, assignments = solver.solve()
    print("="*80 + "\n")

    if not success:
        print("❌ 求解失败，无法找到可行解")
        return

    # 4. 打印结果
    print_schedule(problem, assignments)

    # 5. 统计信息
    print("="*80)
    print("📊 统计信息")
    print("="*80)
    if hasattr(solver, 'get_statistics'):
        stats = solver.get_statistics()
        print(f"  求解时间: {stats['solve_time_seconds']:.2f}秒")
        print(f"  总课程数: {stats['total_courses']}")
        print(f"  成功排课: {stats['scheduled_courses']}")
        print(f"  决策变量: {stats['total_variables']}")
        print(f"  约束条件: {stats['total_constraints']}")
    else:
        print("  求解方法: 启发式预览")
        print(f"  总课程数: {len(problem.courses)}")
        print(f"  成功排课: {len(assignments)}")
    print()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n用户中断")
    except Exception as e:
        print(f"\n\n❌ 错误: {e}")
        import traceback
        traceback.print_exc()
