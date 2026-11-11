# 受控声明式插件工坊首批交付

2026-11-12。不是通用代码IDE或OS沙箱。虚拟文件存数据库，仅SDK两文件可读、component.json可写，不执行shell/npm/用户JS。最多8轮单工具调用，先校验再显式导入私有组件，不自动市场发布。

用户Provider使用部署allowlist endpoint ID；API Key经AES-256-GCM保存、随机nonce和绑定元数据AAD，密钥不进项目/模型prompt/响应metadata。主密钥使用MEOW_PROVIDER_MASTER_SECRET或持久host secret；轮换需重新加密方案，不能随意更换后声称旧配置可用。配置MEOW_WORKSHOP_ENDPOINTS为ID到URL JSON，默认空且UI禁真实模型运行。host批准URL是信任配置，不是通用SSRF防护保证。

97项测试通过：加密篡改/owner隔离、只读SDK/精确路径、running写入保护、mock工具循环/越权失败、校验导入。构建/格式通过；10条Edge系统用例通过；工坊桌面/移动截图实际读图。真实用户Provider未提供，模型质量/费用未实测，mock不算真实调用验收。

限制：HTTP同步最多8轮，UI超时不等于服务端取消；未做持久任务恢复/跨实例lease/完整取消；不接受任意用户JS构建。受控声明式创作是第一条可用路径，后续高级代码Harness必须独立执行器和运行安全评审。阶段5受审核写入MCP及场景构建尚未完成。
