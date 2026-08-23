// 화면 흐름. iOS 의 DiagramListView / DiagramDetailView / 각 시트에 해당한다.

import { Graph, emptyGraph, EDGE_KINDS, EDGE_KIND_NAMES } from './topology.js';
import {
  BUILT_INS, CATEGORIES, CATEGORY_NAMES, ALL_ICON_NAMES, DEFAULT_ICON,
  EquipmentEditor, EquipmentMerger,
} from './equipment.js';
import { iconSVG } from './icons.js';
import { NODE_W, NODE_H } from './edge-router.js';
import { freeSpot, autoArrange, UndoStack, canvasPoint, contentBounds } from './layout.js';
import {
  A4_LANDSCAPE, A4_PORTRAIT, preferredPage, drawingRect, pageGrid,
  SCALE_PRESETS, scaleName, parseScale, WARN_PAGE_COUNT,
  SCALE_MIN_PERCENT, SCALE_MAX_PERCENT,
  FileFormatError, FileVersionError,
} from './page.js';
import { Store } from './store.js';
import { DiagramCanvas, escapeHTML } from './canvas.js';
import { renderAllPages } from './preview.js';

const $ = sel => document.querySelector(sel);

const CAT_VAR = {
  measure: ['--cat-measure', '--cat-measure-chip'],
  network: ['--cat-network', '--cat-network-chip'],
  power:   ['--cat-power',   '--cat-power-chip'],
  etc:     ['--cat-etc',     '--cat-etc-chip'],
};

const 상태 = {
  화면: 'list',
  도면ID: null,
  graph: emptyGraph(),
  이력: new UndoStack(),
  배율: null,          // null 이면 한 장 맞춤
  가로지면: true,
};

let canvas = null;

// ═══════════════════════════════════════════ 도면 목록

function 목록그리기() {
  const list = Store.diagrams();
  const wrap = $('#list-body');

  if (list.length === 0) {
    wrap.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/>
          <rect x="13" y="13" width="8" height="8" rx="2"/>
          <path d="M7 11v4a2 2 0 002 2h4" stroke-dasharray="2 2"/></svg>
        <div><strong>도면이 없습니다</strong></div>
        <div style="font-size:13px">새 도면을 만들거나 파일을 불러오세요.</div>
      </div>`;
    return;
  }

  wrap.innerHTML = `<div class="list">${list.map(d => `
    <div class="row" data-open="${d.id}">
      <div class="grow">
        <div class="title">${escapeHTML(d.title)}</div>
        <div class="meta">장비 ${d.graph.nodes.length} · 연결 ${d.graph.edges.length}
          · ${new Date(d.updatedAt).toLocaleString('ko-KR')}</div>
      </div>
      <div class="acts">
        <button class="btn icon-only" data-share="${d.id}" title="내보내기">
          <svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/>
            <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg></button>
        <button class="btn icon-only" data-rename="${d.id}" title="이름">
          <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
        <button class="btn icon-only" data-dup="${d.id}" title="복제">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/>
            <path d="M5 15V5a2 2 0 012-2h10"/></svg></button>
        <button class="btn icon-only danger" data-del="${d.id}" title="삭제">
          <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/>
            <path d="M6 7l1 13h10l1-13"/></svg></button>
      </div>
    </div>`).join('')}</div>`;
}

// ═══════════════════════════════════════════ 캔버스 화면

function 도면열기(id) {
  const d = Store.diagram(id);
  if (!d) return;

  상태.도면ID = id;
  상태.graph = d.graph;
  상태.이력 = new UndoStack();
  $('#canvas-title').textContent = d.title;

  화면전환('canvas');
  canvas.resetFit();
  canvas.setData(상태.graph, Store.types());
  requestAnimationFrame(() => {
    canvas.fitOnce();
    canvas.draw();
  });
  도구막대갱신();
}

/**
 * 바꾸기 직전 상태를 이력에 넣고 새 도면을 저장한다.
 * 모든 변경이 이 함수를 지나가므로 되돌리기가 빠짐없이 걸린다.
 */
function 적용(새도면) {
  상태.이력.record(상태.graph);
  상태.graph = 새도면;
  Store.update(상태.도면ID, { graph: 새도면 });
  canvas.setData(상태.graph, Store.types());
  도구막대갱신();
}

function 되돌리기() {
  const 이전 = 상태.이력.undo(상태.graph);
  if (!이전) return;
  상태.graph = 이전;
  Store.update(상태.도면ID, { graph: 이전 });
  canvas.select(null, null);
  canvas.setData(상태.graph, Store.types());
  도구막대갱신();
}

function 다시하기() {
  const 다음 = 상태.이력.redo(상태.graph);
  if (!다음) return;
  상태.graph = 다음;
  Store.update(상태.도면ID, { graph: 다음 });
  canvas.select(null, null);
  canvas.setData(상태.graph, Store.types());
  도구막대갱신();
}

function 도구막대갱신() {
  $('#btn-undo').disabled = !상태.이력.canUndo;
  $('#btn-redo').disabled = !상태.이력.canRedo;

  const nodeID = canvas?.selectedNodeID ?? null;
  const edgeID = canvas?.selectedEdgeID ?? null;
  const bar = $('#float-bar');

  if (edgeID) {
    const e = Graph.edge(상태.graph, edgeID);
    bar.classList.remove('hidden');
    bar.innerHTML =
      EDGE_KINDS.map(k =>
        `<button class="kind-chip ${e?.kind === k ? 'on' : ''}" data-kind="${k}">
           ${EDGE_KIND_NAMES[k]}</button>`).join('') +
      `<span class="sep"></span>
       <button class="btn icon-only danger" data-edge-del="1">
         <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/>
           <path d="M6 7l1 13h10l1-13"/></svg></button>`;
  } else if (nodeID) {
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <button class="btn" data-node-edit="1">
        <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>편집</button>
      <span class="sep"></span>
      <button class="btn danger" data-node-del="1">
        <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/>
          <path d="M6 7l1 13h10l1-13"/></svg>삭제</button>
      <span class="sep"></span>
      <button class="btn" data-clear-sel="1" style="color:var(--text-normal)">해제</button>`;
  } else {
    bar.classList.add('hidden');
    bar.innerHTML = '';
  }
}

