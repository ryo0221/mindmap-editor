import type { OperationDeclaration, OperationsAdapter } from '@editor-platform/extension-contract';
import { addNode, renameNode, reorderNode, moveNode, deleteNode, collapseNode, colorNode, markNode, noteNode, setLayout } from './mindmap-commands';
import { validateMindmap, type MindmapDocument, type Layout, type Mark } from './mindmap-model';
import type { EditorCommand } from '@editor-platform/editor-core';

const text = (maxLength: number) => ({ type: 'string' as const, maxLength });
const stepSchema = { type: 'object' as const, properties: {
  kind: { type: 'string' as const, maxLength: 10, enum: ['add','rename','reorder','move','delete','collapse','color','marks','note','layout'] },
  id: text(34), parentId: text(34), index: { type: 'integer' as const, minimum: 0, maximum: 200 },
  text: text(4000), side: { type: 'string' as const, maxLength: 5, enum: ['left','right'] },
  collapsed: { type: 'boolean' as const }, marks: { type: 'array' as const, maxItems: 4, items: { type: 'string' as const, maxLength: 8, enum: ['question','idea','decision','risk','todo','done','star'] } },
}, required: ['kind'], additionalProperties: false as const };
export const branchOperation: OperationDeclaration = {
  id: 'edit-branch', version: '1.0.0', title: '枝の操作',
  inputSchema: { type: 'object', properties: { before: text(32), steps: { type: 'array', items: stepSchema, minItems: 1, maxItems: 100 } }, required: ['before','steps'], additionalProperties: false },
};
export const operationDeclarations: readonly OperationDeclaration[] = [branchOperation];
type Step = { kind: string; id?: string; parentId?: string; index?: number; text?: string; side?: 'left'|'right'; collapsed?: boolean; marks?: Mark[] };
function parse(operation: string, value: unknown): { before: string; steps: Step[] } {
  if (operation !== branchOperation.id || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('操作の入力が不正です。');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== 'before,steps' || typeof v.before !== 'string' || v.before.length > 32 || !Array.isArray(v.steps) || !v.steps.length || v.steps.length > 100) throw new Error('操作の入力が不正です。');
  const specs: Record<string, { required: string[]; optional?: string[] }> = {
    add: { required: ['id','parentId','index','text'], optional: ['side'] }, rename: { required: ['id','text'] }, reorder: { required: ['id','index'] }, move: { required: ['id','parentId','index'], optional: ['side'] }, delete: { required: ['id'] }, collapse: { required: ['id','collapsed'] }, color: { required: ['id'], optional: ['text'] }, marks: { required: ['id'], optional: ['marks'] }, note: { required: ['id'], optional: ['text'] }, layout: { required: ['text'] },
  };
  for (const raw of v.steps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('操作が不正です。');
    const s = raw as Record<string, unknown>, spec = typeof s.kind === 'string' ? specs[s.kind] : undefined;
    if (!spec || spec.required.some(k => !(k in s)) || Object.keys(s).some(k => !['kind', ...spec.required, ...(spec.optional ?? [])].includes(k))) throw new Error('操作の項目が不正です。');
    for (const k of ['id','parentId','text','side']) if (k in s && typeof s[k] !== 'string') throw new Error('文字列が必要です。');
    if ('index' in s && (!Number.isInteger(s.index) || (s.index as number) < 0 || (s.index as number) > 200)) throw new Error('位置が不正です。');
    if ('collapsed' in s && typeof s.collapsed !== 'boolean') throw new Error('折りたたみが不正です。');
    if ('marks' in s && (!Array.isArray(s.marks) || s.marks.length > 4 || s.marks.some(m => typeof m !== 'string'))) throw new Error('印が不正です。');
  }
  return { before: v.before, steps: structuredClone(v.steps) as Step[] };
}
function stepCommand(s: Step): EditorCommand<MindmapDocument> {
  switch (s.kind) {
    case 'add': return addNode(s.parentId!, s.index!, s.id!, s.text!, s.side);
    case 'rename': return renameNode(s.id!, s.text!);
    case 'reorder': return reorderNode(s.id!, s.index!);
    case 'move': return moveNode(s.id!, s.parentId!, s.index!, s.side);
    case 'delete': return deleteNode(s.id!);
    case 'collapse': return collapseNode(s.id!, s.collapsed!);
    case 'color': return colorNode(s.id!, s.text);
    case 'marks': return markNode(s.id!, s.marks);
    case 'note': return noteNode(s.id!, s.text);
    case 'layout': return setLayout(s.text as Layout);
    default: throw new Error('未対応の操作です。');
  }
}
export function fingerprint(content: MindmapDocument): string {
  let a = 14695981039346656037n, b = 7809847782465536322n;
  for (const byte of new TextEncoder().encode(JSON.stringify(content))) {
    a = BigInt.asUintN(64, (a ^ BigInt(byte)) * 1099511628211n);
    b = BigInt.asUintN(64, (b ^ BigInt(byte)) * 1099511628211n);
  }
  return a.toString(16).padStart(16, '0') + b.toString(16).padStart(16, '0');
}
function make(operation: string, value: unknown, content: MindmapDocument): EditorCommand<MindmapDocument> {
  const input = parse(operation, value); validateMindmap(content);
  const commands = input.steps.map(stepCommand);
  const original = JSON.stringify(content);
  const apply = (current: MindmapDocument) => {
    validateMindmap(current);
    if (fingerprint(current) !== input.before || JSON.stringify(current) !== original) throw new Error('基準の文書が変更されています。');
    return commands.reduce((doc, cmd) => cmd.apply(doc), current);
  };
  apply(content);
  return { type: 'mindmap.branch', label: '枝の操作', apply, readonlyInput: true };
}
export const operations: OperationsAdapter<MindmapDocument> = {
  checkInput(operation, value, content) { try { make(operation, value, content); return []; } catch (e) { return [e instanceof Error ? e.message : '入力が不正です。']; } },
  command: make,
};
