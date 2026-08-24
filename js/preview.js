// 인쇄 지면 그리기. iOS 의 DiagramPageView 와 같은 결과를 낸다.
// 브라우저 인쇄로 PDF 를 만들므로 별도 PDF 생성기가 필요 없다.

import { Graph, EDGE_KINDS, EDGE_KIND_NAMES } from './topology.js';
import { tallyEquipment } from './equipment.js';
import { iconSVG } from './icons.js';
import { NODE_W, NODE_H, nodeFrame, route, routePoints } from './edge-router.js';
import { contentBounds } from './layout.js';
import {
  drawingRect, headerRect, legendRect, tallyRect, tallyHeight, tallyColumns,
  TALLY_ROW_H, pageGrid, pageTransform, pageLabel,
} from './page.js';
import { escapeHTML } from './canvas.js';

/* 지면 전용 고정 색. 화면 토큰을 쓰면 다크 모드에서 검은 종이가 나온다. */
const INK = '#191F28';
const SUB = '#6B7684';
const RULE = '#D9DEE4';

const CAT_ACCENT = {
  measure: '#0B6BCB', network: '#0E8A80', power: '#C77700', etc: '#6B7684',
};
const CAT_CHIP = {
  measure: '#E3F0FC', network: '#E6F6F4', power: '#FFF3E0', etc: '#EDEFF2',
};
const EDGE_COLOR = {
  data: CAT_ACCENT.measure, fiber: CAT_ACCENT.network, power: CAT_ACCENT.power,
};
const EDGE_DASH = { data: '', fiber: '8,4', power: '3,4' };

/**
 * 도면 한 장을 그린다. 여러 장이면 index 를 바꿔가며 부른다.
 * 집계표는 첫 장에만 그린다 — 이어 붙였을 때 같은 표가 여러 번 나오지 않도록.
 * 다만 자리는 모든 장에서 똑같이 비워 둔다.
 */
export function renderPage({ title, graph, types, date, pageSize,
                             grid, index, tally = [], tallyH = 0 }) {
  const drawing = drawingRect(pageSize, tallyH);
  const t = pageTransform(grid, index, drawing);
  const 라벨 = pageLabel(grid, index);

  const page = document.createElement('div');
  page.className = 'page';
  page.style.width = `${pageSize.w}px`;
  page.style.height = `${pageSize.h}px`;

  page.appendChild(머리말(pageSize, title, graph, t.scale, date, 라벨));
  page.appendChild(도면(pageSize, drawing, graph, types, t));

  if (tallyH > 0 && index === 0) {
    page.appendChild(집계표(pageSize, tally, tallyH));
  }

  page.appendChild(범례(pageSize, graph));

  if (graph.nodes.length === 0) {
    const 안내 = document.createElement('div');
    안내.style.cssText = `position:absolute;left:0;right:0;top:${pageSize.h / 2}px;
      text-align:center;font-size:13px;color:${SUB}`;
    안내.textContent = '장비가 없는 도면입니다';
    page.appendChild(안내);
  }
  return page;
}

function 머리말(pageSize, title, graph, scale, date, 라벨) {
  const r = headerRect(pageSize);
  const box = document.createElement('div');
  box.style.cssText =
    `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px`;

  const 날짜 = date.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  box.innerHTML = `
    <div style="display:flex;align-items:baseline;gap:8px">
      <div class="p-title" style="font-size:20px;flex:1;overflow:hidden;
        white-space:nowrap;text-overflow:ellipsis">${escapeHTML(title)}</div>
      ${라벨 ? `<div class="p-meta" style="font-size:10px;font-weight:600">${라벨}</div>` : ''}
    </div>
    <div class="p-meta" style="display:flex;gap:10px;font-size:10px;margin-top:4px">
      <span>장비 ${graph.nodes.length}</span>
      <span>연결 ${graph.edges.length}</span>
      <span>배율 ${Math.round(scale * 100)}%</span>
      <span style="flex:1"></span>
      <span>${날짜}</span>
    </div>
    <div class="p-rule" style="margin-top:6px"></div>`;
  return box;
}

function 도면(pageSize, drawing, graph, types, t) {
  // 도면이 머리말·집계표·범례를 침범하지 않게 잘라낸다.
  // 여러 장으로 나누면 이게 없으면 반드시 넘친다.
  const clip = document.createElement('div');
  clip.className = 'p-clip';
  clip.style.cssText =
    `left:${drawing.x}px;top:${drawing.y}px;width:${drawing.w}px;height:${drawing.h}px`;

  const 안쪽 = document.createElement('div');
  안쪽.style.cssText =
    `position:absolute;left:${-drawing.x}px;top:${-drawing.y}px;
     width:${pageSize.w}px;height:${pageSize.h}px`;

  안쪽.appendChild(연결선(pageSize, graph, t));

  for (const n of graph.nodes) {
    const type = types.find(x => x.key === n.typeKey) ?? null;
    안쪽.appendChild(지면카드(n, type, t));
  }

  clip.appendChild(안쪽);
  return clip;
}