// ═══════════════════════════════════════════ 시트

function 시트열기(html, onMount) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = `<div class="sheet">${html}</div>`;
  back.addEventListener('pointerdown', e => {
    if (e.target === back) 시트닫기();
  });
  document.body.appendChild(back);
  onMount?.(back);
  return back;
}

function 시트닫기() {
  document.querySelectorAll('.backdrop').forEach(el => el.remove());
}

/** 장비를 고르는 시트. */
function 장비고르기시트() {
  const types = Store.visibleTypes();

  const 묶음 = CATEGORIES.map(cat => {
    const list = types.filter(t => t.category === cat);
    if (list.length === 0) return '';
    return `<div class="group-title">${CATEGORY_NAMES[cat]}</div>` +
      list.map(t => 장비행(t, `data-pick="${t.key}"`)).join('');
  }).join('');

  시트열기(`
    <div class="topbar"><h1>장비 추가</h1><span class="spacer"></span>
      <button class="btn" data-close="1">닫기</button></div>
    <div class="scroll">
      <div class="field"><input id="pick-search" placeholder="장비 이름 검색"></div>
      <div id="pick-list">${묶음}</div>
    </div>`, back => {
    back.querySelector('#pick-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      back.querySelectorAll('[data-pick]').forEach(el => {
        const t = types.find(x => x.key === el.dataset.pick);
        el.classList.toggle('hidden',
          q !== '' && !t.name.toLowerCase().includes(q));
      });
      back.querySelectorAll('.group-title').forEach(g => {
        let n = g.nextElementSibling, 보임 = false;
        while (n && n.classList.contains('pick-row')) {
          if (!n.classList.contains('hidden')) 보임 = true;
          n = n.nextElementSibling;
        }
        g.classList.toggle('hidden', !보임);
      });
    });

    back.addEventListener('click', e => {
      const el = e.target.closest('[data-pick]');
      if (!el) return;
      장비놓기(el.dataset.pick);
      시트닫기();
    });
  });
}

