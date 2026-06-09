"""
约束定义模块
包含硬约束和软约束的实现
"""

from __future__ import annotations

from typing import Dict, List

try:
    from ortools.sat.python import cp_model
except ModuleNotFoundError:
    cp_model = None

from .models import SchedulingProblem


class SchedulerDependencyError(RuntimeError):
    """Raised when the exact CP-SAT scheduler is used without OR-Tools."""


def require_ortools():
    if cp_model is None:
        raise SchedulerDependencyError('精确排课求解需要安装可选依赖 ortools。')

class SchedulingConstraints:
    """约束管理器"""

    def __init__(self, model: cp_model.CpModel, problem: SchedulingProblem):
        require_ortools()
        self.model = model
        self.problem = problem
        self.variables = {}  # 决策变量

    def create_variables(self) -> Dict:
        """创建决策变量

        x[course_id][slot_id][room_id] = 1 表示课程在该时段的该教室上课

        Returns:
            变量字典
        """
        courses = self.problem.courses
        slots = self.problem.time_slots
        rooms = self.problem.rooms

        x = {}
        for c in courses:
            x[c.id] = {}
            for s in slots:
                x[c.id][s.id] = {}
                # 只考虑与课程校区匹配的教室
                valid_rooms = [r for r in rooms if r.campus == c.campus]
                for r in valid_rooms:
                    var_name = f'x_{c.id}_{s.id}_{r.id}'
                    x[c.id][s.id][r.id] = self.model.NewBoolVar(var_name)

        self.variables = x
        return x

    def add_hard_constraints(self):
        """添加硬约束（必须满足）"""
        self._constraint_each_course_once()
        self._constraint_teacher_uniqueness()
        self._constraint_room_uniqueness()
        self._constraint_class_uniqueness()
        self._constraint_teacher_workload()
        self._constraint_teacher_availability()
        self._constraint_existing_assignments()

    def _constraint_each_course_once(self):
        """H1: 每门课程必须且仅分配一个时段+教室"""
        x = self.variables

        for c in self.problem.courses:
            terms = []
            for s in self.problem.time_slots:
                if s.id not in x[c.id]:
                    continue
                for r in self.problem.rooms:
                    if r.campus == c.campus and r.id in x[c.id][s.id]:
                        terms.append(x[c.id][s.id][r.id])

            self.model.Add(sum(terms) == 1)

    def _constraint_teacher_uniqueness(self):
        """H2: 教师时段唯一性（同一时段最多一门课）"""
        x = self.variables

        for teacher_id in self.problem.teachers:
            teacher_courses = [c for c in self.problem.courses
                             if c.teacher_id == teacher_id]

            for s in self.problem.time_slots:
                terms = []
                for c in teacher_courses:
                    if s.id not in x[c.id]:
                        continue
                    for r in self.problem.rooms:
                        if r.campus == c.campus and r.id in x[c.id][s.id]:
                            terms.append(x[c.id][s.id][r.id])

                if terms:
                    self.model.Add(sum(terms) <= 1)

    def _constraint_room_uniqueness(self):
        """H3: 教室时段唯一性"""
        x = self.variables

        for r in self.problem.rooms:
            for s in self.problem.time_slots:
                terms = []
                campus_courses = [c for c in self.problem.courses
                                if c.campus == r.campus]

                for c in campus_courses:
                    if s.id in x[c.id] and r.id in x[c.id][s.id]:
                        terms.append(x[c.id][s.id][r.id])

                if terms:
                    self.model.Add(sum(terms) <= 1)

    def _constraint_class_uniqueness(self):
        """H4: 班级时段唯一性"""
        x = self.variables

        # 按班级分组
        class_courses = {}
        for c in self.problem.courses:
            key = (c.grade, c.class_name)
            if key not in class_courses:
                class_courses[key] = []
            class_courses[key].append(c)

        for (grade, class_name), courses in class_courses.items():
            for s in self.problem.time_slots:
                terms = []
                for c in courses:
                    if s.id not in x[c.id]:
                        continue
                    for r in self.problem.rooms:
                        if r.campus == c.campus and r.id in x[c.id][s.id]:
                            terms.append(x[c.id][s.id][r.id])

                if terms:
                    self.model.Add(sum(terms) <= 1)

    def _constraint_teacher_workload(self):
        """H5: 教师工作时间限制（每天）"""
        x = self.variables

        for teacher_id, teacher in self.problem.teachers.items():
            teacher_courses = [c for c in self.problem.courses
                             if c.teacher_id == teacher_id]

            days = set(s.day for s in self.problem.time_slots)
            for day in days:
                day_slots = [s for s in self.problem.time_slots if s.day == day]

                terms = []
                for c in teacher_courses:
                    for s in day_slots:
                        if s.id not in x[c.id]:
                            continue
                        for r in self.problem.rooms:
                            if r.campus == c.campus and r.id in x[c.id][s.id]:
                                terms.append(x[c.id][s.id][r.id] * int(c.duration))

                if terms:
                    self.model.Add(sum(terms) <= teacher.max_hours_per_day)

    def _constraint_teacher_availability(self):
        """H6: 教师不可用时段"""
        x = self.variables

        for teacher_id, teacher in self.problem.teachers.items():
            teacher_courses = [c for c in self.problem.courses
                             if c.teacher_id == teacher_id]

            for unavailable_slot_id in teacher.unavailable_slots:
                terms = []
                for c in teacher_courses:
                    if unavailable_slot_id in x[c.id]:
                        for r in self.problem.rooms:
                            if r.campus == c.campus and r.id in x[c.id][unavailable_slot_id]:
                                terms.append(x[c.id][unavailable_slot_id][r.id])

                if terms:
                    self.model.Add(sum(terms) == 0)

    def _constraint_existing_assignments(self):
        """H7: 已有排课不可改动，用于增量排课。"""
        x = self.variables
        for assignment in self.problem.existing_assignments:
            course_vars = x.get(assignment.course_id)
            if not course_vars:
                continue
            for slot_id, room_vars in course_vars.items():
                for room_id, var in room_vars.items():
                    self.model.Add(var == int(
                        slot_id == assignment.slot_id and room_id == assignment.room_id
                    ))

    def add_soft_constraints(self) -> cp_model.IntVar:
        """添加软约束，返回总惩罚值

        软约束通过惩罚机制实现：
        - 违反约束增加惩罚
        - 满足偏好减少惩罚（负值）
        """
        penalties = []

        # S1: 最小化教师跨校区
        penalties.extend(self._soft_minimize_cross_campus())

        # S2: 偏好时段奖励
        penalties.extend(self._soft_preferred_slots())

        # S3: 课程均衡分布
        penalties.extend(self._soft_balanced_distribution())

        # 总惩罚
        total_penalty = self.model.NewIntVar(-1000000, 1000000, 'total_penalty')
        if penalties:
            self.model.Add(total_penalty == sum(penalties))
        else:
            self.model.Add(total_penalty == 0)

        return total_penalty

    def _soft_minimize_cross_campus(self) -> List:
        """S1: 最小化教师跨校区（按天）"""
        x = self.variables
        penalties = []

        for teacher_id, teacher in self.problem.teachers.items():
            teacher_courses = [c for c in self.problem.courses
                             if c.teacher_id == teacher_id]

            if len(teacher_courses) <= 1:
                continue  # 单门课无跨校区问题

            days = set(s.day for s in self.problem.time_slots)
            for day in days:
                day_slots = [s for s in self.problem.time_slots if s.day == day]

                # 获取该教师该天可能涉及的校区
                campuses = set(c.campus for c in teacher_courses)
                if len(campuses) <= 1:
                    continue  # 所有课程都在同一校区

                # 为每个校区创建指示变量
                campus_used = {}
                for campus in campuses:
                    var_name = f'campus_used_{teacher_id}_{day}_{campus}'
                    campus_used[campus] = self.model.NewBoolVar(var_name)

                    # 如果该校区该天有课，则 campus_used = 1
                    campus_courses = [c for c in teacher_courses if c.campus == campus]
                    terms = []
                    for c in campus_courses:
                        for s in day_slots:
                            if s.id not in x[c.id]:
                                continue
                            for r in self.problem.rooms:
                                if r.campus == c.campus and r.id in x[c.id][s.id]:
                                    terms.append(x[c.id][s.id][r.id])

                    if terms:
                        # campus_used >= 1 当有任何课程在该校区
                        self.model.Add(sum(terms) >= 1).OnlyEnforceIf(campus_used[campus])
                        self.model.Add(sum(terms) == 0).OnlyEnforceIf(campus_used[campus].Not())

                # 计算该天使用的校区数
                campus_count = self.model.NewIntVar(0, len(campuses),
                                                   f'campus_count_{teacher_id}_{day}')
                self.model.Add(campus_count == sum(campus_used.values()))

                # 如果 > 1，则惩罚
                cross_campus = self.model.NewBoolVar(f'cross_{teacher_id}_{day}')
                self.model.Add(campus_count > 1).OnlyEnforceIf(cross_campus)
                self.model.Add(campus_count <= 1).OnlyEnforceIf(cross_campus.Not())

                penalties.append(cross_campus * 100)  # 权重100

        return penalties

    def _soft_preferred_slots(self) -> List:
        """S2: 偏好时段奖励"""
        x = self.variables
        penalties = []

        for c in self.problem.courses:
            if not c.preferred_slots:
                continue

            for pref_slot_id in c.preferred_slots:
                if pref_slot_id not in x[c.id]:
                    continue

                # 创建匹配指示变量
                match = self.model.NewBoolVar(f'pref_{c.id}_{pref_slot_id}')

                terms = []
                for r in self.problem.rooms:
                    if r.campus == c.campus and r.id in x[c.id][pref_slot_id]:
                        terms.append(x[c.id][pref_slot_id][r.id])

                if terms:
                    self.model.Add(sum(terms) >= 1).OnlyEnforceIf(match)
                    self.model.Add(sum(terms) == 0).OnlyEnforceIf(match.Not())

                    penalties.append(match * (-20))  # 负权重 = 奖励

        return penalties

    def _soft_balanced_distribution(self) -> List:
        """S3: 课程在各天的均衡分布"""
        x = self.variables
        penalties = []

        days = list(set(s.day for s in self.problem.time_slots))
        if len(days) <= 1:
            return penalties

        # 计算每天的课程数
        courses_per_day = {}
        for day in days:
            day_var = self.model.NewIntVar(0, len(self.problem.courses), f'courses_{day}')

            day_slots = [s for s in self.problem.time_slots if s.day == day]
            terms = []
            for c in self.problem.courses:
                for s in day_slots:
                    if s.id not in x[c.id]:
                        continue
                    for r in self.problem.rooms:
                        if r.campus == c.campus and r.id in x[c.id][s.id]:
                            terms.append(x[c.id][s.id][r.id])

            if terms:
                self.model.Add(day_var == sum(terms))
            else:
                self.model.Add(day_var == 0)

            courses_per_day[day] = day_var

        # 惩罚偏离平均值
        avg_courses = len(self.problem.courses) // len(days)
        for day, day_var in courses_per_day.items():
            deviation = self.model.NewIntVar(-len(self.problem.courses),
                                            len(self.problem.courses),
                                            f'deviation_{day}')
            self.model.Add(deviation == day_var - avg_courses)

            abs_deviation = self.model.NewIntVar(0, len(self.problem.courses),
                                                 f'abs_deviation_{day}')
            self.model.AddAbsEquality(abs_deviation, deviation)

            penalties.append(abs_deviation * 5)  # 权重5

        return penalties
