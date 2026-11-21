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