function 장비행(t, attrs = '') {
  const [accVar, chipVar] = CAT_VAR[t.category] ?? CAT_VAR.etc;
  return `<button class="pick-row" ${attrs}>
    <span class="chip-box" style="background:var(${chipVar})">
      ${iconSVG(t.iconName, 30)}</span>
    <span class="grow">
      <span class="name">${escapeHTML(t.name)}</span>
      ${t.isHidden ? '<span class="sub">숨김</span>'
        : (!t.isBuiltIn ? '<span class="sub">내가 만든 장비</span>' : '')}
    </span>
    <svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:none;
      stroke:var(${accVar});stroke-width:2;stroke-linecap:round">
      <path d="M12 5v14"/><path d="M5 12h14"/></svg>
  </button>`;
}

/** 화면 한가운데에 놓는다. 이미 뭔가 있으면 비켜 놓는다. */
function 장비놓기(typeKey) {
  const t = Store.typeFor(typeKey);
  if (!t) return;

  const r = $('#canvas-wrap').getBoundingClientRect();
  const 도면좌표 = canvasPoint(canvas.transform, { x: r.width / 2, y: r.height / 2 });
  const 놓을자리 = freeSpot(
    { x: 도면좌표.x - NODE_W / 2, y: 도면좌표.y - NODE_H / 2 }, 상태.graph.nodes);

  const { graph, node } = Graph.addNode(상태.graph,
    { typeKey, label: t.name, x: 놓을자리.x, y: 놓을자리.y });

  적용(graph);
  canvas.select(node.id, null);
}

/** 장비 하나의 이름과 메모를 고친다. */
function 장비정보시트(nodeID) {
  const n = Graph.node(상태.graph, nodeID);
  if (!n) return;
  const t = Store.typeFor(n.typeKey);
  const [, chipVar] = CAT_VAR[t?.category ?? 'etc'];

  시트열기(`
    <div class="topbar">
      <button class="btn" data-close="1">취소</button>
      <span class="spacer"></span><h1>장비 정보</h1><span class="spacer"></span>
      <button class="btn filled" data-save="1">완료</button></div>
    <div class="scroll">
      <div class="pick-row" style="cursor:default">
        <span class="chip-box" style="background:var(${chipVar})">
          ${iconSVG(t?.iconName ?? DEFAULT_ICON, 30)}</span>
        <span class="grow"><span class="name">${escapeHTML(t?.name ?? '알 수 없는 장비')}</span>
          <span class="sub">${CATEGORY_NAMES[t?.category ?? 'etc']}</span></span>
      </div>
      <div class="field" style="margin-top:var(--sp-l)">
        <label>이름</label>
        <input id="node-name" value="${escapeHTML(n.label)}" placeholder="예: 1층 서버">
      </div>
      <div class="field">
        <label>메모</label>
        <textarea id="node-note" placeholder="예: 포트 3번 사용">${escapeHTML(n.note)}</textarea>
      </div>
      <button class="btn danger" data-node-del-sheet="1"
        style="width:100%;justify-content:center;background:var(--danger-bg)">
        이 장비 삭제</button>
    </div>`, back => {
    const input = back.querySelector('#node-name');
    input.focus();
    if (input.value === t?.name) input.select();

    back.querySelector('[data-save]').addEventListener('click', () => {
      const 이름 = input.value.trim();
      적용(Graph.updateNode(상태.graph, nodeID, {
        label: 이름 === '' ? null : 이름,
        note: back.querySelector('#node-note').value,
      }));
      시트닫기();
    });

    back.querySelector('[data-node-del-sheet]').addEventListener('click', () => {
      적용(Graph.removeNode(상태.graph, nodeID));
      canvas.select(null, null);
      시트닫기();
    });
  });
}

