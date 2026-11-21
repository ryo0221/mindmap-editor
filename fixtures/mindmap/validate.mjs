import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => {
  if (!object(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k))) fail('フィールドまたは型が不正');
};
const length = s => [...s].length;
// JSONのオブジェクトキーをUnicodeコードポイント順に並べる。
const compare = (a,b) => { const x=[...a].map(c=>c.codePointAt(0)), y=[...b].map(c=>c.codePointAt(0)); for(let i=0;i<Math.min(x.length,y.length);i++) if(x[i]!==y[i]) return x[i]-y[i]; return x.length-y.length; };
const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : object(v) ? `{${Object.keys(v).sort(compare).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
export function validate(doc) {
  keys(doc, ['artifactKind','schemaVersion','id','rootId','layout','nodes']);
  if (doc.artifactKind !== 'mindmap' || doc.schemaVersion !== 1) fail('形式または版が不正');
  if (typeof doc.id !== 'string' || !/^d-[0-9a-f]{32}$/.test(doc.id)) fail('文書IDが不正');
  if (!['radial','right','tree'].includes(doc.layout)) fail('配置が不正');
  if (!object(doc.nodes)) fail('ノードが不正');
  const ids=Object.keys(doc.nodes);
  if (ids.length < 1 || ids.length > 2000) fail('ノード数の上限');
  if (typeof doc.rootId !== 'string' || !Object.hasOwn(doc.nodes,doc.rootId)) fail('根が存在しない');
  const parents=new Map(ids.map(id=>[id,0]));
  for (const id of ids) {
    const n=doc.nodes[id];
    keys(n,['id','text','children'],['side','collapsed','color','marks','note','link']);
    if (!/^n-[0-9a-f]{32}$/.test(id) || n.id !== id) fail('ノードIDが不正');
    if (typeof n.text !== 'string' || length(n.text)>200 || /[\r\n]/.test(n.text)) fail('本文が不正または上限超過');
    if (!Array.isArray(n.children) || n.children.length>200) fail('子の数が不正または上限超過');
    for (const child of n.children) {
      if (typeof child !== 'string' || !parents.has(child)) fail('参照先が存在しない');
      parents.set(child,parents.get(child)+1);
    }
    if ('side' in n && !['left','right'].includes(n.side)) fail('左右が不正');
    if ('collapsed' in n && typeof n.collapsed !== 'boolean') fail('折りたたみが不正');
    if ('color' in n && (typeof n.color !== 'string' || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(n.color))) fail('色が不正');
    if ('marks' in n && (!Array.isArray(n.marks) || n.marks.length>4 || new Set(n.marks).size!==n.marks.length || n.marks.some(m=>!['question','idea','decision','risk','todo','done','star'].includes(m)))) fail('印が不正');
    if ('note' in n && (typeof n.note !== 'string' || length(n.note)>4000)) fail('メモが不正または上限超過');
    if ('link' in n) { keys(n.link,['namespace','id']); for (const s of [n.link.namespace,n.link.id]) if (typeof s !== 'string' || length(s)<1 || length(s)>128) fail('参照が不正'); }
  }
  // 循環を親数より先に判定し、循環の見本に明確な理由を返す。
  const active=new Set(), done=new Set();
  function visit(id, depth) {
    if (active.has(id)) fail('循環を検出');
    if (depth>16) fail('深さの上限');
    if (done.has(id)) return;
    active.add(id); for(const child of doc.nodes[id].children) visit(child,depth+1); active.delete(id); done.add(id);
  }
  visit(doc.rootId,0);
  for(const id of ids) if(!done.has(id)) visit(id,0);
  if (parents.get(doc.rootId)!==0) fail('根に親がある');
  for(const id of ids) if(id!==doc.rootId && parents.get(id)!==1) fail('親は一つ必要');
  const reachable=new Set(); function reach(id) { if(reachable.has(id)) return; reachable.add(id); for(const c of doc.nodes[id].children) reach(c); } reach(doc.rootId);
  if(reachable.size!==ids.length) fail('根から到達できない');
  for(const id of ids) if('side' in doc.nodes[id] && !doc.nodes[doc.rootId].children.includes(id)) fail('左右は根の直接の子のみ');
  if(Buffer.byteLength(canonical(doc),'utf8')>524288) fail('ファイルの大きさの上限');
  return true;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of ['valid.json','valid-rich.json']) { validate(read(name)); console.log(`${name}: 通過`); }
  for (const {file,reason} of read('cases.json')) {
    try { validate(read(file)); throw new Error(`${file}: 拒否されなかった`); }
    catch(e) { if(!e.message.includes(reason)) throw e; console.log(`${file}: 拒否 (${e.message})`); }
  }
}
