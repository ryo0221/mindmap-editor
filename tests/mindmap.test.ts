import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateMindmap } from '../src/mindmap-model';
import { addNode, deleteNode, moveNode, renameNode } from '../src/mindmap-commands';
import { fingerprint, operations } from '../src/operations';
const read = (name: string) => JSON.parse(readFileSync(`fixtures/mindmap/${name}`, 'utf8'));
describe('mindmap fixtures', () => {
  for (const name of ['valid.json', 'valid-rich.json']) it(`accepts ${name}`, () => expect(() => validateMindmap(read(name))).not.toThrow());
  for (const {file, reason} of read('cases.json') as {file:string;reason:string}[]) it(`rejects ${file}`, () => expect(() => validateMindmap(read(file))).toThrow(reason));
});

it('rejects root deletion, descendant moves and overlong text without changing input', () => {
  const doc = read('valid-rich.json'), original = structuredClone(doc);
  const root = doc.rootId, child = doc.nodes[root].children[0], grandchild = 'n-' + '3'.repeat(32);
  const tree = addNode(child, 0, grandchild, '孫').apply(doc);
  expect(() => deleteNode(root).apply(doc)).toThrow();
  expect(() => moveNode(child, grandchild, 0).apply(tree)).toThrow();
  expect(() => renameNode(child, 'あ'.repeat(201)).apply(doc)).toThrow();
  expect(doc).toEqual(original);
});

it('rejects a proposal when its base has changed', () => {
  const doc = read('valid-rich.json');
  const input = { before: fingerprint(doc), steps: [{ kind: 'rename', id: doc.rootId, text: '提案' }] };
  const proposal = operations.command('edit-branch', input, doc);
  const changed = renameNode(doc.rootId, '別の編集').apply(doc);
  expect(() => proposal.apply(changed)).toThrow();
  expect(changed.nodes[doc.rootId].text).toBe('別の編集');
});
