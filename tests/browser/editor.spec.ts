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
  await expect(page.locator('.mindmap-node')).toHaveCount(1);
  await page.getByRole('button', { name: '子を足す' }).click();
  await expect(page.locator('.mindmap-node')).toHaveCount(2);
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
  const initial = await page.locator('#native-data').textContent();
  await page.locator('#file').setInputFiles('fixtures/mindmap/valid-rich.json');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  const before = await page.locator('#native-data').textContent();
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('#redo')).toBeDisabled();
  await page.locator('#readonly').check();
  await page.getByRole('button', { name: '畳む' }).click({ timeout: 3000 });
  await expect(page.getByRole('button', { name: '枝', exact: true })).toHaveCount(0);
  expect(await page.locator('#native-data').textContent()).toBe(before);
  await page.getByRole('button', { name: '開く' }).click();
  await expect(page.getByRole('button', { name: '枝', exact: true })).toBeVisible();
  expect(await page.locator('#native-data').textContent()).toBe(before);
  await page.locator('#readonly').uncheck();
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('#redo')).toBeDisabled();
  await page.locator('#undo').click();
  await expect(page.locator('#native-data')).toHaveText(initial!);
  await page.locator('#redo').click();
  await expect(page.locator('#native-data')).toHaveText(before!);
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('#message')).toHaveText('保存済みデータを再読み込みしました。');
  await expect(page.locator('#native-data')).toHaveText(before!);
});

test('TS-029 saves layout changes and restores them through undo and redo', async ({ page }) => {
  test.setTimeout(10000);
  await page.getByLabel('配置', { exact: true }).selectOption('tree');
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout, { timeout: 3000 }).toBe('tree');
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('radial');
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout).toBe('radial');
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('tree');
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout).toBe('tree');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout).toBe('radial');
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await expect(page.locator('#save-state')).toHaveText('保存済み');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('#message')).toHaveText('保存済みデータを再読み込みしました。');
  await expect(page.getByLabel('配置', { exact: true })).toHaveValue('tree');
  await expect.poll(async () => JSON.parse((await page.locator('#native-data').textContent())!).layout).toBe('tree');
});

test('picks a branch color from the palette without color codes and keeps it after reload', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  const palette = page.getByRole('radiogroup', { name: '色' });
  await expect(palette.getByRole('radio')).toHaveCount(10);
  await expect(palette.getByRole('radio', { name: '色なし' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(/#[0-9a-f]{6}/i)).toHaveCount(0);
  await palette.getByRole('radio', { name: '青' }).click();
  await expect(palette.getByRole('radio', { name: '青' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  const branch = page.locator('.mindmap-node').last();
  await expect(branch).toHaveCSS('border-top-color', 'rgb(61, 111, 196)');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '再読み込み' }).click();
  await page.locator('.mindmap-node').last().click();
  await expect(palette.getByRole('radio', { name: '青' })).toHaveAttribute('aria-checked', 'true');
  await page.locator('#readonly').check();
  await expect(palette.getByRole('radio', { name: '赤' })).toBeDisabled();
});

test('picks branch marks by Japanese name, shows them on the map and allows at most four', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  const marks = page.getByRole('group', { name: '印' });
  await expect(marks.getByRole('checkbox')).toHaveCount(7);
  for (const name of ['疑問', 'アイデア', 'リスク', 'やること']) await marks.getByRole('checkbox', { name }).check();
  await expect(marks.getByRole('checkbox', { name: '重要' })).toBeDisabled();
  await expect(marks.getByRole('checkbox', { name: 'リスク' })).toBeEnabled();
  await page.getByRole('button', { name: '適用', exact: true }).click();
  const branch = page.locator('.mindmap-node').last();
  await expect(branch.locator('.mindmap-badge')).toHaveText(['疑問', 'アイデア', 'リスク', 'やること']);
  await expect.poll(async () => { const d = JSON.parse((await page.locator('#native-data').textContent())!); return Object.values(d.nodes as Record<string, { marks?: string[] }>).find(n => n.marks)?.marks; }).toEqual(['question', 'idea', 'risk', 'todo']);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '再読み込み' }).click();
  await page.locator('.mindmap-node').last().click();
  await expect(marks.getByRole('checkbox', { name: 'リスク' })).toBeChecked();
  await marks.getByRole('checkbox', { name: 'リスク' }).uncheck();
  await expect(marks.getByRole('checkbox', { name: '重要' })).toBeEnabled();
  await page.locator('#readonly').check();
  await expect(marks.getByRole('checkbox', { name: '決定' })).toBeDisabled();
});

test('keeps a branch with four marks from overlapping the next branch in every layout', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.getByLabel('名前').fill('A');
  const marks = page.getByRole('group', { name: '印' });
  for (const name of ['疑問', 'アイデア', 'リスク', 'やること']) await marks.getByRole('checkbox', { name }).check();
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.getByRole('button', { name: '枝を足す' }).click();
  await page.getByLabel('名前').fill('B');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.getByLabel('名前').fill('C');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  for (const layout of ['right', 'radial', 'tree']) {
    await page.getByLabel('配置', { exact: true }).selectOption(layout);
    const boxes = await page.locator('.mindmap-node').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `${layout}: ${i} and ${j}`).toBe(false);
    }
  }
});

