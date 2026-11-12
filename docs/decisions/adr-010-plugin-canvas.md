# ADR-010：从内容块转向全站插件画布

性质：架构修订提案，待实施。2026-11-12。用户已明确产品方向为全站自由组合；本文技术细节是本轮设计结果，不表示功能已完成或新增执行权限已获批准。

## 决策方向

采用统一的PageComposition、ViewInstance与CanvasHost，首页/知识空间/协作页面是可恢复预设。目录、正文、工具栏、背景、桌宠、视频均为可替换实例；不要求Markdown，不强制卡片外框。布局、样式、交互事件和能力绑定分别建模。

保留身份、授权、版本保存及不可被遮蔽的恢复入口作为最小宿主边界；现有导航不是永久不可修改的业务壳。跨路由常驻shell组合与route/document组合有明确作用域；播放器/桌宠可常驻，切空间撤旧权限。

## 取代关系

- [ADR-003](<adr-003-component-extension-boundary.md>)中“首发三类声明块”继续描述v1兼容数据，不再作为新系统自由度上限。
- [ADR-004](<adr-004-content-and-editor.md>)正文与布局分离原则保留，扩为全站页面组合。
- [ADR-007](<adr-007-browser-plugin-runtime.md>)代码隔离限制保持有效；固定示例不等于通用运行时。
- [ADR-008](<adr-008-controlled-plugin-workshop.md>)现component.json工坊继续可用；v2需升级产物/SDK/校验/预览/导入，不悄然执行旧JSON中的脚本。

## 不采纳

不把更多硬编码block、少数命名槽、主题换色或首页拖拽视为全站画布；不为视觉自由先引入任意服务端代码/全局DOM/CSS权限/通用工作流平台。不修改旧release内容及digest，不在普通读取时自动迁移数据。

## 实施约束

共享strict schema、服务端scope+强制CAS、固定release、实例生命周期、资源归属、局部样式、typed事件、移动/键盘编辑和恢复入口先形成一致协议。任意用户JS须单独实证其隔离与故障恢复；可以先通过声明式动画/媒体实例兑现桌宠与播放器能力，但不能称已支持任意代码。

详见[架构设计](<../architecture/plugin-canvas.md>)与[分阶段计划](<../plans/plugin-canvas-roadmap.md>)。本轮仅文档设计，产品保持现有版本。
