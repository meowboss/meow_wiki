# 全站插件画布开发与迁移计划

性质：分阶段路线，2026-11-12。首个声明式C0–C2增量已完成本地验收，证据与限制见[当前实现](<../features/canvas-foundation.md>)；下表仍保留完整平台方向，不将跨路由/动态用户代码等后续要求混为本轮完成。详细契约见[架构修订](<../architecture/plugin-canvas.md>)。

## 阶段与退出标准

| 阶段 | 交付内容 | 必须展示的结果 |
| --- | --- | --- |
| C0 协议和兼容底座 | 共享组合/实例/布局schema；composition repository+强制CAS；旧首页adapter | 旧数据顺序/引用/revision保持，旧release字节和digest不变，重复组件有稳定不同instanceId；非法树/跨空间/双标签冲突被拒且不丢草稿 |
| C1 全站组合宿主 | 同一CanvasHost和编辑器接入home/wiki/collaboration；目录/正文/检索/协作列表注册为独立官方视图 | 三类页面都能把目录移到右侧、正文扩宽、删除或替换工具栏、保存刷新；新增视图仅注册包不改App专用分支；禁用Markdown时背景/目录/播放器仍工作 |
| C2 可用自由画布 | flow/grid/free容器、背景/内容/悬浮层，移动断点、主题/实例样式；选择/拖动/缩放/对齐/层级/键盘替代/撤销重做 | 不套统一卡片，读模式无编辑框；同页两目录独立配置；390px、200%缩放可读可操作；布局与正文revision互不覆盖 |
| C3 用户点名的表现组件 | 最小asset服务+背景图/背景视频/播放器/动画桌宠；typed事件连线与实例状态 | 视频原生播放/暂停、字幕与失败态；桌宠拖动点击但透明区不吞输入；reduced-motion回退；跨路由常驻播放器不重启、切空间撤旧资源 |
| C4 创作发布贯通 | 工坊生成v2包/组合，统一schema和真实runtime预览；完整资源release、安装升级/撤架 | 用户对话生成目录/背景/播放器/桌宠组合并修改布局，预览与安装一致；审核完整快照，升级失败原子保留旧包/布局，资源跨用户需重绑 |
| C5 可执行用户插件 | 独立代码包构建与资源快照、隔离UI SDK、权限/消息/资源生命周期实测 | 用户可写隔离HTML/CSS/JS自定义交互，不靠固定块冒充；实际验证故障与恢复能力，未证实CPU强终止前不开放任意未受信代码 |

C0–C2构成第一个可评审实现增量，必须同时演示三类业务页面的组合权；只交首页拖拽不合格。C3紧随其后提供用户点名内容，不把媒体/桌宠永远留作抽象扩展点。C5仍是独立开放门槛，不阻塞声明式动画/媒体可用。

## 最小依赖方向

```text
packages/ui-contracts  ← backend composition service/repository
          ↑            ← package/asset service
          ↑
canvas runtime ← registry/adapters ← 内置业务视图
          ↑
layout editor + property inspector
          ↑
App（身份、路由、授权上下文、恢复入口）
```

名称为建议，落地先检查既有包边界。runtime不得import业务App；业务features通过适配层消费capabilities，不跨feature偷状态。编辑器操作reducer/布局校验为纯函数；所有保存走服务端scope+expectedRevision。新增契约的预览与运行复用同一校验，不再维护手写第二份schema。

## 具体迁移策略

- `page_compositions`按owner/workspace/surfaceKey/targetKey分作用域，shell跨页常驻与route/document局部组合区分；跨域权限和个人外观分开，不让域成员修改他人的私人布局。首批预设复制，不做多层继承/自动合并。
- 空间shell的桌宠/播放器实例跨route保持，切workspace/domain撤旧授权、递增generation并丢弃旧回包；路由实例正常dispose。
- v1首页迁移显式、事务化、可回退；保存原revision，不把缺省0/首次1语义改成新起点；记录来源映射，幂等运行。v1 API保留adapter。
- 旧template仅legacy renderer依赖Markdown；新包不要求template字段。未知类型占位可导出/禁用，卸载不静默删配置或asset。
- 资产先有归属/类型/字节预算/引用清理，不首批建设转码集群或素材市场；外链显式授权，不能以放开CSP所有网络来实现播放器。
- schemaVersion、plugin API、configVersion、content revision、composition revision、release digest分别定义，不能一个version混用。

## 交互验收与故障验收

1. 首页、知识空间、协作页各使用相同布局编辑器：目录右置、搜索顶置、背景、播放器、桌宠；保存刷新复现。编辑正文后换布局不丢内容，改布局不暗中保存正文。
2. 两个目录实例各自配置与选择，重排/复制/删除不串焦点和状态；笔记列表与文章heading outline是两个独立视图。
3. 桌宠hitbox外可滚动选字；播放器用户手势有声播放、背景静音，页面隐藏暂停，省流/减少动效有静图fallback。
4. 双账号/双空间/双域绑定与撤权：安装者不读作者页面；数据权限每次服务端核验，旧generation结果不得进入新scope。
5. 错误插件、未知release、失联、超量RPC不影响其它实例；安全模式/恢复预设永远可达，恢复保全旧布局。CPU死循环若未实际证明可终止，禁止写成验收通过。
6. 键盘完成添加/移动/改尺寸/层级/保存，窄屏逻辑阅读顺序独立于坐标；移动端不只给hover控制。
7. 保存断网、刷新、双标签409各保留布局草稿；布局与正文草稿分开。撤架旧安装仍遵守已有快照语义，紧急吊销有可恢复占位。
8. 工坊最终生成v2 package/instance而非永远写component.json；SDK文档、系统prompt、工具验证、预览、导入与审核同批升级。

## 评审收敛与不做事项

独立源码审阅确认已有layout CAS和release锁定可复用；独立反方评审要求不将命名槽换皮称为画布。采用其跨页常驻层、最小asset与键盘/移动恢复验收。首批不引入CRDT、通用工作流语言、任意服务端插件、任意npm安装或OS式平台；不以删减自由度代替这些工程取舍。

本轮只交设计与迁移方案，未编写画布代码，未重跑产品测试；当前运行服务保持既有功能。
