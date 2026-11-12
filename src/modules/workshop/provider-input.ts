import { z } from 'zod';
export const providerKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (key) => /^[\x21-\x7e]+$/.test(key) && !/^Bearer\s/i.test(key) && !/^['"]|['"]$/.test(key),
    '请只粘贴API Key本身，不含Bearer前缀、引号、空格或换行',
  );
export function providerInputError(error: z.ZodError): Error & { statusCode: number } {
  const labels: Record<string, string> = {
    label: 'Provider名称',
    model: '模型ID',
    apiKey: 'API Key',
    baseURL: 'Base URL',
    vendor: '供应商',
  };
  const fields = [
    ...new Set(error.issues.map((issue) => labels[String(issue.path[0])] ?? '配置字段')),
  ];
  return Object.assign(
    new Error(
      `${fields.join('、')}格式不正确：名称最多100字符、模型ID最多200字符，API Key须为不含前缀/引号的可打印密钥；请检查对应字段`,
    ),
    { statusCode: 400 },
  );
}
