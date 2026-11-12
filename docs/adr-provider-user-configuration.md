# 用户Provider配置修订

2026-11-12。用户确认参考DSH，允许选择供应商、配置API地址/Key、获取模型、独立测试连接，再选择对话模型。只支持OpenAI-compatible首期协议，不假称所有原生provider兼容。

预设OpenAI/DeepSeek提供可编辑baseURL，custom手填；公开HTTPS自定义目标由后端每次DNS解析校验全部IP并固定连接到已校验地址，拒绝私网/回环/元数据/保留地址和重定向；host allowlist的本机HTTP是独立受信部署配置。Key只经后端请求，禁止写项目/对话、URL query。模型发现GET /models不是推理连通性证明；连接测试以低预算chat请求执行，需提示可能计费。

旧host endpoint ID配置与密文v1保持兼容；custom URL/vendor以密文v2 AAD绑定防DBmetadata偷换目标。编辑同URL可保留旧key，变更供应商/URL需新key，防误发旧凭据。UI不回显key，列表只metadata。模型列表失败允许手填模型，保存不强制测试通过。

DSH实际依据待专项报告补：不把静态catalog获取视为远端key成功，不复制只适用于个人桌面的无网络约束到多人服务器。
