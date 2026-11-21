import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.mindmap-node')).toHaveCount(1);
});

test('shows the center and new branch in the map and focuses its name', async ({ page }) => {
  const map = page.locator('.mindmap-map');
  const insideMap = async (node: ReturnType<typeof page.locator>) => {
    const bounds = await map.boundingBox();
    const box = await node.boundingBox();
    expect(bounds).not.toBeNull(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
    expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  };
  await insideMap(page.getByRole('button', { name: '中心', exact: true }));
  await page.getByRole('button', { name: '子を足す' }).click();
  const name = page.getByLabel('名前', { exact: true });
  await expect(name).toBeFocused();
  await insideMap(page.getByRole('button', { name: '（無題）', exact: true }));
  await name.fill('新しい枝');
  await name.dispatchEvent('compositionstart');
  await page.locator('.mindmap-panel').dispatchEvent('submit');
  await expect(page.getByRole('button', { name: '（無題）', exact: true })).toBeVisible();
  await name.dispatchEvent('compositionend');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await insideMap(page.getByRole('button', { name: '新しい枝', exact: true }));
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

test('composition Enter does not add a branch and undo redo preserves its ID', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  const node = page.locator('.mindmap-node').last();
  const id = await node.getAttribute('data-node-id');
  await node.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
  await expect(page.locator('.mindmap-node')).toHaveCount(2);
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.locator('.mindmap-node')).toHaveCount(1);
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await expect(page.locator('.mindmap-node').last()).toHaveAttribute('data-node-id', id!);
});

test('read-only prevents changes and stale proposals cannot be adopted', async ({ page }) => {
  await page.getByRole('button', { name: '変更をプレビュー' }).click();
  await page.getByRole('button', { name: '子を足す' }).click();
  await expect(page.getByRole('button', { name: '採用', exact: true })).toBeDisabled();
  await page.locator('#readonly').check();
  await expect(page.getByRole('button', { name: '子を足す' })).toBeDisabled();
  await expect(page.locator('#prepare')).toBeDisabled();
  await expect(page.locator('.mindmap-node')).toHaveCount(2);
});

test('left branch is reachable at the left edge and panel stacks on narrow screens', async ({ page }) => {
  await page.locator('#file').setInputFiles('fixtures/mindmap/valid-rich.json');
  await expect(page.getByRole('button', { name: '枝', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('#message')).toHaveText('保存済みデータを再読み込みしました。');
  const map = page.locator('.mindmap-map');
  await expect(page.getByRole('button', { name: '枝', exact: true })).toBeVisible();
  const bounds = (await map.boundingBox())!, branch = (await page.getByRole('button', { name: '枝', exact: true }).boundingBox())!;
  expect(branch.x).toBeGreaterThanOrEqual(bounds.x);
  if (page.viewportSize()!.width <= 700) {
    const panel = (await page.locator('.mindmap-panel').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
  }
});

test('TS-023 does not reuse an issued ID after undo when random bytes repeat', async ({ page }) => {
  await page.evaluate(() => {
    const original = crypto.getRandomValues.bind(crypto);
    let calls = 0;
    crypto.getRandomValues = ((array: Uint8Array) => {
      if (array.length !== 16) return original(array);
      calls++;
      array.fill(calls <= 2 ? 0x42 : 0x43);
      return array;
    }) as typeof crypto.getRandomValues;
  });
  await page.getByRole('button', { name: '子を足す' }).click();
  const issued = await page.locator('.mindmap-node').last().getAttribute('data-node-id');
  expect(issued).toMatch(/^n-[0-9a-f]{32}$/);
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await page.getByRole('button', { name: '子を足す' }).click();
  expect(await page.locator('.mindmap-node').last().getAttribute('data-node-id')).not.toBe(issued);
});

test('TS-025 displays a save failure and retries without losing the edit', async ({ page }) => {
  await page.getByLabel('名前', { exact: true }).fill('保存する変更');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.locator('#save-failure').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#message')).toContainText('保存エラー');
  await expect(page.locator('#save-state')).toHaveText('未保存の変更');
  await expect(page.locator('.mindmap-node').first()).toHaveText('保存する変更');
  await page.locator('#save-failure').uncheck();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('.mindmap-node').first()).toHaveText('保存する変更');
});

test('TS-027 allows temporary folding in read-only without changing history or saved content', async ({ page }) => {
  test.setTimeout(10000);
  await page.locator('#file').setInputFiles('fixtures/mindmap/valid-rich.json');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  const before = await page.locator('#native-data').textContent();
  const undoDisabled = await page.locator('#undo').isDisabled();
  await page.locator('#readonly').check();
  await page.getByRole('button', { name: '畳む' }).click({ timeout: 3000 });
  await expect(page.getByRole('button', { name: '枝', exact: true })).toHaveCount(0);
  expect(await page.locator('#native-data').textContent()).toBe(before);
  await page.locator('#readonly').uncheck();
  expect(await page.locator('#undo').isDisabled()).toBe(undoDisabled);
  await page.getByRole('button', { name: '再読み込み' }).click();
  expect(await page.locator('#native-data').textContent()).toBe(before);
});

test('TS-029 saves layout changes and restores them through undo and redo', async ({ page }) => {
  test.setTimeout(10000);
  await page.getByLabel('配置', { exact: true }).selectOption('tree');
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout, { timeout: 3000 }).toBe('tree');
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('radial');
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('tree');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('tree');
});
