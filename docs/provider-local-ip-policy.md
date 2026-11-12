# 明确IP的本地模型支持

2026-11-12。用户明确说明内网服务尚无HTTPS代理，要求允许具体IP。本次修订取代此前“所有custom只能公网HTTPS”的限制。

具体IPv4/IPv6允许HTTP/HTTPS及私有/loopback/IPv6 unique-local；域名仍HTTPS且每次全部DNS须公网。拒绝link-local/云metadata、0.0.0.0、组播/保留、IPv4mapped和非规范IPv4替代写法；不跟重定向，不接受userinfo/query/hash。HTTP明文传输Key，必须可信网络。127.0.0.1是Meow后端机器/容器，非浏览器机器。

显式开放私网IP意味着用户可以向后端可达内网发出固定models/chat请求；这是用户本地部署需求授权的信任扩展，不宣称消除所有SSRF。公网多人服务需结合网络ACL/部署策略限制访问者。

验证：162项测试通过，构建/格式通过；实际Node本机HTTP模型fixture（无代理、假Key）通过safe transport完成GET /v1/models和POST /v1/chat/completions。浏览器LAN HTTP地址保存/编辑通过；metadata阻断、DNS私网阻断和redirect限制继续测试。
