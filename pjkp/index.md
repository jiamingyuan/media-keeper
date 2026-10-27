# media-keeper 项目入口

记录更新：2026-10-27。当前源码版本 0.5.0，发布引用 main / V0.5.0；基于 V0.4 `5b5acd1cf576f7c2961493a66a0adb1df29ed91c` 归档后续部署、摘要与 Loot Drop 改动。网站容器未因本次发布重新部署；用户整体验收结论尚未记录。

项目根目录：`/Users/jiamingyuan/Desktop/ai-infra/media-keeper`；仓库：<https://github.com/jiamingyuan/media-keeper>。V0.5.0 标签固定首次发布提交 `8da17e2`；main 在同一 0.5.0 版本追加维护 README 的 Agent 安装与升级指引，验证及范围见 V0.5.0 迭代。

## 记录入口

- [项目简介](project-brief.md)：产品定位、能力、来源类型含义与长期方向。
- [架构与当前部署](architecture.md)：技术栈、模块分工、接口与运行环境。
- [项目原则](rules.md)：摘要与字体等持续适用的交付要求。
- [V0.5.0 迭代](V0.5.0/iteration.md)：本次发布内容、验证及运行环境边界。
- [V0.4 迭代](V0.4/iteration.md)：V0.4 发布及其后操作的原始记录；后续代码改动在 V0.5.0 归档。
- [README](../README.md)：当前安装命令、配置和接口参数的权威入口。
- [AGENTS.md](../AGENTS.md)：用户指定的 Agent 镜像与容器操作约定，继续只在该入口维护。

## 版本

| 迭代 | 内容与归档状态 | 记录 |
| --- | --- | --- |
| V0.1 | 原 docs-keeper 采集 Skill；保留 V0.1 标签，原始用户验收结论未恢复 | [V0.1](V0.1/iteration.md) |
| V0.2 | 单仓库、NestJS 查询、共享 core/db、Media 远程前端与 podcast 纠正；无独立发布标签，随 V0.3 归档 | [V0.2](V0.2/iteration.md) |
| V0.3 | 统一 0.3.0，首次容器部署和全局 Skill 安装；归档提交 `b968b92134bf8c7d4fb2cf332447e84b54b8349f` | [V0.3](V0.3/iteration.md) |
| V0.4 | 统一 0.4.0，加入 Bilibili 完整音轨、本机转写与任务清理；保留发布后操作的原始记录 | [V0.4](V0.4/iteration.md) |
| V0.5.0 | Loot Drop 完整展开与双链接分析、摘要可读性、已有镜像独立容器部署、项目记忆归位 | [V0.5.0](V0.5.0/iteration.md) |

## 当前可接续状态

- 网站入口：<http://localhost:8080/tools/media-keeper>。2026-10-26 只读核对 media-keeper 容器为 running / healthy，无 Compose 项目标签；健康接口、资料列表和经 my-dashboard 转发的 Federation 清单均返回 200，资料总数 19。具体运行参数见架构页。
- 本机全局 Skill 位于 `~/.agents/skills/media-keeper`，版本 0.5.0。项目与全局的 SKILL.md、摘要指导字节一致；19 条存量摘要的重写结果与验证见 V0.4。
- Loot Drop 报告支持完整展开、原文摘要、中文飞书分析与双链接归档；当前统一命名为“{公司名称} Loot Drop 分析”，中国公司先查证中文名，正文按内容覆盖要求撰写；专用规则见 [loot-drop.md](../skills/media-keeper/references/loot-drop.md)。已同步全局 Skill；2026-10-27 按用户确认的“摘要和要点文档”方案真实收录 CodeMao #99，飞书、数据库与两个 API 入口回读通过，此时资料总数 21。随后按用户“重写一下#99”更新为“编程猫 Loot Drop 分析”，正文约 5,432 字符、八个独立分析模块，飞书和 API 回读通过；保留原编号、双链接和收藏时间。新版为独立分析，完整转载路径仍未实测，用户尚未验收新版正文；详见 V0.4。
- YouTube 仅完成一次可获取性实测：直接匿名获取受阻，同期官方播客音频可取；没有据此新增 Skill 的 YouTube 下载能力，见 V0.4。
- Figma 的 PingFang SC 替换在 V0.2 最后记录中尚未完成，本次未复核 Figma；网站字体已在此前前端验证中检查。历史测试、用户验收与当前只读核对分别记录，不相互替代。
