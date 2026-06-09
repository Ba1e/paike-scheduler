"""
智能排课求解器
基于 Google OR-Tools CP-SAT
"""

from __future__ import annotations

from typing import List, Dict, Optional, Tuple
import time
from dataclasses import dataclass

from .models import *
from .constraints import SchedulerDependencyError, SchedulingConstraints, cp_model, require_ortools


@dataclass
class SolverConfig:
    """求解器配置"""
    max_time_seconds: int = 30  # 最大求解时间
    num_workers: int = 4  # 并行worker数
    log_search_progress: bool = True
    find_all_solutions: bool = False  # 是否找所有解
    optimization_level: int = 2  # 0=快速, 1=平衡, 2=质量优先


class SchedulingSolver:
    """排课求解器"""

    def __init__(self, problem: SchedulingProblem, config: Optional[SolverConfig] = None):
        require_ortools()
        self.problem = problem
        self.config = config or SolverConfig()
        self.model = cp_model.CpModel()
        self.constraints_manager = SchedulingConstraints(self.model, problem)
        self.solution = None
        self.solve_time = 0

    def solve(self) -> Tuple[bool, Optional[List[Assignment]]]:
        """
        求解排课问题

        Returns:
            (success, assignments): 成功标志和排课方案
        """
        start_time = time.time()

        # 1. 创建决策变量
        print("📊 创建决策变量...")
        variables = self.constraints_manager.create_variables()
        print(f"   变量数: {self._count_variables(variables)}")

        # 2. 添加硬约束
        print("🔒 添加硬约束...")
        self.constraints_manager.add_hard_constraints()
        print(f"   约束数: {len(self.model.Proto().constraints)}")

        # 3. 添加软约束并设置优化目标
        print("🎯 添加软约束和优化目标...")
        penalty = self.constraints_manager.add_soft_constraints()
        self.model.Minimize(penalty)

        # 4. 配置求解器
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.config.max_time_seconds
        solver.parameters.num_search_workers = self.config.num_workers
        solver.parameters.log_search_progress = self.config.log_search_progress

        # 优化等级
        if self.config.optimization_level == 0:
            # 快速模式：找到第一个可行解即停止
            solver.parameters.linearization_level = 0
        elif self.config.optimization_level == 1:
            # 平衡模式
            solver.parameters.linearization_level = 1
        else:
            # 质量优先：深度搜索
            solver.parameters.linearization_level = 2

        # 5. 求解
        print("🚀 开始求解...")
        status = solver.Solve(self.model)

        self.solve_time = time.time() - start_time

        # 6. 处理结果
        if status == cp_model.OPTIMAL:
            print(f"✅ 找到最优解！(耗时 {self.solve_time:.2f}s)")
            assignments = self._extract_solution(solver, variables)
            self.solution = assignments
            return True, assignments

        elif status == cp_model.FEASIBLE:
            print(f"✅ 找到可行解（非最优）(耗时 {self.solve_time:.2f}s)")
            assignments = self._extract_solution(solver, variables)
            self.solution = assignments
            return True, assignments

        elif status == cp_model.INFEASIBLE:
            print("❌ 无可行解！约束过于严格。")
            self._diagnose_infeasibility()
            return False, None

        else:
            print(f"⚠️  求解超时或其他问题 (状态码: {status})")
            return False, None

    def _count_variables(self, variables: Dict) -> int:
        """统计变量总数"""
        count = 0
        for course_vars in variables.values():
            for slot_vars in course_vars.values():
                count += len(slot_vars)
        return count

    def _extract_solution(self, solver: cp_model.CpSolver, variables: Dict) -> List[Assignment]:
        """从求解结果中提取排课方案"""
        assignments = []

        for course_id, slot_vars in variables.items():
            for slot_id, room_vars in slot_vars.items():
                for room_id, var in room_vars.items():
                    if solver.Value(var) == 1:
                        assignments.append(Assignment(
                            course_id=course_id,
                            slot_id=slot_id,
                            room_id=room_id,
                            confidence=1.0  # CP-SAT给出的是确定解
                        ))

        return assignments

    def _diagnose_infeasibility(self):
        """诊断无解原因"""
        print("\n🔍 诊断无解原因：")

        # 检查1: 教师工作时间是否过载
        teacher_workload = {}
        for c in self.problem.courses:
            if c.teacher_id not in teacher_workload:
                teacher_workload[c.teacher_id] = 0
            teacher_workload[c.teacher_id] += c.duration

        for teacher_id, total_hours in teacher_workload.items():
            teacher = self.problem.teachers.get(teacher_id)
            if teacher:
                max_week_hours = teacher.max_hours_per_week
                if total_hours > max_week_hours:
                    print(f"   ⚠️  教师 {teacher.name} 总课时 {total_hours}h 超过周上限 {max_week_hours}h")

        # 检查2: 时段是否足够
        days = set(s.day for s in self.problem.time_slots)
        total_available_slots = len(self.problem.time_slots)
        total_courses = len(self.problem.courses)

        print(f"   📅 可用时段: {total_available_slots} ({len(days)}天)")
        print(f"   📚 待排课程: {total_courses}")

        if total_courses > total_available_slots:
            print(f"   ⚠️  课程数量超过可用时段！")

        # 检查3: 教室是否足够
        campus_rooms = {}
        for r in self.problem.rooms:
            if r.campus not in campus_rooms:
                campus_rooms[r.campus] = 0
            campus_rooms[r.campus] += 1

        campus_courses = {}
        for c in self.problem.courses:
            if c.campus not in campus_courses:
                campus_courses[c.campus] = 0
            campus_courses[c.campus] += 1

        for campus, course_count in campus_courses.items():
            room_count = campus_rooms.get(campus, 0)
            print(f"   🏫 {campus}: {course_count}门课, {room_count}间教室")

            # 粗略检查：如果课程数 > 教室数 * 时段数，肯定排不下
            capacity = room_count * total_available_slots
            if course_count > capacity:
                print(f"      ⚠️  该校区教室不足！理论容量 {capacity}，需求 {course_count}")

        print("\n💡 建议：")
        print("   1. 减少课程数量")
        print("   2. 增加可用时段")
        print("   3. 增加教室资源")
        print("   4. 放宽某些硬约束（如教师每天课时上限）")

    def get_statistics(self) -> Dict:
        """获取求解统计信息"""
        if not self.solution:
            return {}

        return {
            'solve_time_seconds': self.solve_time,
            'total_courses': len(self.problem.courses),
            'scheduled_courses': len(self.solution),
            'total_variables': self._count_variables(self.constraints_manager.variables),
            'total_constraints': len(self.model.Proto().constraints)
        }


