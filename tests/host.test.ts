import { beforeAll, expect, it } from 'vitest';
import { createArtifact, MemoryStorage, type Artifact } from '@editor-platform/artifact-core';
import { ExtensionRegistry } from '@editor-platform/extension-runtime';
import { installVerifiedExtension, loadVerifiedExtension, verifyExtensionPackage, type LoadedExtension } from '@editor-platform/extension-runtime/package';
import { createLocalHost } from '../dev/host';
import { renameNode } from '../src/mindmap-commands';
import type { MindmapDocument } from '../src/mindmap-model';
import sample from '../fixtures/mindmap/valid.json';
import { buildExtension } from '../scripts/build-extension.mjs';
let loaded: LoadedExtension<MindmapDocument>;
beforeAll(async () => {
  const built = await buildExtension({ write: false });
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
