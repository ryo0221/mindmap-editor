import { command, type EditorCommand } from '@editor-platform/editor-core';
import { validateMindmap, type Layout, type Mark, type MindmapDocument, type MindmapNode } from './mindmap-model';

type Change = (doc: MindmapDocument) => void;
function edit(id: string, title: string, change: Change): EditorCommand<MindmapDocument> {
  return { ...command<MindmapDocument>(id, title, current => {
    validateMindmap(current);
    const next = structuredClone(current);
    change(next);
    validateMindmap(next);
    if (JSON.stringify(next) === JSON.stringify(current)) throw new Error('変更がありません。');
    return next;
  }), readonlyInput: true };
}
function node(doc: MindmapDocument, id: string): MindmapNode {
  if (!Object.hasOwn(doc.nodes, id)) throw new Error('枝が見つかりません。');
  return doc.nodes[id];
}
function parent(doc: MindmapDocument, id: string): MindmapNode {
  node(doc, id);
  if (id === doc.rootId) throw new Error('根には親がありません。');
  const result = Object.values(doc.nodes).find(n => n.children.includes(id));
  if (!result) throw new Error('親が見つかりません。');
  return result;
}
function position(index: number, max: number): void {
  if (!Number.isInteger(index) || index < 0 || index > max) throw new Error('位置が不正です。');
}
export function addNode(parentId: string, index: number, newId: string, text: string, side?: 'left' | 'right'): EditorCommand<MindmapDocument> {
  return edit('mindmap.add', '枝を足す', doc => {
    const p = node(doc, parentId); position(index, p.children.length);
    if (Object.hasOwn(doc.nodes, newId)) throw new Error('IDは既に使われています。');
    if (side !== undefined && parentId !== doc.rootId) throw new Error('左右は根の直接の子だけに指定できます。');
    doc.nodes[newId] = { id: newId, text, children: [], ...(side === undefined ? {} : { side }) };
    p.children.splice(index, 0, newId);
  });
}
export function renameNode(id: string, text: string): EditorCommand<MindmapDocument> {
  return edit('mindmap.rename', '名前を変える', doc => { node(doc, id).text = text; });
}
export function reorderNode(id: string, index: number): EditorCommand<MindmapDocument> {
  return edit('mindmap.reorder', '枝を並べ替える', doc => {
    const siblings = parent(doc, id).children; position(index, siblings.length - 1);
    siblings.splice(siblings.indexOf(id), 1); siblings.splice(index, 0, id);
  });
}
export function moveNode(id: string, parentId: string, index: number, side?: 'left' | 'right'): EditorCommand<MindmapDocument> {
  return edit('mindmap.move', '枝を移す', doc => {
    const old = parent(doc, id), target = node(doc, parentId), moving = node(doc, id);
    const descendants = new Set<string>();
    function collect(key: string): void { descendants.add(key); for (const child of node(doc, key).children) collect(child); }
    collect(id); if (descendants.has(parentId)) throw new Error('自分や子孫へ移せません。');
    old.children.splice(old.children.indexOf(id), 1); position(index, target.children.length);
    if (parentId === doc.rootId) {
      if (side !== 'left' && side !== 'right') throw new Error('左右を指定してください。');
      moving.side = side;
    } else { if (side !== undefined) throw new Error('左右を指定できません。'); delete moving.side; }
    target.children.splice(index, 0, id);
  });
}
export function deleteNode(id: string): EditorCommand<MindmapDocument> {
  return edit('mindmap.delete', '枝を消す', doc => {
    const p = parent(doc, id); p.children.splice(p.children.indexOf(id), 1);
    function remove(key: string): void { for (const child of node(doc, key).children) remove(child); delete doc.nodes[key]; }
    remove(id);
  });
}
export function collapseNode(id: string, collapsed: boolean): EditorCommand<MindmapDocument> {
  return edit('mindmap.collapse', '枝を畳む・開く', doc => {
    const n = node(doc, id); if (typeof collapsed !== 'boolean' || (collapsed && !n.children.length)) throw new Error('折りたたみを変更できません。');
    if ((n.collapsed ?? false) === collapsed) throw new Error('変更がありません。');
    n.collapsed = collapsed;
  });
}
export function colorNode(id: string, color?: string): EditorCommand<MindmapDocument> {
  return edit('mindmap.color', '色を変える', doc => { const n = node(doc, id); if (color === undefined) delete n.color; else n.color = color; });
}
export function markNode(id: string, marks?: Mark[]): EditorCommand<MindmapDocument> {
  const copy = marks === undefined ? undefined : [...marks];
  return edit('mindmap.marks', '印を変える', doc => { const n = node(doc, id); if (copy === undefined) delete n.marks; else n.marks = [...copy]; });
}
export function noteNode(id: string, note?: string): EditorCommand<MindmapDocument> {
  return edit('mindmap.note', 'メモを変える', doc => { const n = node(doc, id); if (note === undefined) delete n.note; else n.note = note; });
}
export function setLayout(layout: Layout): EditorCommand<MindmapDocument> {
  return edit('mindmap.layout', '配置を切り替える', doc => { doc.layout = layout; });
}