/** 장비 종류를 추가·수정·숨김 하는 화면. */
function 장비관리시트() {
  function 다시그리기(back, 숨긴것보기) {
    const types = 숨긴것보기 ? Store.types() : Store.visibleTypes();
    back.querySelector('#mgr-list').innerHTML = CATEGORIES.map(cat => {
      const list = types.filter(t => t.category === cat);
      if (list.length === 0) return '';
      return `<div class="group-title">${CATEGORY_NAMES[cat]}</div>` +
        list.map(t => `
          <div class="pick-row" style="cursor:default">
            <span class="chip-box" style="background:var(${CAT_VAR[t.category][1]});
              opacity:${t.isHidden ? .4 : 1}">${iconSVG(t.iconName, 30)}</span>
            <span class="grow">
              <span class="name" style="color:${t.isHidden
                ? 'var(--text-dim)' : 'var(--text-strong)'}">${escapeHTML(t.name)}</span>
              ${t.isHidden ? '<span class="sub">숨김</span>'
                : (!t.isBuiltIn ? '<span class="sub">내가 만든 장비</span>' : '')}
            </span>
            <button class="btn icon-only" data-edit-type="${t.key}">
              <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>
            <button class="btn icon-only" data-hide-type="${t.key}"
              style="color:var(--text-dim)">
              ${t.isHidden
                ? '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
                : '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6 0 10 7 10 7a17 17 0 01-3 3.6M6.6 6.6A17 17 0 002 12s4 7 10 7a10 10 0 004.2-.9"/></svg>'}
            </button>
            ${t.isBuiltIn ? '' : `
              <button class="btn icon-only danger" data-del-type="${t.key}">
                <svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V5h6v2"/>
                  <path d="M6 7l1 13h10l1-13"/></svg></button>`}
          </div>`).join('');
    }).join('');
  }

  시트열기(`
    <div class="topbar"><h1>장비 관리</h1><span class="spacer"></span>
      <button class="btn" data-new-type="1">
        <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>만들기</button>
      <button class="btn" data-close="1">닫기</button></div>
    <div class="scroll">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;
        color:var(--text-normal);margin-bottom:var(--sp-s)">
        <input type="checkbox" id="show-hidden" style="width:auto"> 숨긴 장비도 보기</label>
      <div id="mgr-list"></div>
    </div>`, back => {
    다시그리기(back, false);

    back.querySelector('#show-hidden').addEventListener('change', e =>
      다시그리기(back, e.target.checked));

    back.addEventListener('click', e => {
      const 숨김 = back.querySelector('#show-hidden').checked;

      const 새로 = e.target.closest('[data-new-type]');
      if (새로) { 장비편집시트(null, () => 다시그리기(back, 숨김)); return; }

      const 편집 = e.target.closest('[data-edit-type]');
      if (편집) {
        장비편집시트(편집.dataset.editType, () => 다시그리기(back, 숨김));
        return;
      }

      const 감추기 = e.target.closest('[data-hide-type]');
      if (감추기) {
        const key = 감추기.dataset.hideType;
        const t = Store.typeFor(key);
        Store.saveTypes(EquipmentEditor.setHidden(Store.types(), key, !t.isHidden));
        다시그리기(back, 숨김);
        canvas?.setData(상태.graph, Store.types());
        return;
      }

      const 지우기 = e.target.closest('[data-del-type]');
      if (지우기) {
        Store.saveTypes(EquipmentEditor.remove(Store.types(), 지우기.dataset.delType));
        다시그리기(back, 숨김);
        canvas?.setData(상태.graph, Store.types());
      }
    });
  });
}

