# media-keeper 规则

- 使用同一仓库维护采集 Skill、查询后端和共享数据规则；Skill 与查询 API 共用资料库，采集不依赖 API 在线。来源：2026-10-23 用户要求“根据这里面所提示的方式，先对项目进行结构调整”，并提供单仓库、共享 core/db、采集与查询分离的结构建议图。
- 后端框架采用 NestJS。来源：2026-10-23 用户明确要求“后端框架采用 nestjs”。
- 查询 API 使用只读数据库账号，采集与 API 分别加载配置。来源：同次用户采纳的结构建议图；实现依据见 [数据库服务](../apps/api/src/database.service.ts) 与 [配置示例](../deploy/api.config.example.json)。

- 前端通过 Module Federation 接入 my-dashboard，继承宿主 PingFang SC、主题与路由；Media 仅在工具页展示。来源：2026-10-23 用户确认设计，并要求“现在开始前端的开发吧，注意要通过module federation接入my-dashboard”。

- `podcast` 仅指音频播客（如小宇宙节目/单集），网站文章归 `article`。来源：2026-10-23 用户纠正 source_type 的含义；同步代码、采集说明和 MySQL 枚举。

当前迭代的范围与临时取舍记在对应 iteration.md；用户任务授权和候选方向不存入本文件。
