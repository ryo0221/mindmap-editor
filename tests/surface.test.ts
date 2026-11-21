// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createArtifact, MemoryStorage, type Artifact } from '@editor-platform/artifact-core';
import { ExtensionRegistry } from '@editor-platform/extension-runtime';
import { mountEditor } from '../src/Editor';
import { definition } from '../src/extension';
import { createLocalHost } from '../dev/host';
import { deleteNode, renameNode } from '../src/mindmap-commands';
import type { MindmapDocument } from '../src/mindmap-model';
import sample from '../fixtures/mindmap/valid.json';
import { webcrypto } from 'node:crypto';
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const content = structuredClone(sample) as MindmapDocument;
  const registration = new ExtensionRegistry().install(definition('sha256:' + '0'.repeat(64)), { trust: 'trusted', verifiedPackageHash: 'sha256:' + '0'.repeat(64) });
  const host = createLocalHost(registration, createArtifact('mindmap', 'Test', content), new MemoryStorage<Artifact<MindmapDocument>>());
  const container = document.createElement('div'); document.body.append(container);
  const unmount = mountEditor(container, host.handle.api);
  cleanups.push(() => { unmount(); host.close(true); registration.uninstall(); });
  return { host, container, id: content.rootId };
}
const button = (container: HTMLElement, text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
it('adds a child and reflects external undo and redo', () => {
  vi.useFakeTimers(); const {host, container, id} = setup();
  button(container, '子を足す').click();
  const child = host.editor.content.nodes[id].children[0]; expect(child).toMatch(/^n-[a-f0-9]{32}$/);
  host.handle.api.undo(); vi.advanceTimersByTime(200); expect(container.querySelector(`[data-node-id="${child}"]`)).toBeNull();
  host.handle.api.redo(); vi.advanceTimersByTime(200); expect(container.querySelector(`[data-node-id="${child}"]`)).not.toBeNull();
});
it('does not reuse an issued ID after deletion when random bytes repeat', () => {
  vi.useFakeTimers(); const {host, container, id} = setup();
  let calls = 0;
  vi.stubGlobal('crypto', { randomUUID: webcrypto.randomUUID.bind(webcrypto), getRandomValues(array: Uint8Array) { array.fill(++calls <= 2 ? 0x42 : 0x43); return array; } });
  button(container, '子を足す').click();
  const first = host.editor.content.nodes[id].children[0];
  host.handle.api.execute(deleteNode(first)); vi.advanceTimersByTime(200);
  button(container, '子を足す').click();
  const second = host.editor.content.nodes[id].children[0];
  expect(first).toBe('n-' + '42'.repeat(16));
  expect(second).toBe('n-' + '43'.repeat(16));
});
it('keeps pending input and refuses conflicting changes', () => {
  vi.useFakeTimers(); const {host, container, id} = setup();
  const name = container.querySelector<HTMLInputElement>('[aria-label="名前"]')!; name.value = '未確定';
  host.handle.api.execute(renameNode(id, '外部変更')); vi.advanceTimersByTime(200);
  expect(name.value).toBe('未確定');
  container.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
  expect(container.textContent).toContain('入力を保持'); expect(host.editor.content.nodes[id].text).toBe('外部変更');
});
it('disables editing after a read-only rejection', () => {
  const {host, container} = setup(); host.setReadOnly(true); button(container, '子を足す').click();
  expect(container.textContent).toContain('読み取り専用です'); expect(button(container, '子を足す').disabled).toBe(true);
});
