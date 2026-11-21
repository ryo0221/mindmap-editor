import type { ScopedHost } from '@editor-platform/extension-contract';
import type { EditorCommand } from '@editor-platform/editor-core';
import { addNode, renameNode, deleteNode, reorderNode, moveNode, colorNode, markNode, noteNode, setLayout } from './mindmap-commands';
import type { Layout, Mark, MindmapDocument } from './mindmap-model';
import styles from './styles.css?inline';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e;
}
function randomId(): string { return 'n-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
/** 色見本（見せる名前と保存する色）。先頭は色なし。 */
export const PALETTE: readonly (readonly [string, string])[] = [['色なし',''],['赤','#d64545'],['橙','#e8862a'],['黄','#d9b310'],['緑','#3a9d5d'],['水色','#2fa4c9'],['青','#3d6fc4'],['紫','#8a5cc2'],['桃','#d9669b'],['灰','#7a8594']];
/** 印（保存する値と見せる名前）。1つの枝に付けられるのは最大4つ。 */
export const MARKS: readonly (readonly [Mark, string])[] = [['question','疑問'],['idea','アイデア'],['decision','決定'],['risk','リスク'],['todo','やること'],['done','済み'],['star','重要']];
const MAX_MARKS = 4;
const markName = (m: string) => MARKS.find(([v]) => v === m)?.[1] ?? m;
/** 枝の名前の下に出す印。読み上げでは枝の説明（title）として読む */
function addBadges(item: HTMLElement, marks: readonly string[]) { if (!marks.length) return; const badges = el('span'); badges.className = 'mindmap-badges'; for (const m of marks) { const b = el('span', markName(m)); b.className = `mindmap-badge mindmap-badge-${m}`; badges.append(b); } badges.setAttribute('aria-hidden','true'); item.append(badges); item.title = `印: ${marks.map(markName).join('、')}`; }
const issuedByDocument = new Map<string, Set<string>>();
export function mountEditor(container: HTMLElement, host: ScopedHost<MindmapDocument>): () => void {
  const root = el('section'); root.className = 'mindmap-editor'; root.setAttribute('aria-label', 'マインドマップ');
  const style = el('style', styles), toolbar = el('fieldset'), status = el('p'), main = el('div'), map = el('div'), panel = el('form'), panelFields = el('fieldset');
  toolbar.className = 'mindmap-toolbar'; main.className = 'mindmap-main'; map.className = 'mindmap-map'; panel.className = 'mindmap-panel'; status.setAttribute('role','status');
  root.append(style, toolbar, status, main); main.append(map, panel); container.append(root);
  let selected = host.read().rootId, readonly = false, layout: Layout = host.read().layout, last = '', snapshot = '', composing = false;
  const initial = host.read();
  const issued = issuedByDocument.get(initial.id) ?? new Set<string>();
  issuedByDocument.set(initial.id, issued);
  const folded = new Map<string, boolean>();
  const button = (label: string, action: () => void) => { const b = el('button', label); b.type = 'button'; b.onclick = action; return b; };
  function perform(cmd: EditorCommand<MindmapDocument>): boolean {
    try { cmd.apply(host.read()); } catch (e) { status.textContent = e instanceof Error ? e.message : '操作できません。'; return false; }
    try { host.execute(cmd); status.textContent = ''; draw(); return true; }
    catch { readonly = true; status.textContent = '読み取り専用です'; draw(); return false; }
  }
  function add(child: boolean) { if (readonly) return; if (dirty()) { status.textContent = '未確定の入力を適用または取り消してください。'; return; } const d = host.read(), n = d.nodes[selected]; if (!n) return; const p = child ? n : Object.values(d.nodes).find(x => x.children.includes(selected)); if (!p) { status.textContent = '根に兄弟は追加できません。'; return; } Object.keys(d.nodes).forEach(id => issued.add(id)); let id = ''; for (let i = 0; i < 32; i++) { const candidate = randomId(); if (!issued.has(candidate)) { id = candidate; break; } } if (!id) { status.textContent = '新しい枝のIDを発行できませんでした。'; return; } issued.add(id); if (perform(addNode(p.id, child ? p.children.length : p.children.indexOf(selected) + 1, id, ''))) { folded.set(p.id, false); selected = id; draw(true); name.focus(); } }
  function remove() { if (!readonly && selected !== host.read().rootId && confirm('子孫を含む枝を削除しますか？')) { const d = host.read(), p = Object.values(d.nodes).find(n => n.children.includes(selected)); if (perform(deleteNode(selected)) && p) { selected = p.id; draw(true); } } }
  function history(redo: boolean) { if (readonly) return; try { redo ? host.redo() : host.undo(); draw(true); } catch (e) { status.textContent = e instanceof Error ? e.message : '操作できません。'; if (/permission|read.only|権限|読み取り専用/i.test(status.textContent)) { readonly = true; status.textContent = '読み取り専用です'; draw(); } } }
  const sibling = button('枝を足す', () => add(false)), child = button('子を足す', () => add(true)), del = button('消す', remove), undo = button('Undo', () => history(false)), redo = button('Redo', () => history(true));
  const layoutSelect = el('select'); layoutSelect.setAttribute('aria-label','配置');
  for (const [value, label] of [['radial','左右'],['right','右向き'],['tree','下向き']]) { const o = el('option',label); o.value = value; layoutSelect.append(o); }
  layoutSelect.onchange = () => { if (layoutSelect.value !== host.read().layout) perform(setLayout(layoutSelect.value as Layout)); else draw(); };
  toolbar.append(sibling, child, del, undo, redo, layoutSelect);
  const heading = el('h2','枝の情報'), name = el('input'), color = el('input'), marks = el('input'), note = el('textarea');
  name.setAttribute('aria-label','名前'); color.type = 'hidden'; marks.type = 'hidden'; note.setAttribute('aria-label','メモ');
  // 色は色見本から選ぶ（色コードは見せない）。見本に無い色が付いた枝は「いまの色」として残し、選び直すまで変えない
  const palette = el('fieldset'); palette.className = 'mindmap-palette'; palette.setAttribute('role','radiogroup'); palette.setAttribute('aria-label','色');
  const paletteTitle = el('legend','色'), other = el('button','いまの色'); other.type = 'button'; other.className = 'mindmap-swatch mindmap-swatch-other'; other.hidden = true;
  const swatches = PALETTE.map(([label, value]) => { const b = el('button'); b.type = 'button'; b.className = 'mindmap-swatch'; b.title = label; b.setAttribute('aria-label',label); b.setAttribute('role','radio'); if (value) b.style.setProperty('--swatch', value); else b.classList.add('mindmap-swatch-none'); b.onclick = () => { color.value = value; showColor(); }; return { b, value }; });
  other.setAttribute('role','radio'); other.setAttribute('aria-label','いまの色');
  palette.append(paletteTitle, ...swatches.map(s => s.b), other);
  function showColor() { const known = swatches.some(s => s.value === color.value); other.hidden = known; if (!known) other.style.setProperty('--swatch', color.value); for (const s of swatches) s.b.setAttribute('aria-checked', String(s.value === color.value)); other.setAttribute('aria-checked', String(!known)); }
  // 印は名前付きのチェックボックスで選ぶ。4つ選ぶと残りは選べなくなる。見本に無い値は残す
  const markSet = el('fieldset'); markSet.className = 'mindmap-marks'; markSet.append(el('legend','印'));
  const markBoxes = MARKS.map(([value, title]) => { const c = el('input'); c.type = 'checkbox'; c.value = value; const l = el('label'); l.append(c, document.createTextNode(title)); markSet.append(l); c.onchange = () => { const current = marks.value ? marks.value.split(', ') : []; const unknown = current.filter(m => !MARKS.some(([v]) => v === m)); marks.value = [...markBoxes.filter(b => b.checked).map(b => b.value), ...unknown].join(', '); showMarks(); }; return c; });
  function showMarks() { const current = marks.value ? marks.value.split(', ') : []; for (const b of markBoxes) { b.checked = current.includes(b.value); b.disabled = readonly || !host.read().nodes[selected] || (!b.checked && current.length >= MAX_MARKS); } }
  const label = (title: string, input: HTMLElement) => { const l = el('label',title); l.append(input); return l; };
  const apply = el('button','適用'); apply.type = 'submit'; const cancel = button('取消', () => draw(true));
  const branchActions = el('div'); branchActions.className = 'mindmap-branch-actions';
  panelFields.className = 'mindmap-panel-fields'; panel.append(panelFields);
  panelFields.append(heading,label('名前',name),palette,color,markSet,marks,label('メモ',note),apply,cancel,branchActions);
  function dirty() { if (!snapshot) return false; const n = JSON.parse(snapshot); return name.value !== n.text || color.value !== (n.color ?? '') || marks.value !== (n.marks ?? []).join(', ') || note.value !== (n.note ?? ''); }
  const guard = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', guard);
  panel.addEventListener('compositionstart', () => { composing = true; }); panel.addEventListener('compositionend', () => { composing = false; });
  panel.onsubmit = e => { e.preventDefault(); if (readonly || composing) return; const d = host.read(), n = d.nodes[selected]; if (!n || JSON.stringify(n) !== snapshot) { status.textContent = '編集中にこの枝が変更または削除されました。入力を保持しています。'; return; }
    const commands: EditorCommand<MindmapDocument>[] = [];
    if (name.value !== n.text) commands.push(renameNode(selected,name.value));
    if (color.value !== (n.color ?? '')) commands.push(colorNode(selected,color.value || undefined));
    const newMarks = marks.value ? marks.value.split(', ') as Mark[] : undefined;
    if (JSON.stringify(newMarks ?? []) !== JSON.stringify(n.marks ?? [])) commands.push(markNode(selected,newMarks));
    if (note.value !== (n.note ?? '')) commands.push(noteNode(selected,note.value || undefined));
    if (!commands.length) { status.textContent = '変更がありません。'; return; }
    const before = snapshot, id = selected;
    if (perform({ type: 'mindmap.fields', label: '枝の情報を編集', readonlyInput: true, apply(current) { if (!current.nodes[id] || JSON.stringify(current.nodes[id]) !== before) throw new Error('編集中にこの枝が変更されました。'); return commands.reduce((doc, cmd) => cmd.apply(doc),current); } })) draw(true);
  };
  function draw(reset = false) {
    const d = host.read(); Object.keys(d.nodes).forEach(id => issued.add(id)); layout = d.layout; last = JSON.stringify(d); if (!d.nodes[selected] && (reset || !snapshot || !dirty())) { selected = d.rootId; snapshot = ''; }
    const n = d.nodes[selected]; sibling.disabled = readonly || selected === d.rootId; child.disabled = readonly || !n; del.disabled = readonly || selected === d.rootId || !n; undo.disabled = redo.disabled = readonly;
    for (const control of [name,color,marks,note,apply,cancel,...swatches.map(s => s.b),other]) control.disabled = readonly || !n;
    layoutSelect.value = layout;
    if (n && (reset || !snapshot)) { snapshot = JSON.stringify(n); name.value = n.text; color.value = n.color ?? ''; showColor(); marks.value = (n.marks ?? []).join(', '); note.value = n.note ?? ''; }
    showMarks();
    map.replaceChildren(); const canvas = el('div'); canvas.className = 'mindmap-canvas'; map.append(canvas);
    const visible: { id: string; depth: number; side: number; order: number; parent?: string }[] = [];
    function visit(id: string, depth: number, side: number, parent?: string) { const x = d.nodes[id]; const order = visible.length; visible.push({id,depth,side,order,parent}); if (!(folded.get(id) ?? x.collapsed ?? false)) x.children.forEach((c,i) => visit(c,depth+1, depth === 0 && layout === 'radial' ? (d.nodes[c].side === 'left' || (!d.nodes[c].side && i % 2) ? -1 : 1) : side,id)); }
    visit(d.rootId,0,1); const positions = new Map<string,{x:number;y:number}>();
    // 印や長い名前で枝が高くなると次の枝と重なるので、描いた高さを測って縦の間を空ける
    const heights = new Map<string, number>(); for (const v of visible) { const probe = el('button', d.nodes[v.id].text || '（無題）'); probe.className = 'mindmap-node'; probe.style.visibility = 'hidden'; addBadges(probe, d.nodes[v.id].marks ?? []); canvas.append(probe); heights.set(v.id, probe.offsetHeight); probe.remove(); }
    const rowTop: number[] = []; if (layout === 'tree') { const tallest: number[] = []; for (const v of visible) tallest[v.depth] = Math.max(tallest[v.depth] ?? 0, heights.get(v.id)!); let y = 0; for (let k = 0; k < tallest.length; k++) { rowTop[k] = y; y += Math.max(90, (tallest[k] ?? 0) + 54); } }
    let nextY = 0; visible.forEach((v,i) => { const x = layout === 'tree' ? i * 200 : v.side * v.depth * 190; const y = layout === 'tree' ? rowTop[v.depth] : nextY; nextY += Math.max(65, heights.get(v.id)! + 29); positions.set(v.id,{x,y}); });
    const points = [...positions.values()]; const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
    for (const pos of points) { pos.x += 20 - minX; pos.y += 20; }
    const width = Math.max(map.clientWidth - 22, maxX - minX + 220), height = Math.max(300, maxY + 100, ...visible.map(v => positions.get(v.id)!.y + heights.get(v.id)! + 40)); canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('width',String(width)); svg.setAttribute('height',String(height)); svg.classList.add('mindmap-lines'); canvas.append(svg);
    for (const [i, v] of visible.entries()) { const pos = positions.get(v.id)!; if (v.parent) { const p = positions.get(v.parent)!; const line = document.createElementNS(svg.namespaceURI,'line'); line.setAttribute('x1',String(p.x+60)); line.setAttribute('y1',String(p.y+18)); line.setAttribute('x2',String(pos.x+60)); line.setAttribute('y2',String(pos.y+18)); line.setAttribute('stroke','#a6b2c2'); svg.append(line); }
      const item = button(d.nodes[v.id].text || '（無題）', () => { if (selected !== v.id) { if (dirty()) { status.textContent = '未確定の入力を適用または取り消してください。'; return; } selected = v.id; snapshot = ''; draw(true); } }); addBadges(item, d.nodes[v.id].marks ?? []); item.className = 'mindmap-node'; item.style.left = `${pos.x}px`; item.style.top = `${pos.y}px`; if (d.nodes[v.id].color) item.style.borderColor = d.nodes[v.id].color!; item.setAttribute('aria-pressed',String(v.id === selected)); item.dataset.nodeId = v.id;
      item.onkeydown = e => { if (e.isComposing || composing || e.keyCode === 229) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); history(e.shiftKey); return; } if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); add(true); } else if (e.key === 'Enter') { e.preventDefault(); add(false); } else if (e.key === 'F2') { e.preventDefault(); name.focus(); } else if (e.key === 'Delete') { e.preventDefault(); remove(); } else if (e.key === ' ') { e.preventDefault(); toggle(v.id); } else if (e.key.startsWith('Arrow')) { e.preventDefault(); const next = visible[Math.max(0,Math.min(visible.length-1,i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1)))]; selected = next.id; snapshot = ''; draw(true); map.querySelector<HTMLButtonElement>(`[data-node-id="${next.id}"]`)?.focus(); } }; canvas.append(item);
    }
    if (n?.children.length) { const fold = button((folded.get(selected) ?? n.collapsed) ? '開く' : '畳む', () => toggle(selected)); map.append(fold); }
    branchActions.replaceChildren();
    if (n && selected !== d.rootId) { const p = Object.values(d.nodes).find(x => x.children.includes(selected))!; const i = p.children.indexOf(selected); const up = button('前へ', () => perform(reorderNode(selected,i-1))); const down = button('後ろへ', () => perform(reorderNode(selected,i+1))); up.disabled = readonly || i === 0; down.disabled = readonly || i === p.children.length-1; branchActions.append(el('h3','枝の移動'), el('p','兄弟の中で並べ替え'),up,down);
      const target = el('select'); target.setAttribute('aria-label','移動先の親'); for (const other of Object.values(d.nodes)) { const o = el('option',other.text || '（無題）'); o.value = other.id; target.append(o); } const index = el('input'); index.type = 'number'; index.min = '0'; index.value = '0'; index.setAttribute('aria-label','挿入位置'); const side = el('select'); side.setAttribute('aria-label','左右'); for (const v of ['right','left']) { const o = el('option',v); o.value=v; side.append(o); } const move = button('移す', () => perform(moveNode(selected,target.value,Number(index.value),target.value === d.rootId ? side.value as 'left'|'right' : undefined))); target.disabled = index.disabled = side.disabled = move.disabled = readonly; branchActions.append(label('移動先の親',target),label('挿入位置',index),label('中心からの方向',side),move);
    }
    if (reset && positions.has(selected)) { const pos = positions.get(selected)!; map.scrollLeft = selected === d.rootId && layout === 'radial' ? 0 : Math.max(0, pos.x + 90 - map.clientWidth / 2); map.scrollTop = Math.max(0, pos.y + 20 - map.clientHeight / 2); }
  }
  function toggle(id: string) { const n = host.read().nodes[id]; if (n?.children.length) { folded.set(id, !(folded.get(id) ?? n.collapsed ?? false)); draw(); } }
  draw(true); const timer = window.setInterval(() => { try { if (JSON.stringify(host.read()) !== last) draw(); } catch (e) { status.textContent = e instanceof Error ? e.message : '読み込めません。'; } },200);
  return () => { window.clearInterval(timer); window.removeEventListener('beforeunload', guard); root.remove(); };
}