/** 장비 하나를 만들거나 고치는 시트. */
function 장비편집시트(key, onDone) {
  const 원본 = key ? Store.typeFor(key) : null;
  let 고른아이콘 = 원본?.iconName ?? DEFAULT_ICON;

  const back = 시트열기(`
    <div class="topbar">
      <button class="btn" data-close2="1">취소</button>
      <span class="spacer"></span><h1>${원본 ? '장비 수정' : '장비 만들기'}</h1>
      <span class="spacer"></span>
      <button class="btn filled" data-save2="1">완료</button></div>
    <div class="scroll">
      <div class="field"><label>이름</label>
        <input id="type-name" value="${escapeHTML(원본?.name ?? '')}" placeholder="예: NAS"></div>
      <div class="field"><label>분류</label>
        <select id="type-cat">${CATEGORIES.map(c =>
          `<option value="${c}" ${(원본?.category ?? 'etc') === c ? 'selected' : ''}>
            ${CATEGORY_NAMES[c]}</option>`).join('')}</select></div>
      <div class="field"><label>아이콘</label>
        <div class="icon-grid" id="icon-grid">${ALL_ICON_NAMES.map(n =>
          `<button class="icon-pick ${n === 고른아이콘 ? 'on' : ''}" data-icon="${n}">
            ${iconSVG(n, 30)}</button>`).join('')}</div></div>
      ${원본?.isBuiltIn ? `<div class="note-box">기본 장비입니다. 이름과 아이콘은 바꿀 수 있지만
        삭제는 되지 않습니다. 쓰지 않으면 목록에서 숨기세요.</div>` : ''}
    </div>`);

  // 이 시트는 장비 관리 시트 위에 겹치므로 자기 것만 닫는다
  back.addEventListener('click', e => {
    if (e.target.closest('[data-close2]')) { back.remove(); return; }

    const ic = e.target.closest('[data-icon]');
    if (ic) {
      고른아이콘 = ic.dataset.icon;
      back.querySelectorAll('[data-icon]').forEach(el =>
        el.classList.toggle('on', el.dataset.icon === 고른아이콘));
      return;
    }

    if (e.target.closest('[data-save2]')) {
      const name = back.querySelector('#type-name').value;
      const category = back.querySelector('#type-cat').value;
      if (name.trim() === '') return;

      Store.saveTypes(원본
        ? EquipmentEditor.update(Store.types(), 원본.key,
            { name, iconName: 고른아이콘, category })
        : EquipmentEditor.add(Store.types(),
            { name, iconName: 고른아이콘, category }));

      back.remove();
      onDone?.();
      canvas?.setData(상태.graph, Store.types());
    }
  });

  back.querySelector('#type-name').focus();
}

// ═══════════════════════════════════════════ 인쇄 미리보기

function 미리보기열기() {
  const c = contentBounds(상태.graph.nodes);
  const 기본 = preferredPage(c);
  상태.가로지면 = 기본.w > 기본.h;
  상태.배율 = null;

  화면전환('preview');
  $('#preview-title').textContent = Store.diagram(상태.도면ID)?.title ?? '';
  미리보기갱신();
}

function 미리보기갱신() {
  const pageSize = 상태.가로지면 ? A4_LANDSCAPE : A4_PORTRAIT;
  const d = Store.diagram(상태.도면ID);

  const grid = renderAllPages($('#pages'), {
    title: d?.title ?? '',
    graph: 상태.graph,
    types: Store.types(),
    pageSize,
    scale: 상태.배율,
  });

  $('#scale-label').textContent = scaleName(상태.배율);
  $('#preview-stat').textContent =
    `인쇄 배율 ${Math.round(grid.scale * 100)}% · ` +
    (grid.isSinglePage ? '1장' : `${grid.pageCount}장 · ${grid.rows}행 ${grid.columns}열`);

  $('#page-warn').classList.toggle('hidden', grid.pageCount <= WARN_PAGE_COUNT);
  if (grid.pageCount > WARN_PAGE_COUNT) {
    $('#page-warn').textContent = `${grid.pageCount}장이 됩니다. 배율을 낮추는 게 좋습니다.`;
  }

  $('#toggle-landscape').classList.toggle('filled', 상태.가로지면);
  $('#toggle-portrait').classList.toggle('filled', !상태.가로지면);

  맞춤보임비(pageSize);
}

/** 지면 폭이 화면 폭에 맞도록 줄인다. 인쇄할 때는 이 축소가 풀린다. */
function 맞춤보임비(pageSize) {
  const wrap = $('#pages');
  const 여백 = 48;
  const 쓸폭 = Math.max(1, wrap.clientWidth - 여백);
  const 비 = Math.min(1, 쓸폭 / pageSize.w);

  wrap.querySelectorAll('.page').forEach(p => {
    p.style.transform = `scale(${비})`;
    // scale 은 자리를 차지하지 않으므로 아래 여백을 직접 준다
    p.style.marginBottom = `${-(pageSize.h * (1 - 비))}px`;
  });
}

