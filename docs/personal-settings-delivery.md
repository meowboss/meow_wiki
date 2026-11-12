# 个人设置交付

GET/PATCH /api/profile读取真实Better Auth账户，昵称trim1..80，邮箱/角色/ID/时间只读，未知字段拒绝。会话与CSRF保护，role从宿主表读取，不接受客户端提权。ISO时间格式按实际BetterAuth SQLite验证。

左下用户区与右上头像入口进入同一页面，保存昵称同步AccountGate session显示，不重新挂载用户/空间、不推进页面版本。dirty/busy纳入导航/退出保护，local/token明确无可编辑平台账号。无任意外部头像URL。

159项默认测试通过，构建/类型/格式通过；profile实际浏览器验证查看邮箱、保存昵称、刷新后持久，桌面/390px截图实际查看。API覆盖双用户隔离、role/email注入、CSRF/跨站、退出重新登录持久。

首批不包含邮箱修改、密码修改/找回或头像上传；这些需额外安全流程，未作为已完成能力。
