import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mindmap-node')).toHaveCount(1);
});

test('edits, undoes, saves and reopens a mindmap', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  await expect(page.locator('.mindmap-node')).toHaveCount(2);
  await page.getByLabel('名前', { exact: true }).fill('新しい枝');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(page.locator('.mindmap-node')).toContainText(['中心', '新しい枝']);
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('.mindmap-node').last()).toHaveText('（無題）');
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('.mindmap-node').last()).toHaveText('新しい枝');
});

test('previews and applies a proposal through shared history', async ({ page }) => {
  await page.getByRole('button', { name: '変更をプレビュー' }).click();
  await expect(page.locator('.mindmap-node').first()).toHaveText('中心');
  await expect(page.locator('#proposal-after')).toHaveText('新しい名前');
  await page.getByRole('button', { name: '採用', exact: true }).click();
  await expect(page.locator('.mindmap-node').first()).toHaveText('新しい名前');
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('.mindmap-node').first()).toHaveText('中心');
});

test('exports and reimports native content and rejects invalid data', async ({ page }) => {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PaoBub用JSONを書き出す' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('mindmap.json');
  const path = (await download.path())!;
  const content = JSON.parse(await readFile(path, 'utf8'));
  expect(content).toMatchObject({ artifactKind: 'mindmap', schemaVersion: 1 });
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.locator('#file').setInputFiles(path);
  await expect(page.locator('.mindmap-node')).toHaveCount(1);
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('.mindmap-node')).toHaveCount(2);
  await page.locator('#file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') });
  await expect(page.locator('#message')).toHaveClass(/error/);
});