test('TS-039 shrinks a large map to fit with 全体を見る, and zooms out and in step by step', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  for (let i = 0; i < 29; i++) await page.getByRole('button', { name: '枝を足す' }).click();
  await expect(page.locator('.mindmap-node')).toHaveCount(31);
  const zoom = page.getByRole('status', { name: '表示の倍率' });
  await expect(zoom).toHaveText('100%');
  await page.getByRole('button', { name: '全体を見る' }).click();
  const fitted = Number((await zoom.textContent())!.replace('%', ''));
  expect(fitted).toBeLessThan(100);
  const viewport = page.viewportSize()!;
  const sizer = await page.locator('.mindmap-sizer').boundingBox();
  const map = await page.locator('.mindmap-map').boundingBox();
  expect(sizer!.height).toBeLessThanOrEqual(viewport.height * 0.75 + 1);
  expect(sizer!.width).toBeLessThanOrEqual(map!.width);
  // 全部の枝が、縮めた大きさの中に入る
  for (const box of await page.locator('.mindmap-node').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().toJSON()))) {
    expect(box.bottom).toBeLessThanOrEqual(sizer!.y + sizer!.height + 1);
    expect(box.right).toBeLessThanOrEqual(sizer!.x + sizer!.width + 1);
  }
  await page.getByRole('button', { name: '広げる' }).click();
  await expect(zoom).not.toHaveText(`${fitted}%`);
  const out = page.getByRole('button', { name: '縮める' });
  for (let i = 0; i < 8 && (await out.isEnabled()); i++) await out.click();
  await expect(zoom).toHaveText('25%');
  await expect(page.getByRole('button', { name: '縮める' })).toBeDisabled();
});

test('TS-040 does not offer the branch itself or its descendants as the new parent', async ({ page }) => {
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.getByLabel('名前', { exact: true }).fill('親');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.getByLabel('名前', { exact: true }).fill('子');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.getByRole('button', { name: '中心', exact: true }).click();
  await page.getByRole('button', { name: '子を足す' }).click();
  await page.getByLabel('名前', { exact: true }).fill('別');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await page.getByRole('button', { name: '親', exact: true }).click();
  await expect(page.getByLabel('移動先の親').locator('option')).toHaveText(['中心', '別']);
});

test('TS-041 refreshes the branch fields when the selected branch changes from outside and the fields are untouched', async ({ page }) => {
  const name = page.getByLabel('名前', { exact: true });
  await name.fill('改名');
  await page.getByRole('button', { name: '適用', exact: true }).click();
  await expect(page.getByRole('button', { name: '改名', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '↶ Undo' }).click();
  await expect(page.getByRole('button', { name: '中心', exact: true })).toBeVisible();
  await expect(name).toHaveValue('中心');
  // 手を入れている入力は、外から変わっても消さない
  await name.fill('入力中');
  await page.getByRole('button', { name: '↷ Redo' }).click();
  await expect(page.getByRole('button', { name: '改名', exact: true })).toBeVisible();
  await expect(name).toHaveValue('入力中');
});
