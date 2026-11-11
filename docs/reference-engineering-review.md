# 参考项目工程组织核验（第二轮）

2026-11-12。口径：根构建/类型/质量配置、真实模块路径与代表链路源码抽样，不是全面读完两仓；未运行参考项目测试/构建，未修改参考仓库，未读取凭据。

## WeKnora

- 根为Go模块，非根JS workspace；[go.mod](<C:/Users/liu20/code/WeKnora/go.mod#L1-L23>)。独立Vue/Pinia/Vite前端见[前端package](<C:/Users/liu20/code/WeKnora/frontend/package.json#L1-L17>)，build与type-check分开，无lint script，不能把命令存在当执行通过。
- 代表Wiki链路：[handler](<C:/Users/liu20/code/WeKnora/internal/handler/wiki_page.go#L22-L45>)处理HTTP/参数；[service](<C:/Users/liu20/code/WeKnora/internal/application/service/wiki_page.go#L47-L117>)编排版本、链接与持久化；[repository](<C:/Users/liu20/code/WeKnora/internal/application/repository/wiki_page.go#L29-L86>)持有GORM并白名单排序；[interfaces](<C:/Users/liu20/code/WeKnora/internal/types/interfaces/wiki_page.go#L9-L23>)定义契约，[container](<C:/Users/liu20/code/WeKnora/internal/container/container.go#L116-L124>)用dig装配。
- 并非严格教科书clean architecture：handler存在具体service依赖，且代表文件本身很大，不应照搬大文件。
- 前端一级api/components/composables/hooks/views/stores/router/types/utils/i18n，非统一features。参考[wiki API](<C:/Users/liu20/code/WeKnora/frontend/src/api/wiki/index.ts#L1-L41>)与[滚动composable](<C:/Users/liu20/code/WeKnora/frontend/src/composables/useChatScrollFollow.ts#L1-L48>)，借鉴集中请求与行为hooks，不复制宽松any或历史平铺。
- [.golangci](<C:/Users/liu20/code/WeKnora/.golangci.yml#L1-L24>)配置govet/revive/行长及格式化；[前端CI](<C:/Users/liu20/code/WeKnora/.github/workflows/frontend.yml#L30-L57>) test→type-check→build。Go CI有历史backlog只检查新增问题，不代表全库lint零问题。

## DeepSeek Harness

- pnpm多包/Node工具链，实际范围见[pnpm workspace](<C:/Users/liu20/code/deepseek-harness/pnpm-workspace.yaml#L1-L15>)；[tsconfig](<C:/Users/liu20/code/deepseek-harness/tsconfig.json#L1-L14>)区分host/client图，[base](<C:/Users/liu20/code/deepseek-harness/tsconfig.base.json#L5-L29>)严格检查。不能把全部源码合成单Program替代工程边界。
- 不采用统一handler/service/repository目录；[webserver](<C:/Users/liu20/code/deepseek-harness/packages/host/webserver/src/index.ts#L1-L9>)是Cordis Service入口，[session persistence](<C:/Users/liu20/code/deepseek-harness/packages/session/session-persistence/src/index.ts#L1-L25>)为领域契约，[storage hub](<C:/Users/liu20/code/deepseek-harness/packages/storage/storage/src/index.ts#L1-L16>)不做IO，[SQLite provider](<C:/Users/liu20/code/deepseek-harness/packages/storage/storage-sqlite/src/index.ts#L8-L21>)实现后端。
- apps/web只是shell构建；真实UI按packages/client/ui-chat等包组织，[ui-chat host入口](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-chat/src/index.ts#L1-L9>)和client/chat下组件/hooks/模型。不是目录叫features才算功能模块化。
- [connection](<C:/Users/liu20/code/deepseek-harness/packages/client/connection/src/client/index.ts#L1-L16>)集中通信与重连合约；[共享SQLite合约测试](<C:/Users/liu20/code/deepseek-harness/packages/storage/storage-sqlite/tests/sqlite-backend.spec.ts#L1-L40>)比各provider各自声明可用更值得借鉴。
- [oxlint](<C:/Users/liu20/code/deepseek-harness/.oxlintrc.json#L1-L10>)、[提交钩子](<C:/Users/liu20/code/deepseek-harness/lefthook.yml#L1-L25>)、[Vitest覆盖配置](<C:/Users/liu20/code/deepseek-harness/vitest.config.ts#L419-L430>)展示质量门禁，但含条件与排除，不能简化为所有源码无例外100%或本次已验证通过。

## 本项目采取什么

按领域组织模块，HTTP输入与用例隔离；浏览器app→features→shared单向依赖；持久化逐模块提取，不为了形式提前造万能仓储接口。插件契约/生命周期与受信provider分离，未出现第二真实提供方不建庞大装配引擎。工程结构测试与格式检查纳入日常验证。

不复制DSH海量包、双编译图与原生发行矩阵；不复制WeKnora大文件、跨层具体依赖和历史lint宽免。参考成熟工程的边界和证据，不以目录/代码量作为质量证明。
