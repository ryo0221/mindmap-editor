import { expect, it } from 'vitest';
import sample from '../fixtures/mindmap/valid.json';
import { validateMindmap, type MindmapDocument } from '../src/mindmap-model';
import { addNode, reorderNode, moveNode, collapseNode, colorNode, markNode, noteNode, setLayout } from '../src/mindmap-commands';
const doc = () => structuredClone(sample) as MindmapDocument;
const id = (n: number) => 'n-' + n.toString(16).padStart(32, '0');

it('reorders and moves a subtree, preserving children and side rules', () => {
  let d = doc(); const root = d.rootId;
  d = addNode(root, 0, id(2), 'a', 'left').apply(d);
  d = addNode(root, 1, id(3), 'b', 'right').apply(d);
  d = addNode(id(2), 0, id(4), 'child').apply(d);
  const reordered = reorderNode(id(3), 0).apply(d);
  expect(reordered.nodes[root].children).toEqual([id(3), id(2)]);
  const moved = moveNode(id(2), id(3), 0).apply(reordered);
  expect(moved.nodes[id(3)].children).toEqual([id(2)]);
  expect(moved.nodes[id(2)].children).toEqual([id(4)]);
  expect(moved.nodes[id(2)].side).toBeUndefined();
  expect(() => moveNode(id(3), id(4), 0).apply(moved)).toThrow();
  const invalid = structuredClone(moved); invalid.nodes[id(4)].side = 'left';
  expect(() => validateMindmap(invalid)).toThrow();
});

it('changes folding and rejects folding a leaf', () => {
  let d = doc(); d = addNode(d.rootId, 0, id(2), 'a').apply(d);
  const folded = collapseNode(d.rootId, true).apply(d);
  expect(folded.nodes[d.rootId].collapsed).toBe(true);
  expect(collapseNode(d.rootId, false).apply(folded).nodes[d.rootId].collapsed).toBe(false);
  expect(() => collapseNode(id(2), true).apply(d)).toThrow();
});

it('validates color, marks, note and unknown fields', () => {
  const d = doc(), root = d.rootId;
  expect(colorNode(root, '#abc').apply(d).nodes[root].color).toBe('#abc');
  expect(() => colorNode(root, 'red').apply(d)).toThrow();
  expect(markNode(root, ['idea', 'risk', 'todo', 'done']).apply(d).nodes[root].marks).toHaveLength(4);
  expect(() => markNode(root, ['idea', 'risk', 'todo', 'done', 'star']).apply(d)).toThrow();
  expect(() => markNode(root, ['idea', 'idea']).apply(d)).toThrow();
  expect(noteNode(root, '😀'.repeat(4000)).apply(d).nodes[root].note).toBe('😀'.repeat(4000));
  expect(() => noteNode(root, '😀'.repeat(4001)).apply(d)).toThrow();
  const bad = structuredClone(d) as MindmapDocument & { extra?: boolean }; bad.extra = true;
  expect(() => validateMindmap(bad)).toThrow();
});

it('changes layout and rejects unknown layouts', () => {
  const d = doc(); expect(setLayout('tree').apply(d).layout).toBe('tree');
  expect(() => setLayout('invalid' as never).apply(d)).toThrow();
});

it('enforces node count, depth and child count boundaries', () => {
  const d = doc(), root = d.rootId; let previous = root;
  for (let n = 2; n <= 17; n++) { d.nodes[id(n)] = { id:id(n), text:'', children:[] }; d.nodes[previous].children.push(id(n)); previous = id(n); }
  expect(() => validateMindmap(d)).not.toThrow();
  d.nodes[id(18)] = { id:id(18), text:'', children:[] }; d.nodes[previous].children.push(id(18));
  expect(() => validateMindmap(d)).toThrow();
  const wide = doc(); for (let n = 2; n <= 201; n++) { wide.nodes[id(n)] = {id:id(n),text:'',children:[]}; wide.nodes[root].children.push(id(n)); }
  expect(() => validateMindmap(wide)).not.toThrow();
  wide.nodes[id(202)] = {id:id(202),text:'',children:[]}; wide.nodes[root].children.push(id(202));
  expect(() => validateMindmap(wide)).toThrow();
  const many = doc(); for (let n = 2; n <= 2000; n++) { const parent = n <= 201 ? root : id(2 + Math.floor((n - 202) / 200)); many.nodes[id(n)] = {id:id(n),text:'',children:[]}; many.nodes[parent].children.push(id(n)); }
  expect(() => validateMindmap(many)).not.toThrow();
  many.nodes[id(2001)] = {id:id(2001),text:'',children:[]}; many.nodes[id(20)].children.push(id(2001));
  expect(() => validateMindmap(many)).toThrow();
});

it('enforces reference and canonical byte limits', () => {
  const d = doc(), node = d.nodes[d.rootId]; node.link = { namespace:'😀'.repeat(128), id:'x'.repeat(128) };
  expect(() => validateMindmap(d)).not.toThrow(); node.link.id += 'x'; expect(() => validateMindmap(d)).toThrow();
  delete node.link;
  for (let n = 2; n <= 127; n++) { const parent = n <= 201 ? d.rootId : id(2); d.nodes[id(n)] = {id:id(n),text:'',children:[],note:'x'.repeat(4000)}; d.nodes[parent].children.push(id(n)); }
  // ASCII keys and values make JSON.stringify byte length equal to canonical JSON byte length.
  const base = Buffer.byteLength(JSON.stringify(d)); node.note = 'x'.repeat(524288 - base - 10);
  expect(Buffer.byteLength(JSON.stringify(d))).toBe(524288);
  expect(() => validateMindmap(d)).not.toThrow(); node.note += 'x'; expect(() => validateMindmap(d)).toThrow();
});
