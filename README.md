# media-keeper

当前源码版本 **0.5.0**，Git 发布标签 **V0.5.0**。

资料收藏与查询单仓库。采集 Skill 负责取得全文、由 Agent 生成最多 400 个 Unicode 字符的中文摘要，并写入 MySQL；摘要面向未读原文的读者，先讲清对象和问题，再说明主要观点、做法或发现，必要术语随文解释。NestJS API 使用同一张表提供只读查询。采集流程独立于 API 运行。React 前端以 Module Federation 远程模块接入 my-dashboard，列表完整展示摘要，再进入详情阅读原文或飞书副本。

原名 docs-keeper；现有数据库表、旧配置路径、`DOCS_KEEPER_CONFIG` 和收藏内容继续兼容，历史 V0.1 标签保留。

## 目录

```text
apps/api/                 NestJS TypeScript 查询后端
apps/web/                 React + Vite 的 Media 远程前端
skills/media-keeper/      Skill 入口、采集/飞书/恢复流程及原有测试
packages/core/            通用字段、URL、时间与查询参数规则
packages/db/              MySQL 连接、参数化查询和持久化
database/                schema.sql 与 migrations
tests/                    API、数据库与真实 Federation 浏览器测试
tools/                    开发命令入口、独立 Skill 构建及容器部署打包工具
deploy/                   独立容器启动、Nginx、入口脚本和配置示例
```

使用 npm workspaces，根目录只维护一份 package-lock.json。开发环境使用 Node.js 24.9+；单独打包的 Skill 支持 Node.js 20+。

## 安装与配置

```sh
npm ci --ignore-scripts
npm run build
```

需要可访问的 MySQL。首次安装用管理员创建 UTF-8 的 `agent` 数据库，再导入 `database/schema.sql`。已有旧四类型表时，先核对结构，再执行 `database/migrations/001_source_types_tech_doc_project_repo.sql`；如果 source_type 仍含旧值 `blog`，继续执行 `database/migrations/002_replace_blog_with_podcast.sql`：原网站文章归入 `article`，音频播客使用 `podcast`。新库直接使用最新 schema，无需重复初始化；执行迁移前备份，MySQL DDL 不受事务回滚保护。

日常采集账号只授予 `agent.useful_docs` 的 `SELECT, INSERT, UPDATE`，API 使用另一个只有 `SELECT` 权限的账号。MySQL 口令不写入命令行、文档或 Git。

```sh
mkdir -p runtime
chmod 700 runtime
cp deploy/skill.config.example.json runtime/config.local.json
cp deploy/api.config.example.json runtime/api.local.json
chmod 600 runtime/*.local.json
```

分别填写账号与密码。宿主机连接 Docker 中的 MySQL 时使用发布到宿主的地址，例如 `127.0.0.1:3306`；示例中的 `mysql-base` 只适用于能够解析该容器名的网络。

Skill 的配置包括 MySQL、飞书 CLI 的 bin/profile/workspace，可设置 `stateDir`。飞书操作优先复用本机 `lark-cli` 和现有登录，使用用户身份；配置不保存飞书 token。API 的配置只有 MySQL 和 server，启动不需要飞书配置。两个配置必须为 0600。

本地开发的 `npm run keeper -- ...` 默认加载 `runtime/config.local.json`；可用 `MEDIA_KEEPER_CONFIG`、兼容的 `DOCS_KEEPER_CONFIG` 或 helper 的 `--config` 覆盖。直接运行 Skill helper 时仍保留 `~/.config/media-keeper/config.json` 以及旧配置路径的发现规则。API 默认加载 `runtime/api.local.json`，可由 `MEDIA_KEEPER_API_CONFIG` 指定其他文件。

`runtime/`、`node_modules/` 和 `dist/` 均被 Git 忽略。runtime 中的口令配置与副本恢复状态是本机运行数据，不要提交或随意删除；临时分析产物应放系统临时目录。

## 查询 API

```sh
npm run start:api
```

默认只监听 `127.0.0.1:3001`。接口为：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 数据库连通性检查 |
| `GET /api/media` | 组合筛选与分页列表 |
| `GET /api/media/types` | 六种支持的来源类型 |
| `GET /api/media/:id` | 单条详情，未找到返回 404 |

