# 全站插件画布架构修订

性质：设计提案／待实施，不代表当前已有能力。日期：2026-11-12。用户方向：每个业务页面由插件定义、交互、样式与布局共同组成；不再局限于首页纵向Markdown块。

## 1. 产品原则与术语

**页面是一份可编辑的组合文档，不是宿主写死的模板。** 首页、知识空间、知识协作和自定义页面使用同一画布系统；目录、阅读器、编辑器、检索、协作列表、播放器、桌宠、背景均为插件的可放置视图。没有强制卡片外框，没有强制Markdown内容字段。

- 插件包 PluginPackage：manifest、能力声明、视图/配置契约与资源；发行版不可变。
- 视图 ViewDefinition：包提供的一个可组合UI，例如目录或播放器。一个包可提供多个视图。
- 实例 Instance：同一视图可放多个，拥有独立配置、局部状态、数据绑定和布局位置。
- 页面 PageComposition：视图实例、布局树、层、主题变量和事件连线。与知识笔记正文独立。
- 预设 Preset：首页/知识空间/协作是可恢复默认组合，不是三套独立渲染器。
- 内容资源：笔记、资料、域贡献、媒体是独立数据，不嵌入插件发行包。Markdown是笔记的一种内容格式，不是插件的根类型。

宿主只保留登录、授权、组合文档持久化、插件安装/禁用、恢复入口、运行资源管理；业务UI均走显式注册视图。所有者可移除业务工具栏，恢复按钮仍由受信宿主提供，不能被插件遮盖或冒充。

## 2. 与现状的实际差距

[ComponentRenderer](<../../web/shared/components/ComponentRenderer.tsx>)仅分派markdown/page-list/search，无blocks时回退Markdown；[首页](<../../web/features/home/HomeView.tsx>)只是最多12项纵向列表，外壳由宿主卡片包裹。当前[布局存储](<../../src/components.ts>)仅保存title和草稿/release引用。知识空间与协作页面由[App](<../../web/app/App.tsx>)固定装配。

现有首页revision/CAS、owner/workspace隔离、不可变release、安装快照是真实能力，必须沿用；不是推倒存储另造无版本画布。当前[SDK](<../../packages/plugin-sdk/index.ts>)只允许固定example.page-list和pages.list权限；[运行示例](<../../src/modules/plugin-runtime/routes.ts>)不是通用插件执行器。不能把开放manifest字段当作完成运行隔离。

## 3. 页面与布局文档

新增独立 `page_compositions`，不复用笔记的markdown字段。作用域明确owner/workspace/surfaceKey/targetKey，区分跨路由常驻shell、业务route和笔记document组合。首批预设复制，不引入全局→路由→页面多层继承合并。个人协作布局不影响其他成员，共享组合发布需独立域权限与CAS：

```ts
type PageComposition = {
  schemaVersion: 2;
  id: string;
  workspaceId: string;
  route: { kind: 'home' | 'knowledge' | 'collaboration' | 'custom'; key: string };
  revision: number;
  presetRef?: { id: string; version: number };
  root: LayoutNode;
  instances: Record<string, ViewInstance>;
  connections: EventConnection[];
  theme: ThemeTokens;
};
type LayoutNode =
  | { id: string; kind: 'flow'; direction: 'row' | 'column'; gap: number; children: LayoutNode[] }
  | { id: string; kind: 'grid'; columns: ResponsiveColumns; gap: number; children: LayoutNode[] }
  | { id: string; kind: 'free'; width: number; height: number; children: PositionedNode[] }
  | { id: string; kind: 'layer'; plane: 'background' | 'content' | 'overlay'; children: LayoutNode[] }
  | { id: string; kind: 'view'; instanceId: string; presentation: Presentation };
```

示例是概念契约，实施必须先形成共享strict schema。实例唯一引用、树无环、层深/数量/尺寸/JSON字节上限、有限断点、有限z范围需服务端校验；未知字段/版本明确拒绝，不静默丢配置。

首批提供flow/grid/free与三层；自由定位以容器逻辑坐标、resize/drag/snap和层级排序组成，不能只有上移/下移按钮。背景铺满画布；overlay锚定页面或viewport须显式选择。移动端每实例有断点布局或流式fallback顺序，不能用CSS缩放整张桌面画布。

同一实例的视觉坐标与逻辑阅读顺序分开；装饰默认不进入阅读树，功能桌宠有可命名按钮，iframe有标题和焦点进出约定。键盘、触屏属性面板、200%缩放以及减少动效/省流回退为验收项，不只支持鼠标拖拽。

编辑器支持选择/多选、拖动缩放、对齐、分布、层面板、属性面板、键盘移动、撤销重做、预览、显式保存。读模式没有编辑框；只在选中实例时出现控制柄。保存携带expectedRevision，冲突保留本地草稿，可复制/另存或显式重载；不得自动合并坐标覆盖他人修改。

## 4. 视图实例、状态与绑定

```ts
type ViewInstance = {
  id: string;
  viewRef: { packageId: string; releaseId: string; viewId: string };
  configVersion: number;
  config: JsonValue;
  bindings: Record<string, ResourceBinding>;
};
```

发布组合必须固定releaseId；作者编辑草稿在创作预览中可见，普通运行不得悄然随草稿变化。相同播放器实例可分别绑定不同视频，目录绑定当前空间的页面源，桌宠可没有数据绑定。新安装从manifest取得可编辑属性schema与默认值，不用宿主为每包新增if/else。

