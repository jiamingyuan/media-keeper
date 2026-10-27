# media-keeper V0.3 迭代记录

> 本页保留 V0.3 当时的实现与验证。专用业务镜像和 Compose 部署已被后续方案替代；当前运行方式见 [架构](../architecture.md) 与 [V0.4](../V0.4/iteration.md)。

## 目标与来源

2026-10-23 用户要求：“将media-keeper push到github，作为V0.3；通过这个镜像创建一个容器，就叫做media-keeper，下载后端所需工具……然后把media-keeper部署进去”。附图指定本机 `nginx:1.31-trixie`；版本依据为飞书[工具版本](https://lcn6mqfic6vj.feishu.cn/wiki/SWDTwS9jVinKOTkr3PNclroCnMe)。

## 当前状态

V0.3 已完成本机部署与全局 Skill 安装，代码归档目标为 Git main 和同名 V0.3 标签。此前 V0.2 的单仓库、NestJS、采集 Skill、Media 远程前端与 podcast 纠正纳入本次发布，保留 V0.1/V0.2 历史记录。源码中的 workspace 版本已统一为 0.3.0；Git 提交与标签需核对远端引用，本记录不代替远端状态。

## 实现决定

- 基于用户选定的 Nginx 镜像固定摘要构建 `media-keeper:0.3.0`，容器名 `media-keeper`。版本表中 Node.js 24.20.0、npm / npx 11.19.0 已通过本机飞书 CLI 读取；应用库按 package-lock.json 安装。
- 同一容器内由 Nginx 提供远程静态资源与 API 代理，NestJS 仅监听容器内 127.0.0.1:3001；进程退出联动停止并交由 Docker 重启。Compose 保存重建方式。
- 复用 `agent-services` 网络及 `mysql-base`，继续使用已有只读 API 账号；凭据放 Git 忽略的 runtime 配置，只读挂载后复制为 nginx 用户可读的 0600 文件，不写入镜像。
- 宿主通过同域 `/media-keeper/` 代理到独立容器，Federation 清单和路由契约保持一致；宿主不再依赖本机 API 进程或 Media 静态副本。

## 实际变化与验证

- 相对旧 main 基线 `690a715d3fbccd426f843ada80ad006660902719`，本次提交包含 V0.2 的单仓库拆分、NestJS API、只读 core/db、独立 Skill 构建、React Federation 前端、podcast 修正与迁移，以及本版新增 Dockerfile / Compose / Nginx / 进程入口脚本。旧 V0.1 标签保留，没有补造 V0.2 标签。
- Linux arm64 镜像构建成功，运行镜像为 `media-keeper:0.3.0`；容器 `media-keeper` 健康，复用 agent-services 与 mysql-base。容器内实测 Nginx 1.31.8、Node.js 24.20.0、npm / npx 11.19.0、NestJS 12.2.0；API 运行 uid 101，配置 0600，数据库账号仅有 SELECT。
- 21 项后端/真实 MySQL 测试通过、无跳过；TypeScript 检查与 4 项真实 Federation 浏览器用例通过。测试样本回滚，原有 2 条记录完整保持。
- 已切换 my-dashboard 本机 Nginx：通过 agent-services 网络代理 `/media-keeper/` 到新容器，并动态解析 Docker DNS；宿主源码配置同步更新，但本轮未替用户提交或推送 my-dashboard。
- 停止旧的本机 Node API 后，真实网站仍通过筛选、日期五档、列表/摘要、详情直达刷新、返回条件、播客导航、主题字体及缓存/缺失资源检查；无浏览器错误。故障注入验证 API 退出触发容器自动重启，手动重启后健康检查与原有数据均正常。
- 用户补充要求“把更新之后的media-keeper skill在本地全局.agents里装一下，有的话就覆盖”。已将完整独立安装产物与运行依赖安装至 `~/.agents/skills/media-keeper`，版本 0.3.0；原位置不存在旧安装。默认配置 `~/.config/media-keeper/config.json` 复用已有采集账号、飞书 profile 与恢复状态，口令未放进 Skill。已从系统临时目录运行 --version、doctor、types，均通过；未创建飞书文档或新增收藏。
- 临时备份、构建/浏览器检查结果在系统临时目录；只更新现有正式文档与本版本记录。

## 交付边界

本版是本机容器部署和 GitHub 代码归档；Git 发布引用为 main / V0.3，实际结果以远端引用核对为准。用户尚未给出产品验收结论。查询服务未开放公网，未增加认证；Figma 字体加载限制属于 V0.2 既有未完成项，本版未处理。
