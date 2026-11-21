export const MINDMAP_ARTIFACT_KIND = 'mindmap' as const;
export const MINDMAP_SCHEMA_VERSION = 1 as const;
export type Layout = 'radial' | 'right' | 'tree';
export type Mark = 'question' | 'idea' | 'decision' | 'risk' | 'todo' | 'done' | 'star';
export interface MindmapNode {
  id: string;
  text: string;
  children: string[];
  side?: 'left' | 'right';
  collapsed?: boolean;
  color?: string;
  marks?: Mark[];
  note?: string;
  link?: { namespace: string; id: string };
}
export interface MindmapDocument {
  artifactKind: typeof MINDMAP_ARTIFACT_KIND;
  schemaVersion: typeof MINDMAP_SCHEMA_VERSION;
  id: string;
  rootId: string;
  layout: Layout;
  nodes: Record<string, MindmapNode>;
}
const fail = (message: string): never => { throw new Error(message); };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function keys(v: unknown, required: string[], optional: string[] = []): asserts v is Record<string, unknown> {
  if (!object(v) || required.some(k => !Object.hasOwn(v, k)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k))) fail('フィールドまたは型が不正');
}
const length = (s: string) => [...s].length;
function compare(a: string, b: string): number {
  const x = [...a].map(c => c.codePointAt(0)!), y = [...b].map(c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (object(v)) return `{${Object.keys(v).sort(compare).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function validateMindmap(value: unknown): asserts value is MindmapDocument {
  keys(value, ['artifactKind', 'schemaVersion', 'id', 'rootId', 'layout', 'nodes']);
  if (value.artifactKind !== 'mindmap' || value.schemaVersion !== 1) fail('形式または版が不正');
  if (typeof value.id !== 'string' || !/^d-[0-9a-f]{32}$/.test(value.id)) fail('文書IDが不正');
  if (!['radial', 'right', 'tree'].includes(value.layout as string)) fail('配置が不正');
  if (!object(value.nodes)) fail('ノードが不正');
  const nodes = value.nodes as Record<string, unknown>, ids = Object.keys(nodes);
  if (ids.length < 1 || ids.length > 2000) fail('ノード数の上限');
  if (typeof value.rootId !== 'string' || !Object.hasOwn(nodes, value.rootId)) fail('根が存在しない');
  const rootId = value.rootId as string;
  const parents = new Map(ids.map(id => [id, 0]));
  for (const id of ids) {
    const n = nodes[id];
    keys(n, ['id', 'text', 'children'], ['side', 'collapsed', 'color', 'marks', 'note', 'link']);
    if (!/^n-[0-9a-f]{32}$/.test(id) || n.id !== id) fail('ノードIDが不正');
    if (typeof n.text !== 'string' || length(n.text) > 200 || /[\r\n]/.test(n.text)) fail('本文が不正または上限超過');
    if (!Array.isArray(n.children) || n.children.length > 200) fail('子の数が不正または上限超過');
    for (const child of n.children as unknown[]) {
      if (typeof child !== 'string' || !parents.has(child)) fail('参照先が存在しない');
      const childId = child as string;
      parents.set(childId, parents.get(childId)! + 1);
    }
    if ('side' in n && !['left', 'right'].includes(n.side as string)) fail('左右が不正');
    if ('collapsed' in n && typeof n.collapsed !== 'boolean') fail('折りたたみが不正');
    if ('color' in n && (typeof n.color !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(n.color))) fail('色が不正');
    if ('marks' in n && (!Array.isArray(n.marks) || n.marks.length > 4 || new Set(n.marks).size !== n.marks.length || n.marks.some(m => !['question', 'idea', 'decision', 'risk', 'todo', 'done', 'star'].includes(m)))) fail('印が不正');
    if ('note' in n && (typeof n.note !== 'string' || length(n.note) > 4000)) fail('メモが不正または上限超過');
    if ('link' in n) {
      keys(n.link, ['namespace', 'id']);
      for (const s of [n.link.namespace, n.link.id]) if (typeof s !== 'string' || length(s) < 1 || length(s) > 128) fail('参照が不正');
    }
  }
  const typedNodes = nodes as unknown as Record<string, MindmapNode>;
  const active = new Set<string>(), done = new Set<string>();
  function visit(id: string, depth: number): void {
    if (active.has(id)) fail('循環を検出');
    if (depth > 16) fail('深さの上限');
    if (done.has(id)) return;
    active.add(id); for (const child of typedNodes[id].children) visit(child, depth + 1); active.delete(id); done.add(id);
  }
  visit(rootId, 0); for (const id of ids) if (!done.has(id)) visit(id, 0);
  if (parents.get(rootId) !== 0) fail('根に親がある');
  for (const id of ids) if (id !== rootId && parents.get(id) !== 1) fail('親は一つ必要');
  const reachable = new Set<string>();
  function reach(id: string): void { if (reachable.has(id)) return; reachable.add(id); for (const c of typedNodes[id].children) reach(c); }
  reach(rootId);
  if (reachable.size !== ids.length) fail('根から到達できない');
  for (const id of ids) if ('side' in typedNodes[id] && !typedNodes[rootId].children.includes(id)) fail('左右は根の直接の子のみ');
  if (new TextEncoder().encode(canonical(value)).length > 524288) fail('ファイルの大きさの上限');
}
export function isMindmapDocument(value: unknown): value is MindmapDocument {
  try { validateMindmap(value); return true; } catch { return false; }
}