function 배율메뉴() {
  시트열기(`
    <div class="topbar"><h1>인쇄 배율</h1><span class="spacer"></span>
      <button class="btn" data-close="1">닫기</button></div>
    <div class="scroll">
      ${SCALE_PRESETS.map(v => `
        <button class="pick-row" data-scale="${v === null ? 'fit' : v}">
          <span class="grow"><span class="name">${scaleName(v)}</span></span>
          ${상태.배율 === v ? '<span style="color:var(--main);font-weight:700">✓</span>' : ''}
        </button>`).join('')}
      <div class="field" style="margin-top:var(--sp-l)">
        <label>직접 입력 (${SCALE_MIN_PERCENT} ~ ${SCALE_MAX_PERCENT}%)</label>
        <input id="scale-input" inputmode="numeric" placeholder="예: 44">
      </div>
      <button class="btn filled" data-scale-apply="1"
        style="width:100%;justify-content:center">적용</button>
    </div>`, back => {
    back.addEventListener('click', e => {
      const el = e.target.closest('[data-scale]');
      if (el) {
        상태.배율 = el.dataset.scale === 'fit' ? null : Number(el.dataset.scale);
        시트닫기();
        미리보기갱신();
        return;
      }
      if (e.target.closest('[data-scale-apply]')) {
        const v = parseScale(back.querySelector('#scale-input').value);
        if (v !== null) {
          상태.배율 = v;
          시트닫기();
          미리보기갱신();
        }
      }
    });
  });
}

// ═══════════════════════════════════════════ 파일