状态分三种：配置（布局保存）、实例持久状态（按owner/workspace/composition/instance作用域、独立CAS/预算）、会话临时状态（播放进度/hover等按需，默认不持久）。选中笔记是页面会话上下文，不能靠全站单例污染其它画布。

绑定只能引用宿主授权资源句柄。包不接受任意workspaceId/SQL/令牌；安装到另一空间必须重绑定本地资源。授权写入必须在宿主服务端再次核验，前端ctx不是授权凭据。

## 5. 事件与能力

目录发 `note.selected({pageId})`，阅读器通过明确连线订阅并读取授权笔记；播放器响应 `media.play`；桌宠可响应用户点击、导航事件；背景可响应主题。事件只连显式实例端口，typed schema、容量/速率上限、无eval表达式，不默认全局广播。首批一对一映射即可，不预造通用工作流语言。

能力按需授予：`pages.list/read`、`navigation.open`、`instance.state`、`assets.read`、`media.play`等；页面编辑/域审核等写能力走受信命令面和确认。Provider Key不进入视图上下文；模型调用走计费/取消broker，不把全上下文自动交给插件。撤销权限即时失效，重入不复活旧句柄。

## 6. 样式：真正可控且有作用域

实例外框默认none，边距/背景/圆角/阴影由实例presentation控制，可选择card外观。布局不强制标题/说明/按钮；创作面板中的名称不是运行时大标题。

页面主题提供背景、文字、强调色、字族、spacing、radius与明暗模式；插件可声明自己的CSS变量和局部样式。受信内置视图用Shadow DOM或编译期CSS作用域隔离，代码视图iframe内样式完全自控。允许布局容器/grid/flex/动画，不开放全局选择器覆盖宿主恢复层；禁止通过style URL隐式外发，远程字体/背景需asset授权。

层交互由宿主合成：背景pointer-events none；桌宠只在真实交互hitbox捕获点击，透明区域不能吞掉整页输入；弹层受宿主z预算约束，不能遮住退出/恢复。跨iframe拖放/缩放由编辑器在宿主overlay处理，运行时不套编辑控制框。

## 7. 两种插件执行适配，共用实例协议

- 内置受信包：目录、笔记视图、协作视图等使用宿主注册renderer和细粒度数据服务；必须走同一composition+instance契约，不允许仅把现App再包一个大官方插件蒙混过关。
- 用户声明包：布局、主题、媒体与受约束动态视图，无任意JS；适合首批背景/播放器/可配置目录。
- 用户代码包：独立版本契约、资源与依赖快照、构建验证、隔离iframe/受限MessageChannel；桌宠等交互可由此扩展。无同源allow-same-origin，不直接碰host DOM。iframe不是OS沙箱，不承诺可强制独立终止CPU死循环；任意未受信代码开放前必须验证独立执行方案与故障预算。

声明包不是最终自由度上限；用户代码模式必须作为明确里程碑交付，不能永远用固定renderer替代用户自定义行为。首批允许的模板桌宠动画与真正用户代码桌宠需分别标识。

媒体：优先托管asset或明确批准URL；上传/引用记录type/size/duration配额，video有原生controls、字幕/静音、autoplay策略；远程直播/认证流不属于首批无条件兼容。Web页面HTTP视频播放受浏览器混合内容与codec限制，必须报告真实错误。

## 8. 生命周期、故障与恢复

包安装→权限确认→实例创建→mount/resize/visibility→事件→unmount/dispose；监听器/订阅/计时器/媒体必须释放。离屏/后台暂停动画和视频资源；单实例ErrorBoundary和错误占位，未知版本占位可移除，不能让整个页面挂掉。

宿主始终提供“退出布局编辑/恢复默认组合/安全模式禁用用户插件”。重置有确认并保留旧revision快照；安全模式只跳过用户视图不销毁数据。一般撤架保持已有快照，安全吊销可禁执行并给替代占位，两者不同。

## 9. 兼容与包发布

旧home_layouts原样保留。首次选择迁移时，将顺序blocks映射为flow内legacy adapter实例，布局CAS和snapshot引用保留；旧template仅在legacy adapter渲染Markdown，新实例无隐式Markdown fallback。迁移幂等、记录来源revision/digest，不在普通GET静默改写。无JS/CSS资源的旧release仍不可变。

新package release摘要覆盖manifest、资源、样式、bundle、依赖锁/SDK版本；review针对完整快照。安装与升级显式，config/state迁移失败原子回滚；不静默升级跨包事件或扩大权限。组合导出不带秘密与私人正文，资源绑定声明可携带元数据并要求安装方重绑。

## 10. 模块边界与实施限制

共享contracts；backend composition service/repository；frontend canvas runtime、layout editor、capability client、package adapters分别独立。业务features导出受信视图适配，不互相importApp。App只装配session/router/recovery，不持每个插件的内部状态。单文件规模门禁、依赖方向、包schema兼容、迁移与资源清理测试应先落地。

不首批实现：协同实时CRDT、通用脚本工作流、任意服务端代码、全局CSS、无限嵌套/无限节点。用户要的是视觉/组合/交互自由，有限资源与明确协议不应退化成宿主固定三种块。

实施顺序和验收见[开发迁移计划](<../plans/plugin-canvas-roadmap.md>)。本设计改变旧首发组件边界，参见[ADR-010](<../decisions/adr-010-plugin-canvas.md>)。
