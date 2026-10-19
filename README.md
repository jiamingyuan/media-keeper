# media-keeper

原 `docs-keeper`，本次仅重命名，版本沿用 0.1.0；历史 V0.1 标签保留。面向 Claude Code 的资料收藏 skill。阅读全文后生成**不超过 400 字**的中文摘要，将元数据和全文入口保存到 MySQL，帮助用户先读摘要，再决定是否阅读全文。

## 功能

- 收藏、查询和按用户明确要求更新文档；重复收藏默认返回已有记录。
- 摘要长度按信息量决定，不设最低字数；覆盖全文结论、必要依据及限制。
- 支持 `article`、`paper`、`blog`、`video`、`tech_doc`、`project_repo` 六种来源类型。
- 原文链接可访问时保存原链接；没有可用链接但已取得全文时，使用本机飞书 CLI 创建全文副本并回读核对。
- 记录来源、作者、原文创建时间及收藏时间；入库失败后可复用已生成的飞书副本。

## 安装

需要 Node.js 20+、可访问的 MySQL，以及已配置并登录的 [飞书 CLI](https://github.com/larksuite/cli)。当前数据库流程已在 MySQL 9.7.2 上实测。

```sh
git clone https://github.com/jiamingyuan/media-keeper.git "$HOME/.claude/skills/media-keeper"
cd "$HOME/.claude/skills/media-keeper"
npm ci --ignore-scripts
```

该位置属于 Claude Code 的个人 skills 目录。也可将整个仓库放入项目的 `.claude/skills/media-keeper`。本 skill 依赖辅助程序，安装后需要执行 `npm ci`。

### 数据库

使用管理员创建 `agent` 数据库（UTF-8），再导入本仓库的 `schema.sql`。为日常运行创建独立账号，并仅授予 `agent.useful_docs` 表的 `SELECT, INSERT, UPDATE` 权限。

```sql
CREATE DATABASE IF NOT EXISTS agent
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

```sh
mysql --user=root --password < schema.sql
```

`schema.sql` 用于首次建表；已有早期四类型表时，使用 `migrations/001_source_types_tech_doc_project_repo.sql` 追加类型。管理员按当前 MySQL 版本支持的 DDL 方式执行迁移。

### 配置

```sh
mkdir -p "$HOME/.config/media-keeper"
chmod 700 "$HOME/.config/media-keeper"
cp config.example.json "$HOME/.config/media-keeper/config.json"
chmod 600 "$HOME/.config/media-keeper/config.json"
```

在配置文件中填写数据库专用账号、密码、飞书 CLI 的可执行文件位置、现有 profile，以及允许保存正文和图片的工作区绝对路径。

使用 `lark-cli profile list` 确认 profile。文档操作显式采用用户身份；复用现有登录态，需要用户拥有创建和读取飞书文档的权限。配置中不保存飞书 token，由 CLI 管理认证。

配置文件须为 `0600`。也可通过 `MEDIA_KEEPER_CONFIG` 环境变量或 helper 的 `--config` 参数指定其他配置文件。恢复记录默认放在 `~/.local/share/media-keeper/jobs/`，可用 `stateDir` 配置覆盖。升级旧部署时兼容读取 `~/.config/docs-keeper/config.json` 和 `~/.config/docs_keeper/config.json`，也兼容旧环境变量 `DOCS_KEEPER_CONFIG`。配置优先级为显式 `--config`、`MEDIA_KEEPER_CONFIG`、`DOCS_KEEPER_CONFIG`、默认配置目录（新名优先）。SQL 账号名、`agent.useful_docs` 表名及数据库串行锁沿用原值，现有收藏无需迁移。旧配置未指定 `stateDir` 时沿用其原名恢复目录，避免重复创建飞书副本。

```sh
node scripts/keeper.mjs --version
node scripts/keeper.mjs doctor
node scripts/keeper.mjs types
```

## 使用

在 Claude Code 中直接说：

> 用 media-keeper 收藏这个网页：https://example.org/article

也可显式调用 `/media-keeper`。查询和更新示例：

> 找一下之前收藏的某篇文档，先给我摘要。
>
> 请重读编号 12 的全文并更新摘要，其他信息保留。

常规收藏不会覆盖已有记录。无原链接的同来源、同标题记录仅作为候选，无法确认是否同篇时会询问用户。具体 JSON 接口见 [工具契约](references/workflow.md)，摘要取舍见 [摘要指导](references/abstract.md)。

## 表结构

表名为 `agent.useful_docs`：

| 字段 | 含义 |
| --- | --- |
| `id` | 自增编号 |
| `title` | 原文标题或拟定标题 |
| `abstract` | 全文摘要，最多 400 个 Unicode 字符，含标点和空白 |
| `link` | 可直接访问的原链接，可空 |
| `copied_lark_link` | 飞书全文副本链接，可空 |
| `source` | 来源名称 |
| `source_type` | 六种英文枚举类型 |
| `author` | 明确署名的作者，可空 |
| `source_created_at` | 原文创建/首次发布时间，`DATETIME(6)`，可空 |
| `created_at` | 收藏记录入库时间 |
| `updated_at` | 收藏记录更新时间 |

时间入库统一采用 UTC。原文未标注时区时按 Asia/Shanghai 解释，只有完整日期时按当地零点处理；无法可靠解析则留空。没有来源时间时不以抓取时间、修改时间或副本时间代替。

## 验证

```sh
npm test
```

单元测试不连接数据库。配置好专用数据库后，可运行真实读写验收；测试记录放在事务中并回滚：

```sh
MEDIA_KEEPER_INTEGRATION=1 node --test test/database.test.mjs
```

`test/live-copy.mjs --live` 是显式飞书写入验收，会保留一份标记为验收样本的文档和收藏。仅在需要该测试时运行：先把 `test/fixtures/fulltext.md` 放到配置工作区的 `media-keeper-validation/fulltext.md`，把 `test/fixtures/check.png` 放到 `media-keeper-validation/assets/check.png`，再从工作区运行该脚本。日常测试不会调用它。

## 能力边界

HTML 提取器不执行网页 JavaScript，也不直接解析 PDF、登录页面或转写视频。这些内容需要其他已授权工具取得完整正文，或由用户提供全文/完整字幕。仅有标题、摘要页、简介或片段时不会假装已读全文。

副本尽可能保原标题、表格、代码和图片，但受网页资源权限与飞书导入能力影响；创建后会回读检查，无法还原的部分需说明。摘要由调用 skill 的模型生成，脚本负责校验、保存及恢复，不单独调用模型服务。