class IncrementalScheduler:
    """增量排课求解器

    用于在已有排课基础上增量添加新课程，而不改动已排好的课程。
    适用场景：学期中途新开课程。
    """

    def __init__(self,
                 problem: SchedulingProblem,
                 fixed_assignments: List[Assignment],
                 config: Optional[SolverConfig] = None):
        self.problem = problem
        self.fixed_assignments = fixed_assignments
        self.config = config or SolverConfig()

    def solve(self) -> Tuple[bool, Optional[List[Assignment]]]:
        """增量求解"""

        # 1. 将固定分配转换为约束
        fixed_course_ids = set(a.course_id for a in self.fixed_assignments)
        new_courses = [c for c in self.problem.courses if c.id not in fixed_course_ids]

        print(f"📌 固定课程: {len(fixed_course_ids)}")
        print(f"🆕 新增课程: {len(new_courses)}")

        # 2. 在完整问题上求解，并通过 existing_assignments 固定已排课程。
        full_problem = SchedulingProblem(
            courses=self.problem.courses,
            teachers=self.problem.teachers,
            rooms=self.problem.rooms,
            time_slots=self.problem.time_slots,
            existing_assignments=self.fixed_assignments
        )
        solver = SchedulingSolver(full_problem, self.config)

        success, new_assignments = solver.solve()

        if success:
            # 合并固定分配和新分配
            all_assignments = self.fixed_assignments + new_assignments
            return True, all_assignments
        else:
            return False, None

    def _add_existing_constraints(self, constraints_mgr: SchedulingConstraints):
        """添加已有排课的占位约束"""
        x = constraints_mgr.variables

        # 对于每个固定的分配，禁止新课程使用该时段+教室
        for fixed in self.fixed_assignments:
            # 找到对应的教师
            fixed_course = next(
                (c for c in self.problem.courses if c.id == fixed.course_id),
                None
            )
            if not fixed_course:
                continue

            # 该教师在该时段不能再排课
            teacher_courses = [c for c in constraints_mgr.problem.courses
                             if c.teacher_id == fixed_course.teacher_id]

            for c in teacher_courses:
                if fixed.slot_id in x.get(c.id, {}):
                    # 该时段该教师已被占用
                    slot_vars = x[c.id][fixed.slot_id]
                    constraints_mgr.model.Add(
                        sum(slot_vars.values()) == 0
                    )

            # 该教室在该时段不能再排课
            for c in constraints_mgr.problem.courses:
                if c.campus == fixed_course.campus:
                    if fixed.slot_id in x.get(c.id, {}):
                        if fixed.room_id in x[c.id][fixed.slot_id]:
                            constraints_mgr.model.Add(
                                x[c.id][fixed.slot_id][fixed.room_id] == 0
                            )


