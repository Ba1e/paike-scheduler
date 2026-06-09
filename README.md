# Paike Scheduler

一个面向教培/校区场景的排课系统，包含课程维护、冲突检查、Excel 导入导出、账号与邀请码管理、SQLite 持久化，以及一个可选的自动排课求解器原型。

## 功能

- Flask 单体后端，原生 HTML/CSS/JavaScript 前端。
- SQLite 持久化，支持 Docker Compose 挂载运行数据目录。
- 多部门/多校区课程数据维护、班级编码生成、变更记录和导出。
- 邀请码注册、角色权限、CSRF 防护、登录限流和 session 管理。
- 启发式自动排课预览；安装 `ortools` 后可启用 CP-SAT 精确求解器。

## 快速开始

本仓库不包含业务数据库、用户、邀请码、session、历史排课文件或 Excel 导入文件。首次启动时系统会自动生成一个一次性管理员邀请码，并打印在控制台，同时写入运行数据目录下的 `BOOTSTRAP_CODE.txt`。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

mkdir -p runtime-data
export SCHED_DATA_DIR="$(pwd)/runtime-data"
export SCHED_DB_PATH="$(pwd)/runtime-data/schedule.db"

python app.py
```

打开 `http://127.0.0.1:5100`，进入 `/auth` 使用管理员邀请码注册首个管理员账号。

## Docker

```bash
docker compose up --build
```

默认服务端口为 `5100`，运行数据保存在 `./runtime-data`。生产环境建议设置：

- `SCHED_COOKIE_SECURE=1`
- `SCHED_ALLOWED_ORIGINS=https://your-domain.example`
- `SCHED_TRUST_PROXY_HEADERS=1`，并正确配置 `SCHED_TRUSTED_PROXY_IPS`

## 自动排课模块

启发式求解器无需额外依赖：

```bash
python scheduler_demo.py
python -m unittest test_scheduler.py
```

如果需要使用精确 CP-SAT 求解器，额外安装：

```bash
pip install ortools
```

`scheduler_api.py` 提供 `/api/scheduler/*` 蓝图，可按需在 Flask 应用中注册：

```python
from scheduler_api import register_scheduler_routes
register_scheduler_routes(app)
```

## 发布代码包

仓库提供一个只打包代码的发布脚本，会拒绝数据库、账号、session、邀请码、Excel 和运行时目录：

```bash
python scripts/build_release.py --check
python scripts/build_release.py
```

生成文件位于 `release-artifacts/`，该目录默认不会提交。

## 数据安全

不要提交以下运行时文件：

- `runtime-data/`
- `schedule.db*`
- `users.json`
- `invite_codes.json`
- `sessions.json`
- `BOOTSTRAP_CODE.txt`
- `departments/`
- `history/`
- `*.xlsx`

## License

MIT
