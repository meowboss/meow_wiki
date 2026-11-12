# 用户Provider配置交付

2026-11-12。参考DSH实际settings/discovery/credential源码，细节见dsh-provider-reference.md。

已实现OpenAI/DeepSeek/custom预设、公开HTTPS Base URL、Key只写、手动模型或远端GET /models候选、独立低预算推理测试（提示费用）、custom编辑/空key保留、改vendor/URL必须新key。旧host-map/v1密文兼容；custom v2 AAD绑定URL/vendor防替换。真实对话custom endpoint每请求走DNS校验和连接pin transport，旧host受信本机映射仍独立。

网络：每次解析全部DNS并拒任何私有/回环/特殊IP，IPv6与mapped检查；Undici Agent lookup固定已验证IP，原hostname保留TLS验证；禁redirect，10s模型列表/30s聊天、256KiB响应。用户URL不能用于访问本机Ollama等；若需本机模型由部署host map显式批准，不放宽用户URL。

独立review发现并修复JSON Unicode编码Key回显和普通错误错误映射：解码JSON后再次检查当前key，非法URL400、网络/上游协议失败502，UI错误不回显上游body。模型列表获取不等于推理成功，不宣称自动发现reasoning/image/tools能力。

验证：新旧vault12项+network9项+operations与review回归通过；16个系统spec/17浏览器测试通过；自定义Provider无host端点创建/编辑/不回填key真实浏览器通过，桌面移动截图已实际看；独立对话fixture改用受信host-map API准备配置，未为测试放宽公网URL安全策略。真实商业provider尚无key，未进行付费推理；DNSpin/TLS端到端公网兼容未实测，测试采用注入resolver/transport与本地受信HTTP链路，不能宣称所有云厂商可用。

限制：仅OpenAI-compatible；不支持原生Anthropic/Responses等协议。发现/测试依赖超时，不会因浏览器断连立即取消；项目执行显式cancel仍有效。生产部署仍需限流/审计与外部provider实际验收。
