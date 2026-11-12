# 用户提交基线复核与Markdown完善

基线HEAD/origin main均55edf68，用户已手动同步；工作树起始干净。复核采用两个独立只读任务（后端风险链路抽样、全部前端feature/app/shared），并由lead做Markdown实现与功能回归；不是形式化安全证明或全供应商验证。

## Markdown

独立每文档Marked parser；GFM表格/任务列表/删除线、中文标题稳定命名空间锚点与重复消歧；highlight.js core按需8语言（JS/TS/Python/JSON/Bash/CSS/XML/SQL），未知/超20k fence转义纯文本；危险链接过滤，外部noopener，内部锚点不强制新窗口；远程图片保留文字占位但不发跟踪请求。raw HTML先清洗去host id/active内容，再整体清洗；生成span class白名单；无Mermaid执行/数学公式支持承诺。

新增单元安全/语义与真实Edge复杂Markdown验收，实际读桌面/390px移动截图：代码着色、表格、disabled任务框、链接/锚点、图片占位可读，无水平页面溢出。用户原文不被渲染改写。

## 确认问题与修复

- 非session知识域/凭据/provider需账号，明确409，避免无user表500；不伪造local身份账号。
- HTTP body预算2MiB与20万Unicode Markdown字符上限对齐，仍由schema/路由配额限制。
- legacy存活子页引用已删除父页：导出副本缺父归根，不更改源数据。
- MCP撤旧凭据只清关联token，不丢另一个一次性token。
- 审核意见dirty接所有退出/导航guard；组件Escape/取消确认放弃；history Escape交由操作锁守卫。
- 工坊导入成功刷新父级组件快照，失败明确不重复导入，不推进编辑器基线。

## 验证状态

129项默认测试通过；类型/构建/格式通过。复杂Markdown浏览器用例通过且截图已查看。全系统最新回归与新增交互专门覆盖仍需继续执行；管理员review草稿真实浏览器尚缺专用fixture，不把API单测等价为完整UI覆盖。真实模型/通用代码沙箱仍是未完成边界。