function 연결선(pageSize, graph, t) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', pageSize.w);
  svg.setAttribute('height', pageSize.h);
  svg.style.cssText = 'position:absolute;left:0;top:0';

  for (const e of graph.edges) {
    const a = Graph.node(graph, e.from);
    const b = Graph.node(graph, e.to);
    if (!a || !b) continue;

    const pts = routePoints(route(nodeFrame(a.x, a.y), nodeFrame(b.x, b.y)))
      .map(p => ({ x: p.x * t.scale + t.offset.x, y: p.y * t.scale + t.offset.y }));

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      `M ${pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', EDGE_COLOR[e.kind]);
    path.setAttribute('stroke-width', Math.max(1, 1.6 * t.scale));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    const dash = EDGE_DASH[e.kind];
    if (dash) {
      path.setAttribute('stroke-dasharray',
        dash.split(',').map(v => Number(v) * t.scale).join(','));
    }
    svg.appendChild(path);
  }
  return svg;
}

function 지면카드(n, type, t) {
  const cat = type?.category ?? 'etc';
  const el = document.createElement('div');
  el.className = 'p-node';
  el.style.cssText =
    `left:${(n.x * t.scale + t.offset.x).toFixed(1)}px;
     top:${(n.y * t.scale + t.offset.y).toFixed(1)}px;
     width:${NODE_W}px;height:${NODE_H}px;
     transform:scale(${t.scale});
     border:1.2px solid ${CAT_ACCENT[cat]};gap:5px`;

  el.innerHTML =
    (type
      ? `<div style="background:${CAT_CHIP[cat]};border-radius:8px;padding:4px;
                     display:flex">${iconSVG(type.iconName, 32)}</div>`
      : '') +
    `<div class="label" style="font-size:11px;padding:0 4px">${escapeHTML(n.label)}</div>`;

  if (String(n.note ?? '').trim() !== '') {
    const dot = document.createElement('div');
    dot.style.cssText = `position:absolute;top:5px;right:5px;width:5px;height:5px;
                         border-radius:50%;background:${CAT_ACCENT[cat]}`;
    el.appendChild(dot);
  }
  return el;
}

/** 장비 종류별 수량. 아이콘·이름·개수를 여러 칸에 나눠 담는다. */
function 집계표(pageSize, tally, tallyH) {
  const r = tallyRect(pageSize, tallyH);
  const cols = tallyColumns(pageSize);
  const 합계 = tally.reduce((s, x) => s + x.count, 0);

  const box = document.createElement('div');
  box.style.cssText =
    `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

  const 항목 = tally.map(({ type, count, key }) => {
    const cat = type?.category ?? 'etc';
    const 이름 = type?.name ?? key;
    return `<div style="display:flex;align-items:center;gap:5px;
              height:${TALLY_ROW_H}px;overflow:hidden">
      <span style="background:${CAT_CHIP[cat]};border-radius:4px;padding:2px;
        display:flex;flex:none">${iconSVG(type?.iconName ?? '18_etc_gear', 13)}</span>
      <span style="font-size:9.5px;color:${INK};flex:1;overflow:hidden;
        white-space:nowrap;text-overflow:ellipsis">${escapeHTML(이름)}</span>
      <span style="font-size:9.5px;font-weight:700;color:${CAT_ACCENT[cat]};
        flex:none">${count}</span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="p-rule"></div>
    <div style="display:flex;align-items:baseline;gap:6px;margin:4px 0 2px">
      <span style="font-size:10px;font-weight:700;color:${INK}">장비 집계</span>
      <span style="font-size:9px;color:${SUB}">
        ${tally.length}종 · 합계 ${합계}대</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(${cols},1fr);
      column-gap:16px">${항목}</div>`;
  return box;
}

function 범례(pageSize, graph) {
  const r = legendRect(pageSize);
  const 있는것 = new Set(graph.edges.map(e => e.kind));
  const 쓰인 = EDGE_KINDS.filter(k => 있는것.has(k));

  const box = document.createElement('div');
  box.style.cssText =
    `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px`;

  const 항목 = 쓰인.map(k => `
    <span style="display:inline-flex;align-items:center;gap:5px;margin-right:18px">
      <svg width="24" height="8"><path d="M0 4 H24" fill="none"
        stroke="${EDGE_COLOR[k]}" stroke-width="1.8" stroke-linecap="round"
        ${EDGE_DASH[k] ? `stroke-dasharray="${EDGE_DASH[k]}"` : ''}/></svg>
      <span style="font-size:9px;color:${SUB}">${EDGE_KIND_NAMES[k]}</span>
    </span>`).join('');

  box.innerHTML = `<div class="p-rule"></div>
    <div style="margin-top:6px">${항목}</div>`;
  return box;
}

/** 미리보기에 모든 장을 그린다. */
export function renderAllPages(container,
    { title, graph, types, pageSize, scale, withTally = true }) {
  const tally = withTally ? tallyEquipment(graph, types) : [];
  const tallyH = withTally ? tallyHeight(pageSize, tally.length) : 0;

  const drawing = drawingRect(pageSize, tallyH);
  const grid = pageGrid(contentBounds(graph.nodes), scale, drawing);
  const date = new Date();

  const frag = document.createDocumentFragment();
  for (let i = 0; i < grid.pageCount; i += 1) {
    frag.appendChild(renderPage({
      title, graph, types, date, pageSize, grid, index: i, tally, tallyH,
    }));
  }
  container.replaceChildren(frag);
  return grid;
}
