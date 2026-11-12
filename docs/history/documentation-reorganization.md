# 文档知识库整理验收

性质：文档整理快照。日期：2026-11-12。

将原docs根目录63篇Markdown分入status/architecture/decisions/features/plans/references/history，新增guides维护规范；根目录仅README和AGENTS。8个分类索引可导航所有文章，路径迁移映射保留在scripts/docs-path-map.json。

独立只读审阅核验当前状态、路线与近期功能，修正README备份/已实现功能、剩余计划的历史归档待办、当前Provider两条链路及具体IP政策、页面历史预算与JSON活页包。历史交付测试数字保留；旧Provider政策显式标后继，设计的待审批措辞标原始语境，不视为新授权要求。

链接检查覆盖README与docs的本地Markdown路径以及分类索引覆盖，忽略外部URL/本机绝对路径/片段内容，不证明锚点有效或远端存在。维护检查加入现有CI配置，本轮未执行远端CI。无应用代码变更，无需重启用户服务；未重跑产品功能测试，不更新旧测试总数。

维护入口：[知识库](<../README.md>)、[规范](<../guides/documentation-governance.md>)。分类README通过scripts/build-doc-index.py生成；check-doc-links.py独立只读验收。迁移/状态脚本为已执行一次的维护记录，不能对已迁移树盲目重复执行移动。
