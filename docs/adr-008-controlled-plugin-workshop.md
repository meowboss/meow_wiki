# ADR-008：受控插件创作Harness首批

2026-11-12。首批Harness生成声明式插件组件，不开放任意生成JS执行。已验证代码示例只是运行边界探索，不能用它跳过恶意代码CPU/安装治理。

开发workspace为数据库内虚拟文件系统：只读/sdk/README.md和/sdk/component.schema.json；仅允许写/project/component.json，拒绝路径别名/..、符号链接概念与宿主fs；不执行shell/npm/任意网络。不是OS沙箱，不宣称支持通用代码开发。工具仅read_file/write_file/validate_component，最多8轮、每轮一个调用、响应/内容预算；用户选择provider后模型工具输出经宿主schema校验执行，工具结果再回模型，支持失败重试和状态记录。

用户Provider配置仅能选择部署allowlist中的endpoint ID和model；key以AES-256-GCM加密、主密钥独立环境/宿主secret派生，响应只返回configured，模型prompt与虚拟文件不得包含key。禁止用户任意URL；host批准目标仍是部署信任边界，非通用SSRF防护证明。默认allowlist空，不假装有模型可用。

生成最终文件必须通过同一componentSchema验证才能私有导入，导入不自动提交市场，不静默覆盖旧组件；创建真实独立版本。任务保存输入/模型输出须限量且不写凭据；日志仅状态/次数，不记录secret。模型生成工具调用不是权限授权，执行点仍核对caller/project。

首批可验证目标：用户配置allowlisted provider→创建项目→运行受控循环→只写允许文件→验证→私有导入→现有首页渲染；mock协议测试与真实provider验证分开。通用JS SDK构建、独立执行器、沙箱进程与长任务恢复另行实施。
