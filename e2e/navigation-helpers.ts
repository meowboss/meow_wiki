import type { Page } from '@playwright/test';

const navigationGroups: Record<string, string> = {
  知识域: '知识协作',
  'Agent 连接': '知识协作',
  写入提议: '知识协作',
  资料工作台: '知识协作',
  插件市场: '组件中心',
  我的组件: '组件中心',
  组件工坊: '组件中心',
  插件实验室: '组件中心',
  组件审核: '组件中心',
};

export async function navigate(page: Page, label: string) {
  const navigation = page.getByRole('navigation', { name: '主导航', includeHidden: true });
  await navigation.waitFor({ state: 'attached' });
  const expandNavigation = page.getByRole('button', { name: '展开导航', exact: true });
  if (
    (await expandNavigation.isVisible()) &&
    !(await page.locator('.sidebar').evaluate((node) => node.classList.contains('is-open')))
  )
    await expandNavigation.click();
  const button = navigation.getByRole('button', { name: label, exact: true });
  if (!(await button.isVisible()) && navigationGroups[label]) {
    await navigation.locator('summary').filter({ hasText: navigationGroups[label] }).click();
  }
  await button.click();
}
