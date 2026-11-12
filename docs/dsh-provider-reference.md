# DSH Provider设置专项核验

只读本机参考仓库，未读真实key/.env/.data，未修改参考项目。

- [设置操作](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-settings-models/src/client/operations.ts#L76-L97>)只有credential set/unset、settings mutate(expectedRevision)、models discover，无独立testConnection。
- [Provider编辑](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-settings-models/src/client/ProviderEditor.tsx#L239-L313>)key空白保留、配置与key分离，配置成功key失败需独立重试；不拿脱敏整树覆盖。
- [ApiKey输入](<C:/Users/liu20/code/deepseek-harness/packages/client/ui-settings-models/src/client/ApiKeyInput.tsx#L13-L46>)只写、不回读；描述API仅configured/source/writable。
- [模型发现](<C:/Users/liu20/code/deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts#L269-L307>)内置catalog直接静态返回，不验证key/baseURL；非catalog才请求端点。模型能力来自目录/声明，不是动态探测。
- [发现容量/错误处理](<C:/Users/liu20/code/deepseek-harness/packages/llm/llm-pi-ai/src/discovery.ts#L130-L164>)、[凭据描述](<C:/Users/liu20/code/deepseek-harness/packages/api/settings-controller/src/credentials.ts#L82-L118>)可借鉴有界/不回显key，不推断已具备SSRF保护。
- [本地secret存储](<C:/Users/liu20/code/deepseek-harness/packages/credentials/credentials-local/src/index.ts#L744-L774>)是本地YAML+锁/原子/权限，不是磁盘加密；Meow继续用AES-GCM，不照搬个人桌面信任边界。

Meow采用供应商preset+可编辑baseURL、密钥只写、空输入保留、模型列表失败可手填；独立轻量推理测试是本项目新增功能，不称DSH已有。当前只OpenAI-compatible，不虚构Anthropic/AWS/Vertex原生兼容。自定义端点每次DNS校验+连接固定、禁止重定向/私网，不把桌面URL输入直接移植到多人服务。
