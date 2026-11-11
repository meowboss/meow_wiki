# Meow Wiki 完整架构设计 · 评审稿 v0.1

状态：**待用户评审，非已批准实施方案**。本文件是目标设计，不是当前实现说明。与模块代码冲突时不得倒推设计迁就代码；先评审决策再实施。设计先行意味着完整覆盖关键约束，不意味着预先实现所有基础设施。

## 1. 需求基线与范围

### 已确认的产品要求

- 每个用户能创建、管理自己的专属 Wiki 页面与平台体验。
- 官方提供 LLM Wiki、Markdown 渲染、检索等基础插件，默认安装。
- 用户可创作组件；默认仅自己可用，官方审核通过后才在市场公开供他人安装。
- 框架开放、健壮、兼容，采用成熟优质依赖，避免在业务功能前堆积基础设施。

### 推荐但尚待确认的产品决策

- 首发为可自托管的 Web 平台；支持多人账号，每人可有多个私人空间。团队协作和公开 Wiki 后置。
- 用户扩展首发是声明式组件，不允许任意后端代码。若“用户组件”必须支持自编程，需要另立隔离执行里程碑。
- AI 默认不自动发布或覆盖知识；先产草稿，经人工确认落库。
- 首期知识来源支持 Markdown/纯文本；PDF/OCR/网页抓取在插件契约稳定后引入。
- 初期单实例部署；SQLite 适用于个人/试运行，多人生产推荐 PostgreSQL，但不同时维护两套未经测试的存储实现。

非目标：首发不做多人实时协同、复杂组织角色、移动原生端、图谱推理、任意第三方代码运行和多区域集群。

## 2. 架构原则

1. **业务皆可插件，安全规则不是插件建议**：身份、授权、事务、迁移、审核守卫由宿主实施。
2. **内容可携带**：Markdown和结构化元数据可导出；插件不拥有用户内容的唯一副本。
3. **显式依赖、显式失败**：不按导入顺序覆盖能力，不以降级假成功掩盖错误。
4. **先纵向闭环再抽象**：至少出现第二个真实提供方后才泛化适配层；无需求不做万能工作流。
5. **先进性用于降低风险**：类型化契约、来源追溯、乐观并发、最小权限优先于追逐框架数量。
6. **兼容是可测试的承诺**：API/schema/release版本独立，迁移与契约测试是发布门槛。

## 3. 系统全景与信任边界

```text
浏览器固定 shell
  ├─ Wiki 工作台 / 页面编辑器 / 空间首页
  ├─ 组件创作 / 插件市场 / 官方审核工作台
  └─ 第一方 UI 插件贡献（静态打包、命名槽）
                  │ 同源 HTTPS + session + CSRF
HTTP 边界：schema / 请求限额 / 身份 / resource scope / 错误契约
                  │
模块化单体宿主
  ├─ Identity / WorkspacePolicy / Audit
  ├─ Content：页面、revision、树、引用、附件
  ├─ Extension：registry、installation、组件release、审核
  ├─ Knowledge：source、revision、job、chunk、索引代际
  ├─ ModelBroker：凭据引用、出站策略、预算、超时
  └─ Jobs / Transactions / Migrations / Storage ports
                  │
第一方插件：Markdown / 关键词检索 / RAG / 导入导出
                  │
关系数据库 + 附件目录（后续可接对象存储）

将来：不可信代码执行器位于另一个安全边界，不接触数据库或明文密钥。
```

同进程插件与宿主同等信任；manifest、DI、Worker都不是恶意代码沙箱。声明式组件视为不可信数据，经schema约束与安全渲染，不使用eval或允许任意HTML。

## 4. 模块职责与依赖

