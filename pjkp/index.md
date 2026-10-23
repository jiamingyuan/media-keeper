# media-keeper 项目入口

核对日期：2026-10-23。当前迭代：V0.3。单仓库、NestJS 与 React Federation 前端已部署到本机独立容器；全局采集 Skill 已安装。用户验收结论尚未记录。

- 项目根目录：`/Users/jiamingyuan/Desktop/ai-infra/media-keeper`。
- Git：仓库 `https://github.com/jiamingyuan/media-keeper`，本版归档引用 main / V0.3；旧 main 基线 `690a715d3fbccd426f843ada80ad006660902719`，V0.2 未单独发布，随 V0.3 纳入。远端结果以引用核对为准。
- [规则](rules.md)、[项目简介](project-brief.md)、[README](../README.md)。

## 版本

| 迭代 | 内容与状态 | 记录 |
| --- | --- | --- |
| V0.1 | 采集 Skill；历史 Git 标签与兼容保留，原始用户验收结论未恢复 | [V0.1](V0.1/iteration.md) |
| V0.2 | npm workspaces、共享 core/db、NestJS 查询 API、独立 Skill、Media 前端与 podcast 修正；实现随 V0.3 归档，无独立标签 | [V0.2](V0.2/iteration.md) |
| V0.3 | 统一版本 0.3.0、Nginx + Node 容器部署、宿主代理切换、全局 Skill 安装与 GitHub 代码归档 | [V0.3](V0.3/iteration.md) |

## 当前环境

- 入口 `http://localhost:8080/tools/media-keeper`，总览不展示 Media。标题包含匹配、日期五档、六种类型与计数、完整摘要、飞书转存标签、分页和详情已实现；API 保留原五字段查询。podcast 指音频播客，网站文章归 article。
- 容器 `media-keeper`，应用镜像 `media-keeper:0.3.0`；基于指定 Nginx 镜像，内部 Node 24.20.0 / npm 11.19.0 / Nginx 1.31.8。`127.0.0.1:8081 → 80`，API 仅容器内部 3001。Compose 为 `deploy/compose.yaml`，复用 agent-services / mysql-base；宿主代理整个 /media-keeper/。旧本机 API 已停止。
- API 只读配置在被忽略的 `runtime/api.container.local.json`，只读挂载，不入镜像。MySQL 现有 2 条记录保持不变；容器退出联动重启、手动重启及真实宿主页面已验证。
- 全局 Skill：`~/.agents/skills/media-keeper`，0.3.0；默认配置 `~/.config/media-keeper/config.json`，与源码采集复用已有恢复状态。版本、doctor 与类型查询从临时目录验证通过。
- 最近验证：21 项后端/数据库测试、4 项 Federation 浏览器测试、TypeScript 检查通过；实际页面的 PingFang SC、筛选、详情刷新、缓存和播客导航通过。
- 既有限制：Figma 当前环境不能加载 PingFang SC，设计稿字体替换仍未完成；网站实际字体已验证。未开放公网或增加认证。

每个版本仅维护 iteration.md；历史状态见相应版本，运行参数以 README 与现有配置为准。
