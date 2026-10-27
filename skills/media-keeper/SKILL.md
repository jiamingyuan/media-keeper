---
name: media-keeper
description: "收藏用户指定的网页、文章、论文、播客或视频：阅读全文并生成不超过400字的中文摘要，保存来源、作者、原文时间及全文入口至 MySQL agent.useful_docs；原链接不可用时通过飞书 CLI 转存全文；Loot Drop 报告生成中文分析文档并保存原文与飞书双链接。用户说收藏、收录、保存到资料库、使用 media-keeper，或查询/明确更新已有收藏时使用；普通网页问答和仅要求总结不自动入库。"
metadata:
  version: "0.5.0"
---

# media-keeper

面向没有读过原文的读者，用清楚、连贯的中文讲明内容，再帮助其判断是否继续阅读。只有用户提出收藏/保存请求才执行写入；用户要求收藏本身已授权保存及必要的飞书全文副本，不重复索要例行确认。

## 工具与入口

辅助程序位于 `${CLAUDE_SKILL_DIR}/scripts/keeper.mjs`、`${CLAUDE_SKILL_DIR}/scripts/fetch.mjs`。使用环境中可用的 `node`。先读 [references/workflow.md](references/workflow.md)，其中有完整 JSON 输入及时间、查重、重试规则。摘要前读 [references/abstract.md](references/abstract.md)。Bilibili 视频先读 [references/bilibili.md](references/bilibili.md)，通过 `scripts/bilibili.py` 免登录获取完整音轨并本机转写，再由 Agent 生成摘要；总结/保存收尾清理音频与临时转写。Loot Drop（loot-drop.io/startup/）报告先读 [references/loot-drop.md](references/loot-drop.md)，展开完整报告后写摘要，核实中国公司的中文名，统一命名为“{公司名称} Loot Drop 分析”，撰写有实质内容的飞书分析并保存双链接；完整转载或改写须满足相应内容/授权条件，正文质量与覆盖核对见该参考。首次安装按仓库 README 配置数据库和飞书 CLI。单仓库开发时使用根目录 npm 命令；独立安装必须使用 build:skill 的完整产物，不能只复制源码中的 Skill 子目录。

配置从 `~/.config/media-keeper/config.json` 读取（兼容旧的 `docs-keeper`、`docs_keeper` 配置目录，也可通过 `MEDIA_KEEPER_CONFIG` 或 `--config` 指定；旧环境变量 `DOCS_KEEPER_CONFIG` 仍可用）。不要把数据库口令写进提示、命令行、日志或 SKILL.md。所有飞书操作优先复用本机 `lark-cli` 现有 profile 和登录态；仅使用配置中指定的身份和工作区。

## 执行流程

1. **先查重复**：用 `check` 查询已知原链接；取得来源和标题后再查一次。`existing` 直接回复已有编号、摘要和全文入口，不覆盖。`candidates` 先核对是否同篇，无法确定就询问；不得仅因来源/标题相同就断言同篇。只有用户确认另一篇时才传 `confirm_distinct:true`。
2. **取得全文**：公开 HTML 可用 `fetch.mjs URL 输出目录` 提取正文和元数据，然后实际阅读全文。Loot Drop 报告由提取器专门展开分析正文，不用卡片短预览代替全文。脚本只提取，不保证完整，须检查其 `review_flags`、原文末尾、分页、折叠及关键图表。需要登录的页面使用已有授权工具或请用户提供完整正文/导出文件；不获取或迁移本机浏览器 cookie。飞书文档用现有 `lark-doc` skill 及 CLI 获取全文。论文确认读到完整论文而非摘要页；Bilibili 视频一律走完整音轨→本机转写→摘要流程，不依赖网页或 CC 字幕接口；其他视频必须取得完整字幕/转写。音频播客必须取得完整音频内容或完整逐字稿，不用简介或 show notes 冒充全文。截图或片段不足以认定全文。
3. **整理元数据并总结**：普通来源优先原题，无题再拟定；Loot Drop 按专用参考核实公司名并采用统一分析标题。`source` 仅写网站/公众号/机构名称，不写 URL，无法辨认填“来源未注明”。`author` 仅采用原文明确署名，可为空，多作者按原顺序用“、”分隔。来源创建/首次发布时间缺失则为空，不拿修改、抓取、版权年份或飞书副本时间替代。
4. **决定全文入口**：稳定且可直接访问的原文 URL 写入 `link`，通常不建副本；Loot Drop 报告例外：保留 `link`，并用按专用参考撰写的分析稿 `copy_markdown_path` 创建飞书文档，或传已核对的 `copied_lark_link`，两个入口都入库。其他来源只有需要登录、失效、临时签名或没有原链接，但已有完整内容时，才将全文整理为 Markdown 并提供 `copy_markdown_path`。不要以摘要替代副本正文。复制时保留顺序、标题、表格、代码、引用、链接和必要图片，标明缺失内容。飞书原生文档需复制时按 `lark-drive` 的 `files copy` 能力保留资源，再把已核对的副本 URL 交给 helper，不用重新拼正文造成损失。
5. **保存并核验**：`save` 仅在全文已实际获取和阅读后设置 `full_text_confirmed:true`。helper 会限长、校验类型、串行查重、调用 CLI 创建副本并回读，再参数化入库。检查其返回的 `warnings`。不得绕过 helper 用临时 SQL 拼接写入。失败时如实说明，按恢复说明处理，不自动反复创建副本。Bilibili 任务无论总结/保存成功、失败或取消，收尾均执行专用 `cleanup` 删除本次系统临时目录；音频转写后已立即删除。不得删除模型缓存、用户文件或飞书副本恢复状态。

`source_type` 分类收藏对象本身：

- `article`：新闻、公众号、专题及其他网站文章。
- `paper`：论文、预印本。
- `podcast`：音频播客节目或单集，例如小宇宙上的播客；以完整音频或完整逐字稿为依据，节目简介和 show notes 不算全文。
- `video`：视频或其完整字幕/转写。
- `tech_doc`：技术文档、API参考、使用/部署指南、技术规格、模型卡（例如 Hugging Face 的模型卡，含架构、参数、许可、评测和限制）。
- `project_repo`：项目代码仓库及其项目入口页，例如 GitHub/GitLab 仓库主页；收藏的是整个项目时归此类，即使主要介绍内容在 README 中。

按实际收藏对象区分：仓库里的某篇使用指南、模型卡属于 `tech_doc`，项目仓库整体属于 `project_repo`；介绍某个项目的网站文章仍归 `article`，音频播客归 `podcast`，论文解读不因引用论文而归为 `paper`。采用用户明确指定的类型；否则按内容判断，语义明确时直接选择，不因本轮未指定类型而要求确认。确实不确定才询问。运行 `types` 查看数据库当前枚举，不自行新增枚举；提取器的 `source_type_hint` 仅是待核对线索。

## 查询和更新

支持按编号 `get ID`、按标题 `search 关键词` 查询。先给摘要及原链接或副本入口，用户选择后再读取全文。

只有用户明确要求才使用 `update ID --confirmed`。只传本轮要求修改的字段；保留未提供的字段及入库时间。重新总结需重读全文；单改摘要不重建/覆盖全文副本。用户明确要求同步全文变化时才传新的副本正文，helper 复用原副本地址。

## 回复

简短回复“已收藏/已收藏过/已更新”、编号和标题，附类型、来源/作者（有则显示）、摘要及命名全文链接。不把内部日志、凭证或冗长操作过程发到飞书。来源时间有值可展示为北京时间，数据库时间仍用 UTC。