| 模块 | 拥有的数据/职责 | 允许依赖 | 禁止 |
|---|---|---|---|
| Identity | User、Session、认证限流 | DB/crypto/clock | 根据客户端role/header授予身份 |
| Workspace | Workspace、Membership、Scope | Identity、DB | 将切换空间视为切换调用者 |
| Content | Page、Revision、Link、Asset | WorkspacePolicy、Storage | 不带scope读写、无版本覆盖 |
| Kernel | Manifest、能力注册与生命周期 | 类型契约、logger | 业务授权绕过、任意下载执行 |
| Extension | Draft、Release、Install、Review | WorkspacePolicy、Kernel、Audit | 作者自行发布、已审快照被修改 |
| Knowledge | Source、Job、Chunk、Citation | Content契约、WorkspacePolicy、Jobs | 过期作业提交、删除后复活 |
| Models | ModelProfile、调用预算、secretRef | 网络/密钥broker | 把API key给UI或组件 |
| UI | shell、命名槽、组件渲染 | DTO/HTTP客户端 | 直接操作数据库、加载任意远程模块 |

采用显式应用服务调用，不以事件总线隐藏同步业务。只有提交后的事实通知进入事件hook；影响事务成功与否的校验必须直接调用。事务内不进行网络等待。

## 5. 领域模型与数据约束

- **User**：id、标准化username、passwordHash或外部身份subject、状态。管理员是平台角色，不能由注册表单决定。
- **Session**：token摘要、userId、到期、撤销；公开响应不返回密码/内部摘要。
- **Workspace**：id、ownerId、名称、说明、homeLayoutRevision。首期owner-only；Membership接口留待协作实际引入，不预建复杂RBAC。
- **Page**：workspaceId、id、parentId、currentRevision、deletedAt。parent必须同空间、防环；删除父页后子页行为固定为显示在根层，不隐式级联删内容。
- **PageRevision**：pageId、递增revision、title、markdown、actorId、operation、createdAt；不可变。保存/恢复/AI确认均追加revision。
- **Link**：从指定pageRevision提取的wiki链接；同空间解析，失效链接可见；不允许反链绕过来源页权限。
- **Asset**：workspaceId、contentHash、mime、size、storageKey；下载走授权路由，禁止路径拼接和原始用户文件名作为存储路径。
- **ComponentDraft**：ownerId、workspaceId、schemaVersion、内容、revision。
- **ComponentRelease**：不可变snapshot、digest、作者、版本、审核状态；Review作为单独审计事实。
- **Installation**：workspaceId、releaseId、enabled、配置版本；固定版本，升级显式确认。
- **SourceRevision**：原始材料快照、摘要、解析器版本；产物保留来源定位。
- **Job**：workspaceId、sourceRevision、stage、attempt、状态、幂等键；重试产生新attempt而不是抹掉历史。
- **Chunk/Citation**：来源revision、chunkId、字符范围/页号、索引代际；回答能定位当时材料。
- **ModelProfile**：workspaceId、provider、model、允许的endpointRef、能力、上下文/输出预算、secretRef。

所有资源ID不可被当作授权证据。仓储公开方法必须传已验证scope或caller+workspaceId。数据库外键与唯一约束补充应用校验，不将SQLite行过滤描述成RLS。

## 6. 插件协议与兼容

目标契约：`manifest {id, version, apiVersion, kind, requires, configSchemaVersion}` + `setup(ctx)`。首期静态导入第一方插件；只支持一种setup形态。

- 提供者扩展点：renderer、retriever、importer、exporter、assistant。每个接口只在对应功能实施时定义，不提前实现所有可选方法。
- 注册返回disposer，由宿主归属到插件scope；setup失败逆序清理已注册资源。
- 生命周期：validated → starting → active → stopping → stopped；失败进入failed，清理等待完成。纯函数启停与真正资源卸载分开。
- 依赖图拓扑加载，缺失/循环/版本不满足拒绝；禁用被依赖者须先禁用依赖方，不静默连锁。
- UI第一期仅 `nav.items`、`editor.toolbar`、`page.actions`，稳定key、排序、重复拒绝与错误边界；不造通用slot语言。
- 前后端同插件身份但独立入口，只共享DTO/schema，不把server模块打包入浏览器。
- `apiVersion`不兼容直接拒绝；插件semver描述能力变更，配置版本负责迁移；历史release不就地改写。

第三方代码SDK另立ADR：跨源iframe可用于UI隔离，后端需受限进程/容器、网络与文件策略、资源限额、受限RPC和签名供应链；这些不能靠审核替代。

## 7. 用户核心流程与状态机

### 7.1 编辑与恢复

