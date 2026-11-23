import { beforeAll, expect, it, vi } from 'vitest';
import { createArtifact, MemoryStorage, type Artifact } from '@editor-platform/artifact-core';
import { ExtensionRegistry } from '@editor-platform/extension-runtime';
import { installVerifiedExtension, loadVerifiedExtension, verifyExtensionPackage, type LoadedExtension } from '@editor-platform/extension-runtime/package';
import { createLocalHost } from '../dev/host';
import { renameNode, addNode, reorderNode, moveNode, colorNode, markNode, noteNode } from '../src/mindmap-commands';
import { utf8Length, type MindmapDocument } from '../src/mindmap-model';
import sample from '../fixtures/mindmap/valid.json';
import { buildExtension } from '../scripts/build-extension.mjs';
let loaded: LoadedExtension<MindmapDocument>;
let builtEntry: Uint8Array;
beforeAll(async () => {
  const built = await buildExtension({ write: false });
  builtEntry = new Uint8Array(Buffer.from(built.files.find((f: {path:string}) => f.path === 'entry.js')!.base64, 'base64'));
  const verified = await verifyExtensionPackage({ manifest: built.manifest, entry: built.entry, files: built.files.map((f: {path:string; base64:string}) => ({path:f.path, bytes: new Uint8Array(Buffer.from(f.base64,'base64'))})) }, (id, version) => id === built.manifest.id && version === built.manifest.version ? built.packageHash : undefined);
  loaded = await loadVerifiedExtension<MindmapDocument>(verified, { importModule: bytes => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString('base64')}`) });
}, 15000);
function setup() {
  const registration = installVerifiedExtension(new ExtensionRegistry(), loaded);
  const content = structuredClone(sample) as MindmapDocument;
  const host = createLocalHost(registration, createArtifact(registration.manifest.artifactKind, 'Test', content), new MemoryStorage<Artifact<MindmapDocument>>());
  return {host, registration, id: content.rootId};
}
it('previews, applies and reverses a proposal', () => {
  const {host, registration, id} = setup();
  const proposal = host.prepareRename(id, '提案');
  expect(host.editor.content.nodes[id].text).toBe('中心');
  expect(proposal.candidate.nodes[id].text).toBe('提案');
  proposal.commit(); expect(host.editor.content.nodes[id].text).toBe('提案');
  expect(() => proposal.commit()).toThrow();
  host.handle.api.undo(); expect(host.editor.content.nodes[id].text).toBe('中心');
  host.handle.api.redo(); expect(host.editor.content.nodes[id].text).toBe('提案');
  host.close(true); registration.uninstall();
});
it('rejects stale proposals and read-only edits', () => {
  const {host, registration, id} = setup();
  const proposal = host.prepareRename(id, '古い提案');
  host.handle.api.execute(renameNode(id, '新しい内容'));
  expect(() => proposal.commit()).toThrow();
  host.setReadOnly(true); expect(() => host.handle.api.execute(renameNode(id, '拒否'))).toThrow();
  expect(host.editor.content.nodes[id].text).toBe('新しい内容');
  host.close(true); registration.uninstall();
});
it('saves, reopens, and imports valid native and backup content', async () => {
  const {host, registration, id} = setup();
  host.handle.api.execute(renameNode(id, '保存'));
  const native = host.exportDocument();
  const backup = await host.exportNative();
  expect((await host.parseImport(native)).nodes[id].text).toBe('保存');
  expect((await host.parseImport(backup)).nodes[id].text).toBe('保存');
  await expect(host.parseImport('{"cards":[]}')).rejects.toThrow();
  await host.save(); const reopened = await host.reopenSaved();
  expect(reopened.editor.content.nodes[id].text).toBe('保存');
  reopened.close(); registration.uninstall();
});

it('TS-024 rejects a prepared proposal after permission is revoked without changing content or history', () => {
  const {host, registration, id} = setup();
  const proposal = host.prepareRename(id, '提案');
  const before = structuredClone(host.editor.content), snapshot = host.editor.snapshot;
  host.setReadOnly(true);
  expect(() => proposal.commit()).toThrow();
  expect(host.editor.content).toEqual(before);
  expect(host.editor.snapshot.canUndo).toBe(snapshot.canUndo);
  expect(host.editor.snapshot.canRedo).toBe(snapshot.canRedo);
  host.close(true); registration.uninstall();
});

it('TS-025 retains a failed save and persists it on retry', async () => {
  const {host, registration, id} = setup();
  host.handle.api.execute(renameNode(id, '保存する変更'));
  host.setSaveFailure(true);
  await expect(host.save()).rejects.toThrow();
  expect(host.editor.snapshot.dirty).toBe(true);
  expect(host.editor.content.nodes[id].text).toBe('保存する変更');
  host.setSaveFailure(false); await host.save();
  const reopened = await host.reopenSaved();
  expect(reopened.editor.content.nodes[id].text).toBe('保存する変更');
  reopened.close(); registration.uninstall();
});

it('TS-026 reverses and reapplies reorder and subtree moves and saves them', async () => {
  const {host, registration, id} = setup();
  const a = 'n-00000000000000000000000000000002', b = 'n-00000000000000000000000000000003';
  host.handle.api.execute(addNode(id, 0, a, 'a'));
  host.handle.api.execute(addNode(id, 1, b, 'b'));
  const initial = structuredClone(host.editor.content);
  host.handle.api.execute(reorderNode(b, 0)); const reordered = structuredClone(host.editor.content);
  host.handle.api.execute(moveNode(a, b, 0)); const moved = structuredClone(host.editor.content);
  host.handle.api.undo(); expect(host.editor.content).toEqual(reordered);
  host.handle.api.undo(); expect(host.editor.content).toEqual(initial);
  host.handle.api.redo(); expect(host.editor.content).toEqual(reordered);
  host.handle.api.redo(); expect(host.editor.content).toEqual(moved);
  await host.save(); const reopened = await host.reopenSaved();
  expect(reopened.editor.content).toEqual(moved);
  reopened.close(); registration.uninstall();
});

it('TS-028 reverses and reapplies color marks and note and saves them', async () => {
  const {host, registration, id} = setup();
  const states = [structuredClone(host.editor.content)];
  for (const cmd of [colorNode(id, '#abc'), markNode(id, ['idea']), noteNode(id, 'メモ')]) {
    host.handle.api.execute(cmd); states.push(structuredClone(host.editor.content));
  }
  for (let i = 2; i >= 0; i--) { host.handle.api.undo(); expect(host.editor.content).toEqual(states[i]); }
  for (let i = 1; i <= 3; i++) { host.handle.api.redo(); expect(host.editor.content).toEqual(states[i]); }
  await host.save(); const reopened = await host.reopenSaved();
  expect(reopened.editor.content).toEqual(states[3]);
  reopened.close(); registration.uninstall();
});

it('TS-037 makes the first map from the built package: only a centre branch, new IDs each time, opened and saved like any map', async () => {
  const registration = installVerifiedExtension(new ExtensionRegistry(), loaded);
  expect(registration.manifest.addons?.create).toEqual({ version: 'create@0-draft' });
  expect(registration.manifest.addons?.items).toEqual({ version: 'items@0-draft', collections: [{ at: 'nodes', id: { field: 'text', from: 'leading-token' }, refs: ['link.id'], layout: ['side', 'collapsed', 'color'] }] });
  const first = registration.create!(), second = registration.create!();
  expect(Object.keys(first.nodes)).toEqual([first.rootId]);
  expect(first.nodes[first.rootId]).toEqual({ id: first.rootId, text: '中心のテーマ', children: [] });
  expect(first.layout).toBe('radial');
  expect(second.id).not.toBe(first.id);
  expect(second.rootId).not.toBe(first.rootId);
  const storage = new MemoryStorage<Artifact<MindmapDocument>>();
  const host = createLocalHost(registration, createArtifact(registration.manifest.artifactKind, 'New', structuredClone(first) as MindmapDocument), storage);
  host.handle.api.execute(addNode(first.rootId, 0, 'n-' + 'a'.repeat(32), '最初の枝'));
  await host.save();
  const reopened = await host.reopenSaved();
  expect(Object.keys(reopened.editor.content.nodes)).toHaveLength(2);
  expect(reopened.editor.content.nodes[first.rootId].children).toEqual(['n-' + 'a'.repeat(32)]);
});

it('TS-038 loads the built entry and validates without DOM, Intl, TextEncoder or crypto, counting the size limit in UTF-8 bytes like TextEncoder', async () => {
  for (const text of ['abc', 'é', '中心', '👍🏽', '\ud800', 'a\udc00b']) expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length);
  for (const name of ['Intl', 'TextEncoder', 'TextDecoder', 'crypto', 'document', 'window']) vi.stubGlobal(name, undefined);
  try {
    // 末尾の注釈で別の module として読み込む（先に読み込んだ entry を使い回さない）
    const source = Buffer.concat([Buffer.from(builtEntry), Buffer.from('\n// sandbox\n')]).toString('base64');
    const mod = await import(/* @vite-ignore */ `data:text/javascript;base64,${source}`);
    const definition = mod.definition('sha256:test');
    expect(definition.validate(structuredClone(sample))).toBe(true);
    expect(definition.validate({ ...structuredClone(sample), rootId: 'x' })).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
