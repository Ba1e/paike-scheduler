"""
智能排课系统
基于约束规划(CP)的自动排课
"""

from .models import (
    TimeSlot,
    Room,
    Teacher,
    Course,
    Assignment,
    SchedulingProblem
)

from .solver import (
    SchedulerDependencyError,
    SchedulingSolver,
    IncrementalScheduler,
    HeuristicScheduler,
    SolverConfig
)

__version__ = '1.0.0'
__all__ = [
    'TimeSlot',
    'Room',
    'Teacher',
    'Course',
    'Assignment',
    'SchedulingProblem',
    'SchedulerDependencyError',
    'SchedulingSolver',
    'IncrementalScheduler',
    'HeuristicScheduler',
    'SolverConfig',
]