列表筛选字段全部可选，多项之间是 AND：

| 参数 | 规则 |
| --- | --- |
| `title` | 标题包含匹配，最长 512 字符 |
| `source` | 来源包含匹配，最长 255 字符 |
| `source_type` | article、paper、podcast、video、tech_doc、project_repo 之一，精确匹配 |
| `author` | 作者包含匹配，最长 512 字符 |
| `source_created_at` | 严格的 `YYYY-MM-DD`，按 Asia/Shanghai 自然日筛选原文创建时间 |
| `published` | today / week / month / year / all；与 source_created_at 互斥 |
| `page` / `page_size` | 默认 1 / 20；每页最多 100 条，页码最多 1000000 |
| `sort_by` / `sort_order` | 默认 created_at / desc；字段支持 created_at、source_created_at、title；方向 asc 或 desc |

`podcast` 专指小宇宙等音频播客，网站文章使用 `article`；提取器识别 PodcastEpisode / PodcastSeries 与小宇宙节目页，但不下载/转写音频，简介或 show notes 不能当完整内容。

包含匹配按数据库的排序规则执行（当前表为 utf8mb4_0900_ai_ci），`%`、`_` 按普通字符处理。日期在应用层转换为 UTC 的左闭右开区间，例如 `2026-10-23` 对应 `[2026-10-22 16:00:00, 2026-10-23 16:00:00)`；日期为空的记录不匹配日期条件。所有排序都以 id 稳定排序，按来源时间排序时空时间排最后。未知、重复、非法参数返回 400。

```sh
curl --get http://127.0.0.1:3001/api/media \
  --data-urlencode 'title=模型' \
  --data-urlencode 'source=示例站' \
  --data-urlencode 'source_type=tech_doc' \
  --data-urlencode 'author=作者' \
  --data-urlencode 'source_created_at=2026-10-23' \
  --data-urlencode 'page=1' \
  --data-urlencode 'page_size=20'
```

列表返回 `{data: [...], source_type_counts: {...}, pagination: {page, page_size, total, total_pages}}`，详情返回 `{data: {...}}`。数据字段为 id、title、abstract、link、copied_lark_link、source、source_type、author、source_created_at、created_at、updated_at。ID 始终是字符串，日期为 UTC ISO 字符串并保留微秒，未知来源时间为 null。

`published` 包含今日：today 为上海今日，week 为含今日的近 7 个自然日；month / year 从明日零点分别减去 1 个日历月 / 年到明日零点，左闭右开，月末与闰年按日历处理。all 不限制日期并包含未知日期。类型计数遵循标题、来源、作者与日期条件，但忽略当前 source_type 和分页，六种类型无结果时返回 0。

API 没有新增、更新或删除接口；只读账号与只读快照事务共同约束数据库访问。当前是本机查询服务，未配置公网身份认证。

## 前端与 my-dashboard 接入

正式入口：my-dashboard 的 `/tools/media-keeper`。侧栏、顶栏、页面标题、主题与路由由宿主提供；本模块默认导出 `./DashboardModule`，不创建 React 根或嵌套 Router。React / React DOM 19.3.1、Federation Vite 1.23.5 与宿主一致，以 singleton 共享。

界面支持标题包含匹配、五档发布日期、六种类型导航及真实计数、排序、20 条分页、详情和全文入口。筛选与页码保存在 URL，详情返回和浏览器后退保留条件；来源和作者仅展示。摘要 16px / 28px 完整展开；copied_lark_link 有值时显示飞书转存标签。使用已确认 Figma 导出的本地矢量图标，通过遮罩继承主题色；中文、英文、数字与控件统一继承 PingFang SC。不会向总览增加 Media 内容。

本机源码联调（先停止占用 8081 的部署容器），分别启动三个终端：

```sh
# media-keeper 根目录：只读 API
npm run build:api
npm run start:api

# media-keeper 根目录：构建并预览远程模块，127.0.0.1:8081
npm run build:web
npm run preview:web

# my-dashboard 根目录：宿主默认 5173，也可用 build + preview
npm run dev
```