读取revision N → 用户编辑 → 保存携带expectedRevision=N → 事务CAS → 新revision N+1。冲突409，保留本地草稿，用户对比/重新加载；禁止自动刷新版本后覆盖。软删除离开检索，恢复产生新版本。草稿本地缓存按user/workspace/page隔离并可清理，不把明文私人知识默认长期留在共享设备。

### 7.2 私有组件与市场

草稿创建/修改 → 提交不可变snapshot → pending → reviewer批准published或退回rejected。作者不能审核自己；管理员初始化必须有受信凭证，不能通过抢注预留用户名成为管理员。

已发布release可withdrawn，禁止新安装；已有安装固定快照可继续读取，危险组件紧急吊销策略另行明确。作者改草稿不影响已发布版本。首页引用本人私有组件或当前空间已安装release，不能凭ID引用他人草稿。

### 7.3 来源处理与AI

上传/导入 → sourceRevision → queued → running → ready/failed/cancelled；删除先tombstone并撤回产物。提交时再校验revision/attempt，旧任务失败退出。首期用数据库任务表与单进程worker，重启可恢复，不引入Redis。

问答：授权 → scope → 关键词/可选向量检索 → 去重/topK → 上下文预算 → 模型调用 → 引用验证 → 回答。没有模型可提供明确标识的摘录模式，不假装生成。网络失败不是“无相关资料”。

AI写作：proposal记录来源revision、目标expectedRevision和拟议内容 → 用户确认 → 再授权/来源有效性校验/CAS → 新页面revision。资料删除或目标版本变化时拒绝旧提议。

## 8. HTTP与错误契约

采用普通JSON HTTP API；暂不引入自动RPC/codegen服务。路径按auth/workspaces/pages/components/releases/sources/models/proposals分组。workspaceId显式传递并授权，默认空间仅用于便捷导航，不用于安全推断。

错误结构：`{error:{code,message,requestId,details?}}`；400输入、401身份、403操作禁止、404不存在或不可见、409版本/状态冲突、413超限、429限流、502/504外部模型失败。内部堆栈/SQL/密钥不输出。分页列表有硬上限，创建返回资源版本，修改使用expectedRevision。

同源session cookie采用HttpOnly、SameSite与HTTPS Secure，写请求CSRF校验；路由级授权以匹配后的路由契约为准，不能只按原始URL前缀。local/token为兼容模式，不开放权限捷径。正式公网部署要求可信origin/host配置，而非复制仅localhost白名单。

## 9. 安全、性能与运行

- 密码使用成熟算法实现，异步哈希；优先成熟认证方案，内建密码登录需单独审查。注册/IP/账号/模型调用均需限额与并发预算。
- Markdown sanitizer、CSP、上传类型/大小验证；附件不允许主动HTML在应用origin执行。
- 自定义模型endpoint和URL导入由出站broker控制：协议/端口允许集、私网与元数据IP拒绝、DNS校验与连接固定、逐跳重定向校验；不能只检查URL字符串。
- 密钥初期允许部署环境secretRef，UI只显示是否配置；若持久化用户key需AEAD和独立主密钥及轮换方案。
- 查询索引按workspace/sourceRevision建立。初期同步小事务，任务/模型异步；容量指标先测量再扩展数据库与worker。
- 健康检查分存活/就绪；日志携带requestId，不记录密码、cookie、模型key、默认不记录完整私人文档。
- 每次数据库迁移有版本、事务、备份前置要求；恢复方案先演练。SQLite在线备份用专用API而非运行中只复制主文件。
- 自动化覆盖单元、仓储迁移、API权限矩阵、浏览器闭环；LLM需要固定检索语料与引用评测，不能以文风评判质量。

## 10. 发布与变更治理

实现前：ADR记录替代方案/代价/退出策略 → 契约与验收评审 → 最小纵向切片 → 测试与用户入口 → 文档更新 → Git提交。每个阶段明确“可用/实验/未实现”，不将类型接口当成完成模块。

首个已提交基线为M0原型；后续未提交实验不构成已验收方案。完整实施顺序见 [开发计划](<development-plan.md>)，选型见 [技术决策](<technical-decisions.md>)。
