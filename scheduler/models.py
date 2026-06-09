"""
数据模型定义
"""

from dataclasses import dataclass, field
from typing import List, Set, Optional, Dict
from datetime import time

@dataclass
class TimeSlot:
    """时间段"""
    id: str
    day: str  # 周一~周日
    period: str  # 早一、早二、下一、下二、晚
    start_time: time
    end_time: time

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return isinstance(other, TimeSlot) and self.id == other.id

    def __repr__(self):
        return f"TimeSlot({self.day} {self.period})"


@dataclass
class Room:
    """教室"""
    id: str
    name: str
    campus: str
    capacity: int
    type: str = "普通教室"  # 普通教室/实验室/多媒体
    facilities: List[str] = field(default_factory=list)

    def __hash__(self):
        return hash(self.id)

    def __repr__(self):
        return f"Room({self.campus}-{self.name})"


@dataclass
class Teacher:
    """教师"""
    id: str
    name: str
    subjects: List[str] = field(default_factory=list)
    max_hours_per_day: int = 8
    max_hours_per_week: int = 40
    unavailable_slots: Set[str] = field(default_factory=set)  # 不可用时段ID
    home_campus: str = ""

    def is_available(self, slot: TimeSlot) -> bool:
        return slot.id not in self.unavailable_slots

    def __hash__(self):
        return hash(self.id)

    def __repr__(self):
        return f"Teacher({self.name})"


@dataclass
class Course:
    """课程"""
    id: str
    teacher_id: str
    teacher_name: str
    subject: str
    grade: str
    class_name: str
    campus: str
    duration: float  # 课时数（小时）
    room_type: str = "普通教室"
    preferred_slots: List[str] = field(default_factory=list)  # 偏好时段ID列表
    constraints: Dict = field(default_factory=dict)  # 额外约束

    def __hash__(self):
        return hash(self.id)

    def __repr__(self):
        return f"Course({self.subject}-{self.grade}{self.class_name})"


@dataclass
class Assignment:
    """排课结果"""
    course_id: str
    slot_id: str
    room_id: str
    confidence: float = 1.0  # 0-1，方案质量评分

    def __repr__(self):
        return f"Assignment({self.course_id} -> {self.slot_id} @ {self.room_id})"


@dataclass
class SchedulingProblem:
    """排课问题完整定义"""
    courses: List[Course]
    teachers: Dict[str, Teacher]
    rooms: List[Room]
    time_slots: List[TimeSlot]
    existing_assignments: List[Assignment] = field(default_factory=list)  # 已有排课（不可改动）

    def validate(self) -> List[str]:
        """验证问题定义的完整性

        Returns:
            错误列表，空列表表示验证通过
        """
        errors = []

        # 检查教师是否都存在
        for course in self.courses:
            if course.teacher_id not in self.teachers:
                errors.append(f"课程 {course.id} 的教师 {course.teacher_id} 不存在")

        # 检查校区是否匹配
        campus_set = set(r.campus for r in self.rooms)
        for course in self.courses:
            if course.campus not in campus_set:
                errors.append(f"课程 {course.id} 的校区 {course.campus} 没有可用教室")

        # 检查时段ID是否有效
        slot_ids = set(s.id for s in self.time_slots)
        for course in self.courses:
            for pref_slot in course.preferred_slots:
                if pref_slot not in slot_ids:
                    errors.append(f"课程 {course.id} 的偏好时段 {pref_slot} 不存在")

        # 检查教师不可用时段
        for teacher in self.teachers.values():
            for unavail_slot in teacher.unavailable_slots:
                if unavail_slot not in slot_ids:
                    errors.append(f"教师 {teacher.name} 的不可用时段 {unavail_slot} 不存在")

        return errors

    def summary(self) -> str:
        """问题摘要"""
        return (
            f"排课问题:\n"
            f"  课程: {len(self.courses)}\n"
            f"  教师: {len(self.teachers)}\n"
            f"  教室: {len(self.rooms)}\n"
            f"  时段: {len(self.time_slots)}\n"
            f"  已有排课: {len(self.existing_assignments)}"
        )