class HeuristicScheduler:
    """启发式排课器

    使用贪心策略快速生成初始解，可作为CP-SAT的warm start。
    适用场景：数百门课程的快速预排。
    """

    def __init__(self, problem: SchedulingProblem):
        self.problem = problem

    def solve(self) -> Tuple[bool, List[Assignment]]:
        """启发式求解"""

        assignments = []

        # 占用表
        teacher_occupied = {}  # {(teacher_id, slot_id): True}
        room_occupied = {}     # {(room_id, slot_id): True}
        class_occupied = {}    # {(grade, class_name, slot_id): True}

        # 按优先级排序课程
        sorted_courses = self._prioritize_courses(self.problem.courses)

        for course in sorted_courses:
            # 找到第一个可用的时段+教室
            assigned = False

            for slot in self.problem.time_slots:
                # 检查教师是否可用
                if (course.teacher_id, slot.id) in teacher_occupied:
                    continue

                # 检查班级是否可用
                class_key = (course.grade, course.class_name, slot.id)
                if class_key in class_occupied:
                    continue

                # 找可用教室
                valid_rooms = [r for r in self.problem.rooms
                             if r.campus == course.campus]

                for room in valid_rooms:
                    if (room.id, slot.id) not in room_occupied:
                        # 找到可用分配
                        assignments.append(Assignment(
                            course_id=course.id,
                            slot_id=slot.id,
                            room_id=room.id,
                            confidence=0.8  # 启发式解的置信度较低
                        ))

                        # 标记占用
                        teacher_occupied[(course.teacher_id, slot.id)] = True
                        room_occupied[(room.id, slot.id)] = True
                        class_occupied[class_key] = True

                        assigned = True
                        break

                if assigned:
                    break

            if not assigned:
                print(f"⚠️  课程 {course.id} 无法分配")

        success = len(assignments) == len(self.problem.courses)
        return success, assignments

    def _prioritize_courses(self, courses: List[Course]) -> List[Course]:
        """课程优先级排序

        优先级规则：
        1. 有偏好时段的课程优先
        2. 课时长的课程优先（更难排）
        3. 跨校区教师的课程优先（约束更多）
        """

        def priority_score(c: Course) -> Tuple:
            has_preference = 1 if c.preferred_slots else 0
            return (
                -has_preference,  # 有偏好的排前面
                -c.duration,      # 课时长的排前面
                c.id              # 稳定排序
            )

        return sorted(courses, key=priority_score)


if __name__ == '__main__':
    # 简单测试
    print("智能排课求解器模块已加载")
    print("使用示例请参考 scheduler_demo.py")
