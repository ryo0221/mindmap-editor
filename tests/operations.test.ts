import { describe, expect, it } from 'vitest';
import { operationDeclarationProblems, operationInputProblems } from '@editor-platform/extension-runtime';
import { branchOperation, fingerprint, operations } from '../src/operations';
import { validateMindmap, type MindmapDocument } from '../src/mindmap-model';
import sample from '../fixtures/mindmap/valid.json';
const doc = () => structuredClone(sample) as MindmapDocument;
describe('branch operations', () => {
  it('declares a bounded schema and applies a sequence without mutation', () => {
    const before = doc(), id = before.rootId, newId = 'n-' + '2'.repeat(32);
    const input = { before: fingerprint(before), steps: [{kind:'add',id:newId,parentId:id,index:0,text:'子'}, {kind:'rename',id:newId,text:'変更'}] };
    expect(operationDeclarationProblems({ version: 'operations@0-draft', declarations: [branchOperation] })).toEqual([]);
    expect(operationInputProblems([branchOperation], branchOperation, input)).toEqual([]);
    expect(operations.checkInput(branchOperation.id,input,before)).toEqual([]);
    const result = operations.command(branchOperation.id,input,before).apply(before);
    expect(result.nodes[newId].text).toBe('変更'); expect(before.nodes[newId]).toBeUndefined(); validateMindmap(result);
    expect(() => operations.command(branchOperation.id,input,before).apply(result)).toThrow();
  });
  it('rejects invalid operations atomically', () => {
    const before = doc(), input = { before: fingerprint(before), steps: [{kind:'delete',id:before.rootId}] };
    expect(operations.checkInput(branchOperation.id,input,before).length).toBeGreaterThan(0);
    expect(() => operations.command(branchOperation.id,input,before)).toThrow();
    expect(before).toEqual(doc());
  });
});

describe('AI の提案の形', () => {
  it('TS-035 足す枝の ID・位置・before を省いた提案や、仮の名前で入れ子にした提案を、新しい ID で末尾に足す', () => {
    const before = doc(), root = before.rootId;
    const input = { before: '0acb264336dd', steps: [
      { kind: 'add', parentId: root, text: '市場の変化' },
      { kind: 'add', id: 'new-1', parentId: root, text: '社会の課題' },
      { kind: 'add', id: 'new-2', parentId: 'new-1', text: 'OP-01 電池の行き先' },
      { kind: 'marks', id: 'new-2', marks: ['idea'] },
      { kind: 'note', id: 'new-2', text: '仮定' },
    ] };
    expect(operations.checkInput(branchOperation.id, input, before)).toEqual([]);
    const result = operations.command(branchOperation.id, input, before).apply(before);
    validateMindmap(result);
    const kids = result.nodes[root].children.slice(-2).map(id => result.nodes[id]);
    expect(kids.map(n => n.text)).toEqual(['市場の変化', '社会の課題']);
    const child = result.nodes[kids[1].children[0]];
    expect(child.id).toMatch(/^n-[0-9a-f]{32}$/);
    expect(child).toMatchObject({ text: 'OP-01 電池の行き先', marks: ['idea'], note: '仮定' });
  });
  it('TS-036 足す枝の親や名前が欠けた提案は、何番目のどの操作かを言って断る', () => {
    const before = doc();
    const errors = operations.checkInput(branchOperation.id, { steps: [{ kind: 'add', parentId: before.rootId, text: 'a' }, { kind: 'add', text: 'b' }] }, before);
    expect(errors).toEqual(['2 番目の操作（add）の項目が不正です。要る項目：parentId・text']);
  });
});
