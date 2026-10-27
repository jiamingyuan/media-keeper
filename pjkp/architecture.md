# media-keeper 当前架构与部署

实现信息更新：2026-10-27；下述网站运行检查日期为 2026-10-26。源码按 V0.5.0（0.5.0）发布；网站运行事实沿用已注明日期的检查，本轮不重新部署容器。以下记录当前方案与运行事实；方案演进经过见各版本 iteration，持续交付要求见 [rules.md](rules.md)。

## 模块与数据流

采用 npm workspaces 单仓库，共用根目录 package-lock.json：

- `skills/media-keeper` 负责采集、元数据、摘要保存、飞书副本与失败恢复；`tools/build-skill.mjs` 构建含共享代码的独立安装产物，不能只复制源码子目录作为全局安装包。
- `apps/api` 使用 NestJS 提供只读 HTTP 查询；`apps/web` 使用 React / Vite，通过 Module Federation 导出 `./DashboardModule` 接入 my-dashboard。
- `packages/core` 提供字段、URL、时间与查询规则；`packages/db` 封装 MySQL 连接、查询和持久化；`database` 保存 schema 与迁移。

采集 Skill 与查询 API 访问同一个 MySQL `agent.useful_docs`；采集独立于查询服务运行，API 启动不需要飞书配置。摘要由 Agent 生成，再经 helper 校验与写入。Skill 使用读写账号，API 使用独立只读账号，配置分别加载。当前实现与契约见 [README](../README.md)、[API 数据库服务](../apps/api/src/database.service.ts)、[数据库包](../packages/db/index.mjs)；本次未重新审计数据库授权。

结构与 NestJS 的选型来自 2026-10-23 用户的结构调整要求及采纳的附图；当时的匹配算法、上海自然日与部分接口扩展是实现取舍，来源及边界见 [V0.2](V0.2/iteration.md)。技术选型记录不推导为禁止后续调整的永久规则。

## 查询与前端接入

API 支持标题、来源、作者包含匹配，类型精确匹配，原文创建时间按 Asia/Shanghai 自然日筛选；多条件为 AND，提供分页、稳定排序和类型计数。`published` 提供今日、近一周、近一个月、近一年和全部五档。当前关键词是标题包含匹配，没有新增语义检索或摘要全文检索。

前端当前只在 my-dashboard 工具页 `/tools/media-keeper` 展示 Media，总览暂不接入；来源和作者暂时只展示，API 仍保留其筛选能力。标题前显示类型图标，有 copied_lark_link 时显示飞书转存标签；摘要完整展开，列表与详情保留自然段。查询条件和分页保存在 URL。

宿主提供路由、主题、页面框架和字体；远程模块共享 React / React DOM，不另建 React 根或 Router。当前 React 为 19.3.1，NestJS 为 12.2.0，各 workspace 版本为 0.5.0；具体依赖和契约以 package-lock.json、[Web 入口](../apps/web/src/DashboardModule.tsx) 与 README 为准。

## 本机网站部署

当前实例使用已有 `node-nginx:24.20.0-1.31-trixie` 镜像，以独立 `media-keeper` 容器运行；这记录本次实例的选型，镜像和容器分组的 Agent 操作约定仅在 [AGENTS.md](../AGENTS.md) 维护。

- 本机 `npm run package:deploy` 构建 API/Web，并利用已有镜像安装 Linux 生产依赖；`npm run deploy` 当前调用 `deploy/start.sh`，通过 docker run 启动独立容器。
- 生产产物保存在被 Git 忽略的 `runtime/deploy/releases/`，`runtime/deploy/current` 指向完整产物。产物、Nginx 配置和 API 配置以只读挂载使用；正在挂载的产物属于运行依赖。
- my-dashboard 位于 `127.0.0.1:8080`，经 `agent-services` 网络和 Docker DNS，将同域 `/media-keeper/` 代理到 `media-keeper:80`。Media 容器对宿主开放 `127.0.0.1:8081 → 80`，NestJS 仅容器内 3001；MySQL 复用 `mysql-base`。
- API 配置为 `runtime/api.container.local.json`，只包含数据库与服务配置；凭据不进入镜像或生产打包产物。当前服务为本机访问，未增加公网入口或认证。
- 2026-10-26 本次只读核对：容器 running / healthy，无 Compose 项目标签；`/healthz`、资料列表和宿主转发的 Federation 清单均返回 200。资料总数 19。此前完整浏览器验证见 V0.4，本次未重新运行浏览器用例或应用回归。

启动、打包、重启及配置细节以 [README 容器部署](../README.md#容器部署)、[打包工具](../tools/package-deploy.mjs)、[启动脚本](../deploy/start.sh) 和 [Nginx 配置](../deploy/nginx.conf) 为准。V0.3 的专用业务镜像与 Compose 方案属于历史实现，已由 V0.4 发布后的当前部署替代。

## 本机采集 Skill

全局目录 `~/.agents/skills/media-keeper`，版本 0.5.0；默认配置 `~/.config/media-keeper/config.json`，复用已有数据库、飞书身份和恢复状态。本次核对项目与全局的 SKILL.md、references/abstract.md 完全一致。

Bilibili 流程使用独立 Python 环境与本机语音模型；音频转写后删除，任务结束清理临时转写等材料，保留可复用的运行环境、模型及恢复状态。现有实现见 [音频流程](../skills/media-keeper/references/bilibili.md)，真实实测与失败边界见 V0.4。YouTube 的直接下载及 RSS 自动回退尚未实现。

Loot Drop 采集新增专用 HTML 展开：读取六个分析模块的 data-full-text，保留重建方案、概况表格和相关案例链接。Agent 基于原报告写摘要并生成中文分析文档，统一报告标题并核实中国公司的中文名；完整处理的内容/授权条件及独立分析范围见专用参考；helper 为此来源允许保留原文的同时创建飞书副本，回读后向原表同一记录写入两个链接，无 schema 或前后端改动。译稿可直接位于系统临时目录，CLI 在稿件目录读取相对文件；保留原有 jobs 副本恢复。实现与边界见 [转载规范](../skills/media-keeper/references/loot-drop.md) 和 V0.4 的 2026-10-27 记录。
