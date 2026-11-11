# 已淘汰的认证实验

本目录保存正式Better Auth选型前的独立密码/会话实验，便于追溯，不属于生产应用、类型检查或默认测试集合。不得导入应用或将这些测试计入正式产品认证覆盖。

归档保留原文件与原相对import，因此原测试并非在本目录可直接运行；若需研究，应在独立临时项目调整路径，不能重新接回生产身份。正式实现为src/identity.ts，正式验收为tests/identity-http.test.ts与tests/sessions.test.ts。