function 파일내려받기(이름, 글자) {
  const blob = new Blob([글자], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${이름.replace(/[/\\:*?"<>|]/g, '_') || '도면'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function 파일불러오기() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const r = Store.importText(await f.text(), EquipmentMerger);
      목록그리기();

      const 줄 = [`${r.diagram.title} · 장비 ${r.nodeCount} · 연결 ${r.edgeCount}`];
      if (r.addedCount > 0) 줄.push(`장비 종류 ${r.addedCount}개가 목록에 추가되었습니다.`);
      if (r.remapCount > 0) 줄.push(`같은 이름의 다른 장비 ${r.remapCount}개는 새 항목으로 넣었습니다.`);
      alert(`불러왔습니다\n\n${줄.join('\n')}`);
    } catch (err) {
      alert(err instanceof FileFormatError || err instanceof FileVersionError
        ? err.message : '파일을 읽지 못했습니다.');
    }
  });
  input.click();
}

// ═══════════════════════════════════════════ 화면 전환

function 화면전환(이름) {
  상태.화면 = 이름;
  ['list', 'canvas', 'preview'].forEach(s =>
    $(`#screen-${s}`).classList.toggle('hidden', s !== 이름));
  if (이름 === 'list') 목록그리기();
}

// ═══════════════════════════════════════════ 시작

function 시작() {
  canvas = new DiagramCanvas($('#canvas-wrap'), {
    onMoveNode: (id, p) => 적용(Graph.moveNode(상태.graph, id, p.x, p.y)),
    onConnect: (a, b) => {
      const r = Graph.connect(상태.graph, a, b, 'data');
      if (r.edge) 적용(r.graph);
      else canvas.draw();   // 중복이면 아무 일 없음
    },
    onSelectionChange: () => 도구막대갱신(),
  });

  // ── 목록 화면
  $('#screen-list').addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    const share = e.target.closest('[data-share]');
    const rename = e.target.closest('[data-rename]');
    const dup = e.target.closest('[data-dup]');
    const del = e.target.closest('[data-del]');

    if (share) {
      const d = Store.diagram(share.dataset.share);
      파일내려받기(d.title, Store.exportText(d.id));
    } else if (rename) {
      const d = Store.diagram(rename.dataset.rename);
      const v = prompt('도면 이름', d.title);
      if (v !== null) { Store.rename(d.id, v); 목록그리기(); }
    } else if (dup) {
      Store.duplicate(dup.dataset.dup);
      목록그리기();
    } else if (del) {
      const d = Store.diagram(del.dataset.del);
      if (confirm(`"${d.title}" 도면을 지울까요?`)) { Store.remove(d.id); 목록그리기(); }
    } else if (open) {
      도면열기(open.dataset.open);
    }
  });

  $('#btn-new').addEventListener('click', () => {
    const v = prompt('새 도면 이름', '');
    if (v === null) return;   // 취소하면 아무것도 만들지 않는다
    도면열기(Store.create(v).id);
  });

  $('#btn-import').addEventListener('click', 파일불러오기);
  $('#btn-types').addEventListener('click', 장비관리시트);

  // ── 캔버스 화면
  $('#btn-back').addEventListener('click', () => 화면전환('list'));
  $('#btn-undo').addEventListener('click', 되돌리기);
  $('#btn-redo').addEventListener('click', 다시하기);
  $('#btn-add').addEventListener('click', 장비고르기시트);
  $('#btn-fit').addEventListener('click', () => canvas.fit());
  $('#btn-preview').addEventListener('click', 미리보기열기);

  $('#btn-arrange-v').addEventListener('click', () => {
    적용(autoArrange(상태.graph,
      { root: canvas.selectedNodeID, direction: 'vertical' }));
    canvas.fit();
  });
  $('#btn-arrange-h').addEventListener('click', () => {
    적용(autoArrange(상태.graph,
      { root: canvas.selectedNodeID, direction: 'horizontal' }));
    canvas.fit();
  });

  $('#float-bar').addEventListener('click', e => {
    const kind = e.target.closest('[data-kind]');
    if (kind) {
      적용(Graph.setEdgeKind(상태.graph, canvas.selectedEdgeID, kind.dataset.kind));
      return;
    }
    if (e.target.closest('[data-edge-del]')) {
      적용(Graph.removeEdge(상태.graph, canvas.selectedEdgeID));
      canvas.select(null, null);
      return;
    }
    if (e.target.closest('[data-node-edit]')) {
      장비정보시트(canvas.selectedNodeID);
      return;
    }
    if (e.target.closest('[data-node-del]')) {
      적용(Graph.removeNode(상태.graph, canvas.selectedNodeID));
      canvas.select(null, null);
      return;
    }
    if (e.target.closest('[data-clear-sel]')) canvas.select(null, null);
  });

  // ── 미리보기 화면
  $('#btn-preview-back').addEventListener('click', () => 화면전환('canvas'));
  $('#btn-scale').addEventListener('click', 배율메뉴);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#toggle-landscape').addEventListener('click', () => {
    상태.가로지면 = true; 미리보기갱신();
  });
  $('#toggle-portrait').addEventListener('click', () => {
    상태.가로지면 = false; 미리보기갱신();
  });
  $('#btn-preview-export').addEventListener('click', () => {
    const d = Store.diagram(상태.도면ID);
    파일내려받기(d.title, Store.exportText(d.id));
  });

  window.addEventListener('resize', () => {
    if (상태.화면 === 'preview') 미리보기갱신();
  });

  // ── 시트 공통 닫기
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) 시트닫기();
  });

  // ── 단축키
  document.addEventListener('keydown', e => {
    if (상태.화면 !== 'canvas') return;
    const 입력중 = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    if (입력중) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? 다시하기() : 되돌리기();
    } else if (e.key === 'Escape') {
      canvas.select(null, null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace')) {
      if (canvas.selectedNodeID) {
        적용(Graph.removeNode(상태.graph, canvas.selectedNodeID));
        canvas.select(null, null);
      } else if (canvas.selectedEdgeID) {
        적용(Graph.removeEdge(상태.graph, canvas.selectedEdgeID));
        canvas.select(null, null);
      }
    }
  });

  Store.types();   // 첫 실행이면 기본 17종을 심는다
  화면전환('list');
}

document.addEventListener('DOMContentLoaded', 시작);