宿主清单已登记 `media_keeper`、`./DashboardModule` 和 `/media-keeper/mf-manifest.json`。宿主开发与预览代理 `/media-keeper/` 到 8081，远程预览再将 `/media-keeper/api/` 转给 3001。前端变更后重新构建并刷新宿主；这里不承诺跨项目热更新。

默认构建 base 为 `/media-keeper/`，业务 API 为同一前缀下的 `api/`，因此宿主环境无需跨域。可用构建环境变量 `MODULE_PUBLIC_URL` 指定资源 base、`VITE_MEDIA_API_URL` 指定 API base；若改为跨域部署，相应服务器需单独配置 CORS。`MEDIA_KEEPER_API_ORIGIN` 仅配置 Vite 开发/预览代理的后端地址，不进入浏览器。

## 容器部署

部署直接使用本机已有的 `node-nginx:24.20.0-1.31-trixie` 镜像，包含 Node.js 24.20.0、npm 11.19.0 和 Nginx 1.31.8。容器名为 `media-keeper`，由 docker run 创建独立容器，在 Docker Desktop 中与 my-dashboard 并列，不嵌套于同名 Compose 分组。不构建 media-keeper 专用镜像；原自定义 Dockerfile 已由本地打包流程替代。正式入口为 [my-dashboard / Media](http://localhost:8080/tools/media-keeper)。

本机需要 Docker、Node/npm 和该已有镜像。首次获取源码先 `npm ci --ignore-scripts`。打包命令在宿主构建 API/Web，并用 node-nginx 临时容器按锁文件安装 Linux 生产依赖；只包含运行所需的 API、前端静态资源、core/db、依赖和启动配置，不复制本机 node_modules、源码测试、数据库口令或采集 Skill 的 Python 模型。

```sh
npm run package:deploy
npm run deploy
docker ps --filter name=^/media-keeper$
curl --noproxy '*' http://127.0.0.1:8081/healthz
```

打包产物在 Git 忽略的 `runtime/deploy/releases/`，`runtime/deploy/current` 指向最近一次完整产物。它们是运行容器必需的部署文件，不是临时报告；容器以只读挂载使用，不能在运行时删除当前产物。安装中间文件位于系统临时目录并在打包结束后清理，临时安装容器自动删除。发布新产物后重新创建容器才切换运行版本，旧产物可在确认未被容器使用后清理。

MySQL 继续使用现有 `mysql-base`，复用 `agent-services` 网络。首次在其他机器准备网络、数据库和只读账号后配置：

```sh
mkdir -p runtime
chmod 700 runtime
cp deploy/api.config.example.json runtime/api.container.local.json
chmod 600 runtime/api.container.local.json
```

填写只读账号，将 mysql.host 设为 mysql-base，server 为 127.0.0.1:3001；现有配置无需重复复制。配置只读挂载，启动时复制为 nginx 用户持有的 0600 文件，不进入镜像或打包产物。Nginx 对外为 `127.0.0.1:8081 → 80`，NestJS 仅容器内 3001。健康检查覆盖 Nginx、API 与数据库；任一服务进程退出时联动停止，由 Docker 的 unless-stopped 策略重启整个容器。

my-dashboard 通过 Docker DNS 将 `/media-keeper/` 代理到 `media-keeper:80`，同域提供 Federation 清单、静态资源和 API；宿主配置无需随本次容器替换修改。未配置公网入口或新增认证。采集 Skill 继续在宿主机运行，不进入网站容器。

## 采集 Skill

```sh
npm run keeper -- --version
npm run keeper -- doctor
npm run keeper -- types
npm run keeper -- search 关键词
npm run keeper -- get 1
npm run keeper -- check ./record.json
npm run keeper -- fetch https://example.org/article /tmp/media-keeper-article
```

模型实际阅读完整内容、整理元数据后，才可调用 `save ./record.json`；只有用户明确要求更新时才用 `update ID --confirmed ./patch.json`。重复收藏不会覆盖，来源与标题相同仅表示候选。完整字段契约见 [工具契约](skills/media-keeper/references/workflow.md)，摘要取舍见 [摘要指导](skills/media-keeper/references/abstract.md)。

普通来源的原链接可访问时保存原链接；没有可用原链接但已取得全文时，通过飞书 CLI 创建全文副本并回读。Loot Drop 报告按下述专用规则保留双链接。恢复记录由 `stateDir/jobs/` 保存，数据库失败后重试复用已有副本；CLI 结果不确定时必须先核对，不盲目重复创建。`doctor` 仅验证数据库，不代表飞书写入已经验收。

Bilibili 投稿视频使用独立的 Python 音频脚本：免登录通过播放接口获取完整音轨，本机转写后由 Agent 生成 abstract；音频转写后立即删除，总结/保存结束再清理临时转写和元数据。支持分 P、主备音轨与时长完整性检查，访问失败时不使用简介代替。首次需独立 Python 3.9+ 音频环境与本地模型，操作及清理契约见 [Bilibili 音频流程](skills/media-keeper/references/bilibili.md)。模型/运行依赖可复用，不在每次任务后删除。

Loot Drop 的 `/startup/` 报告会提取分析卡片的完整展开正文；Agent 阅读原报告后写摘要，按 [Loot Drop 分析规范](skills/media-keeper/references/loot-drop.md) 核实中文名、统一标题为“{公司名称} Loot Drop 分析”，并制作有实质内容的中文飞书分析文档；完整转载或改写须满足相应内容/授权条件，并同时保存 `link` 与 `copied_lark_link`。来源为 `Loot Drop`，默认类型仍是 `article`。译稿和提取材料使用系统临时目录，沿用副本回读与失败恢复。

HTML 提取不执行网页 JavaScript，不处理 PDF、登录页面或音视频转写。提取结果始终需要模型阅读全文并核对，不自动认定 `full_text_confirmed:true`。来源时间统一存 UTC；未标时区按 Asia/Shanghai，来源创建时间未知时留空。

## 构建可独立安装的 Skill

```sh
npm run build:skill
cd dist/media-keeper
npm install --ignore-scripts
node scripts/keeper.mjs --version
```

产物含 Skill、references、配置示例、Bilibili 音频脚本/依赖清单及已打包的 core/db 代码；运行依赖由产物的 package.json 声明。安装依赖后，整个 `dist/media-keeper` 可复制到 Agent 的 skills 目录，脱离本仓库运行；不要只复制源码中的 `skills/media-keeper` 文件夹。构建工具也支持输出到尚不存在的指定目录：`node tools/build-skill.mjs /tmp/media-keeper-skill`。

全局安装应复制完整构建产物到 `~/.agents/skills/media-keeper` 并安装其中运行依赖，默认配置为 `~/.config/media-keeper/config.json`（0600）。本机已同步安装 0.5.0，沿用原有数据库账号、飞书 profile 和恢复状态目录；采集 Skill 在宿主机运行，不依赖查询容器。

## 测试

```sh
npm test
npm run test:audio
MEDIA_KEEPER_CONFIG=runtime/config.local.json MEDIA_KEEPER_INTEGRATION=1 npm test
```

默认测试不连接数据库，真实数据库测试需要显式启用；API 权限测试还需要配置好只读的 API 配置。数据库样本在事务中回滚。测试覆盖原采集规则、HTTP 参数、五字段组合筛选、日期预设与微秒边界、类型计数、分页、排序、详情与只读权限。

浏览器联调：`npm run test:web`。测试预览会占用 8081；已有部署时先运行 `docker stop media-keeper`，测试后用 `docker start media-keeper` 恢复。需要同级的 my-dashboard 仓库已安装依赖；其他位置可设置 `MY_DASHBOARD_ROOT`。用例自动构建并启动真实宿主和远程模块，以测试 HTTP 响应隔离业务数据库，覆盖筛选参数、分页/详情/刷新、主题字体、六类图标、小屏、重试、迟到响应取消与危险链接；真实 API 另由上面的集成测试验证。默认 Chromium，截图和失败轨迹在系统临时目录，未声称验证 Safari / Firefox。

`skills/media-keeper/test/live-copy.mjs --live` 会创建并保留飞书验收文档和收藏，只有明确需要该写入验收时才运行。首次建表、迁移、账号授权和飞书认证均不在 npm 测试中自动执行。
