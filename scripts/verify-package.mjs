import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));

// This consumer imports actual public SDK exports and knows no template source.
// It is bundled, copied with the package to a fresh directory, then run there.
const consumer = `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createArtifact, MemoryStorage } from '@editor-platform/artifact-core';
import { ArtifactEditor, loadHostArtifact } from '@editor-platform/editor-host';
import { ExtensionRegistry } from '@editor-platform/extension-runtime';
import { artifactEditorHost } from '@editor-platform/extension-runtime/editor-host';
import { verifyExtensionPackage, loadVerifiedExtension, installVerifiedExtension } from '@editor-platform/extension-runtime/package';

const payload = JSON.parse(await readFile('./package.json', 'utf8'));
const pin = JSON.parse(await readFile('./trusted-pin.json', 'utf8'));
assert.equal(payload.format, 'open-editor-template-package-1');
assert.equal(pin.id, payload.manifest.id);
assert.equal(pin.version, payload.manifest.version);
const input = { manifest: payload.manifest, entry: payload.entry,
  files: payload.files.map((f) => ({ path: f.path, bytes: new Uint8Array(Buffer.from(f.base64, 'base64')) })) };
const lookup = (id, version) => id === pin.id && version === pin.version ? pin.packageHash : undefined;
const verified = await verifyExtensionPackage(input, lookup);
assert.equal(verified.manifest.packageHash, pin.packageHash);
await assert.rejects(verifyExtensionPackage(input, () => undefined), /pin/);
await assert.rejects(verifyExtensionPackage(input, () => 'sha256:' + '0'.repeat(64)), /pin/);
const changed = structuredClone(input);
changed.files[0].bytes[0] ^= 1;
await assert.rejects(verifyExtensionPackage(changed, lookup), /pin/);
const loaded = await loadVerifiedExtension(verified, {
  importModule: (bytes) => import('data:text/javascript;base64,' + Buffer.from(bytes).toString('base64')),
});
const registry = new ExtensionRegistry();
const registration = installVerifiedExtension(registry, loaded);
const rootId = 'n-' + '1'.repeat(32);
const content = { artifactKind: 'mindmap', schemaVersion: 1, id: 'd-' + '1'.repeat(32), rootId, layout: 'radial', nodes: { [rootId]: { id: rootId, text: 'First', children: [] } } };
assert.ok(loaded.definition.validate(content));
assert.equal(loaded.definition.validate({ ...content, schemaVersion: 2 }), false);
const storage = new MemoryStorage();
const artifact = createArtifact(registration.manifest.artifactKind, 'Package verification', content);
let editable = true;
const adapter = { kind: registration.manifest.artifactKind, validate: loaded.definition.validate,
  capabilities: { undo: true, nativeJson: true, formats: [], preview: 'none', shared: false } };
const editor = new ArtifactEditor(artifact, adapter, storage, () => editable);
const binding = { schemaVersion: registration.manifest.schemaVersion, allowed: () => true };
const handle = registration.open(artifactEditorHost(editor, binding));
const operation = { id: 'edit-branch', version: '1.0.0' };
let a = 14695981039346656037n, b = 7809847782465536322n;
for (const byte of new TextEncoder().encode(JSON.stringify(content))) { a = BigInt.asUintN(64, (a ^ BigInt(byte)) * 1099511628211n); b = BigInt.asUintN(64, (b ^ BigInt(byte)) * 1099511628211n); }
const proposalInput = { before: a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0'), steps: [{ kind: 'rename', id: rootId, text: 'Reviewed' }] };
const proposal = handle.operations.prepare(operation, proposalInput);
assert.equal(editor.content.nodes[rootId].text, 'First');
assert.equal(proposal.candidate.nodes[rootId].text, 'Reviewed');
proposal.commit();
assert.equal(editor.content.nodes[rootId].text, 'Reviewed');
handle.api.undo();
assert.equal(editor.content.nodes[rootId].text, 'First');
handle.api.redo();
assert.equal(editor.content.nodes[rootId].text, 'Reviewed');
editable = false;
assert.throws(() => handle.api.undo(), /permission/i);
editable = true;
await handle.api.save();
const saved = await storage.get(editor.id);
assert.ok(saved);
const checked = await loadHostArtifact(JSON.stringify(saved), adapter);
const reopened = new ArtifactEditor(checked, adapter, storage);
assert.deepEqual(reopened.content, editor.content);
await assert.rejects(loadHostArtifact(JSON.stringify({ ...saved, schemaVersion: 999 }), adapter));
handle.close();
registration.uninstall();
reopened.close();
editor.close();
console.log('PASS: independent package load, pin/tamper refusal, proposal preview/apply, Undo/Redo, read-only refusal and save/reopen.');
`;

/** Verify one locally built transport against a separately supplied Host-owned pin. */
export async function verifyPackageTransport(payload, trustedPin) {
  const bundled = await build({
    absWorkingDir: root,
    stdin: { contents: consumer, resolveDir: root, sourcefile: 'independent-consumer.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'open-editor-template-consumer-'));
  try {
    await Promise.all([
      writeFile(path.join(directory, 'consumer.mjs'), bundled.outputFiles[0].contents),
      writeFile(path.join(directory, 'package.json'), JSON.stringify(payload)),
      writeFile(path.join(directory, 'trusted-pin.json'), JSON.stringify(trustedPin)),
    ]);
    const result = spawnSync(process.execPath, ['consumer.mjs'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Independent consumer failed: ${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`,
      );
    }
    return result.stdout.trim();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const payload = JSON.parse(
    await readFile(path.join(root, 'dist/extension/package.json'), 'utf8'),
  );
  const pin = JSON.parse(
    await readFile(path.join(root, 'dist/extension/trusted-pin.json'), 'utf8'),
  );
  console.log(await verifyPackageTransport(payload, pin));
}
