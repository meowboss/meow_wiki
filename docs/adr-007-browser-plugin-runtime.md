# ADR-007：首个浏览器代码插件运行边界

状态：实施中的受限预览验证，非完整恶意代码执行平台。

首批代码插件为自包含JavaScript产物 + manifest(apiVersion=1, id, version, permissions)。不动态import进宿主，也不共享React/DOM；使用sandbox=allow-scripts iframe的opaque origin（不授allow-same-origin）。iframe srcdoc由宿主生成CSP且用户代码作为外部blob脚本加载，connect/img/frame/worker默认none；平台默认CSP frame-src显式允许自身生成blob frame。SDK通过MessageChannel传受限请求，宿主只在frame.contentWindow握手且一次初始化中转移port，不把消息origin='null'当授权。

首批RPC只有workspace.summary和pages.list，返回授权当前空间的有限标题/id，不返回Cookie/key/rawDB。manifest权限与运行时每次授权同时生效，未知操作拒绝，参数/响应schema、消息次数预算、最大payload约束。实际mount时绑定workspace与实例，空间切换销毁iframe/port。插件不接触Agent provider凭据。

资源限制：iframe并非OS进程资源配额保证；无限循环可能影响浏览器，当前只允许受信示例预览，不开放任意用户代码执行或市场代码安装，直到独立来源/浏览器进程隔离与终止策略验证。禁止把浏览器sandbox称为开发文件系统沙箱。

开发→产物兼容：manifest Zod与SDK固定apiVersion；只支持self-contained JS，无任意npm安装/生命周期脚本、无eval/import网络依赖；预览与未来安装共用runtime。先做一个真实代码插件读取pages.list并渲染，测试私有权限/未知RPC/新窗口导航限制/卸载清理，再建设隔离开发工作区和Harness。

安全验收：真实browser验证parent DOM不可读、network被CSP拒绝、宿主RPC只能当前scope、未授权方法失败、reload销毁旧port。CSP与sandbox组合须测，源码字符串过滤不作为恶意代码安全边界。正式用户代码开放前另行独立审查与拒绝服务策略。
