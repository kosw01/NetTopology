// 캔버스 그리기와 조작. iOS 의 DiagramCanvasView 와 같은 동작이다.
// 마우스와 손가락을 모두 받는다.

import { Graph } from './topology.js';
import { iconSVG } from './icons.js';
import {
  NODE_W, NODE_H, TOUCH_SLOP,
  nodeFrame, frameContains, route, routePoints, hitEdge,
} from './edge-router.js';
import {
  makeTransform, screenPoint, canvasPoint, translated, scaledAround,
  contentBounds, fitTransform, snapPoint, GRID_STEP,
} from './layout.js';

const CAT_VAR = {
  measure: ['--cat-measure', '--cat-measure-chip'],
  network: ['--cat-network', '--cat-network-chip'],
  power:   ['--cat-power',   '--cat-power-chip'],
  etc:     ['--cat-etc',     '--cat-etc-chip'],
};

const EDGE_VAR = {
  data:  '--cat-measure',
  fiber: '--cat-network',
  power: '--cat-power',
};

const EDGE_DASH = {
  data:  [],
  fiber: [8, 4],
  power: [3, 4],
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 캔버스 한 벌. 화면 요소를 받아 그리기와 제스처를 붙인다.
 * 상태를 바꿀 때는 반드시 콜백을 통해 바깥에 알린다 — 되돌리기가 걸리도록.
 */
export class DiagramCanvas {
  constructor(root, callbacks) {
    this.root = root;
    this.cb = callbacks;

    this.gridCanvas = root.querySelector('#grid');
    this.edgeCanvas = root.querySelector('#edges');
    this.nodeLayer = root.querySelector('#nodes');

    this.graph = { nodes: [], edges: [] };
    this.types = [];
    this.transform = makeTransform();
    this.selectedNodeID = null;
    this.selectedEdgeID = null;

    this.끄는중 = null;    // { id, origin, current }
    this.잇는중 = null;    // { from, screenPoint, target }
    this.패닝 = null;      // { startX, startY, base }
    this.핀치 = null;      // { base, dist, center }
    this.포인터 = new Map();
    this.첫맞춤함 = false;

    this._제스처붙이기();

    this._resizeObserver = new ResizeObserver(() => this.draw());
    this._resizeObserver.observe(root);
  }

  setData(graph, types) {
    this.graph = graph;
    this.types = types;
    this.draw();
  }

  /** 처음 열 때 한 번만 전체를 화면에 맞춘다. */
  fitOnce() {
    if (this.첫맞춤함) return;
    this.첫맞춤함 = true;
    this.fit();
  }

  fit() {
    const r = this.root.getBoundingClientRect();
    this.transform = fitTransform(
      contentBounds(this.graph.nodes), { w: r.width, h: r.height });
    this.draw();
  }

  resetFit() { this.첫맞춤함 = false; }

  select(nodeID, edgeID) {
    this.selectedNodeID = nodeID ?? null;
    this.selectedEdgeID = edgeID ?? null;
    this.draw();
    this.cb.onSelectionChange?.(this.selectedNodeID, this.selectedEdgeID);
  }

  // ───────────────────────────────── 그리기

  /** 드래그 중이면 임시 좌표를, 아니면 저장된 좌표를 준다. */
  _pos(n) {
    if (this.끄는중 && this.끄는중.id === n.id) return this.끄는중.current;
    return { x: n.x, y: n.y };
  }

  _center(n) {
    const p = this._pos(n);
    return screenPoint(this.transform,
      { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 });
  }

  draw() {
    const r = this.root.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this._drawGrid(r);
    this._drawEdges(r);
    this._drawNodes();
  }

  _prepCanvas(cv, r) {
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) ||
        cv.height !== Math.round(r.height * dpr)) {
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    return ctx;
  }

  _drawGrid(r) {
    const ctx = this._prepCanvas(this.gridCanvas, r);
    const 간격 = GRID_STEP * this.transform.scale;
    if (간격 <= 10) return;   // 너무 촘촘하면 지저분하니 그리지 않는다

    ctx.strokeStyle = cssVar('--divider');
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let x = this.transform.offset.x % 간격; x < r.width; x += 간격) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, r.height);
    }
    for (let y = this.transform.offset.y % 간격; y < r.height; y += 간격) {
      ctx.moveTo(0, y);
      ctx.lineTo(r.width, y);
    }
    ctx.stroke();
  }

  _drawEdges(r) {
    const ctx = this._prepCanvas(this.edgeCanvas, r);
    const s = this.transform.scale;

    for (const e of this.graph.edges) {
      const a = Graph.node(this.graph, e.from);
      const b = Graph.node(this.graph, e.to);
      if (!a || !b) continue;

      const pa = this._pos(a), pb = this._pos(b);
      const pts = routePoints(route(nodeFrame(pa.x, pa.y), nodeFrame(pb.x, pb.y)))
        .map(p => screenPoint(this.transform, p));

      const 골랐나 = this.selectedEdgeID === e.id;

      // 선택된 선은 뒤에 굵은 흐린 띠를 깔아 눈에 띄게 한다
      if (골랐나) {
        ctx.save();
        ctx.strokeStyle = cssVar('--main');
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = Math.max(10, 10 * s);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        this._stroke(ctx, pts);
        ctx.restore();
      }

      ctx.strokeStyle = 골랐나 ? cssVar('--main') : cssVar(EDGE_VAR[e.kind]);
      ctx.lineWidth = Math.max(1.5, (골랐나 ? 3 : 2) * s);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(EDGE_DASH[e.kind].map(v => v * s));
      this._stroke(ctx, pts);
    }

    // 연결을 끄는 동안 보이는 임시선
    if (this.잇는중) {
      const from = Graph.node(this.graph, this.잇는중.from);
      if (from) {
        ctx.strokeStyle = cssVar('--main');
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.setLineDash([6, 4]);
        this._stroke(ctx, [this._center(from), this.잇는중.screenPoint]);
      }
    }
    ctx.setLineDash([]);
  }

  _stroke(ctx, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  _drawNodes() {
    const s = this.transform.scale;
    const frag = document.createDocumentFragment();

    for (const n of this.graph.nodes) {
      const type = this.types.find(t => t.key === n.typeKey) ?? null;
      const [accVar, chipVar] = CAT_VAR[type?.category ?? 'etc'];
      const p = this._pos(n);
      const tl = screenPoint(this.transform, p);

      const el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = n.id;
      if (this.selectedNodeID === n.id) el.classList.add('selected');
      if (this.잇는중?.target === n.id) el.classList.add('target');
      if (this.끄는중?.id === n.id) el.classList.add('dragging');

      el.style.setProperty('--accent', `var(${accVar})`);
      el.style.setProperty('--chip', `var(${chipVar})`);
      // 폭·높이를 실제 크기로 잡고 scale 로 키운다.
      // transform 만 쓰면 글자가 흐려지지 않는다.
      el.style.width = `${NODE_W}px`;
      el.style.height = `${NODE_H}px`;
      el.style.left = `${tl.x}px`;
      el.style.top = `${tl.y}px`;
      el.style.transform = `scale(${s})`;
      el.style.borderWidth = `${(this.selectedNodeID === n.id ||
                                 this.잇는중?.target === n.id) ? 3 : 1.5}px`;

      const 메모점 = document.createElement('div');
      메모점.className = 'dot';
      메모점.style.width = '7px';
      메모점.style.height = '7px';

      el.innerHTML =
        (type ? `<div class="chip">${iconSVG(type.iconName, 34)}</div>` : '') +
        `<div class="label" style="font-size:12px">${escapeHTML(n.label)}</div>`;

      if (String(n.note ?? '').trim() !== '') el.appendChild(메모점);
      frag.appendChild(el);
    }

    // 선택된 장비의 좌우에 연결 핸들을 띄운다.
    // 배율과 무관하게 같은 크기로 그려야 축소해도 잡을 수 있다.
    if (this.selectedNodeID && !this.끄는중) {
      const n = Graph.node(this.graph, this.selectedNodeID);
      if (n) {
        const c = this._center(n);
        const 반폭 = NODE_W * s / 2;
        for (const dx of [-반폭, 반폭]) {
          const h = document.createElement('div');
          h.className = 'handle';
          h.dataset.handle = n.id;
          h.style.left = `${c.x + dx}px`;
          h.style.top = `${c.y}px`;
          h.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 15 15 9"/>' +
            '<path d="M11 6l1-1a4 4 0 016 6l-1 1"/>' +
            '<path d="M13 18l-1 1a4 4 0 01-6-6l1-1"/></svg>';
          frag.appendChild(h);
        }
      }
    }

    this.nodeLayer.replaceChildren(frag);
  }

  // ───────────────────────────────── 제스처

  _제스처붙이기() {
    const el = this.root;

    el.addEventListener('pointerdown', e => this._down(e));
    el.addEventListener('pointermove', e => this._move(e));
    el.addEventListener('pointerup', e => this._up(e));
    el.addEventListener('pointercancel', e => this._up(e));

    // 마우스 휠·트랙패드 확대
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = e.ctrlKey
        ? Math.exp(-e.deltaY / 100)     // 트랙패드 핀치
        : Math.exp(-e.deltaY / 400);
      this.transform = scaledAround(this.transform, factor, anchor);
      this.draw();
    }, { passive: false });

    el.addEventListener('dblclick', () => this.fit());
  }

  _local(e) {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _down(e) {
    // 도구막대는 캔버스 위에 떠 있지만 캔버스의 일부가 아니다.
    // 이걸 걸러내지 않으면 버튼을 누르는 순간 빈 곳 탭으로 처리되어
    // 선택이 풀리고, 버튼이 사라져 클릭이 도달하지 못한다.
    if (e.target.closest?.('.float-bar')) return;

    this.root.setPointerCapture(e.pointerId);
    this.포인터.set(e.pointerId, this._local(e));

    // 손가락 두 개면 핀치로 전환하고, 진행 중이던 드래그는 버린다.
    if (this.포인터.size === 2) {
      const [p1, p2] = [...this.포인터.values()];
      this.핀치 = {
        base: this.transform,
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
      this.끄는중 = null;
      this.잇는중 = null;
      this.패닝 = null;
      this.draw();
      return;
    }

    const p = this._local(e);
    const 핸들 = e.target.closest?.('[data-handle]');
    const 노드 = e.target.closest?.('.node');

    if (핸들) {
      this.잇는중 = { from: 핸들.dataset.handle, screenPoint: p, target: null };
      return;
    }

    if (노드) {
      const n = Graph.node(this.graph, 노드.dataset.id);
      if (n) {
        this.끄는중 = { id: n.id, origin: { x: n.x, y: n.y },
                       current: { x: n.x, y: n.y }, moved: false };
        this.select(n.id, null);
      }
      return;
    }

    this.패닝 = { start: p, base: this.transform, moved: false };
    this.root.classList.add('grabbing');
  }

  _move(e) {
    if (!this.포인터.has(e.pointerId)) return;
    const p = this._local(e);
    this.포인터.set(e.pointerId, p);

    if (this.핀치 && this.포인터.size >= 2) {
      const [p1, p2] = [...this.포인터.values()];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (this.핀치.dist > 0) {
        this.transform = scaledAround(
          this.핀치.base, d / this.핀치.dist, this.핀치.center);
        this.draw();
      }
      return;
    }

    if (this.잇는중) {
      const 도면점 = canvasPoint(this.transform, p);
      const 대상 = this.graph.nodes.find(n =>
        n.id !== this.잇는중.from && frameContains(nodeFrame(n.x, n.y), 도면점));
      this.잇는중 = { ...this.잇는중, screenPoint: p, target: 대상?.id ?? null };
      this.draw();
      return;
    }

    if (this.끄는중) {
      const 시작화면 = screenPoint(this.transform, this.끄는중.origin);
      const dx = p.x - 시작화면.x - NODE_W * this.transform.scale / 2;
      // 카드 안 어디를 잡았든 상대 이동량만 쓴다
      const base = this.끄는중.origin;
      const 화면이동 = { x: p.x - (this.끄는중.lastPointer?.x ?? p.x),
                       y: p.y - (this.끄는중.lastPointer?.y ?? p.y) };
      if (!this.끄는중.lastPointer) {
        this.끄는중.lastPointer = p;
      } else {
        this.끄는중.current = {
          x: this.끄는중.current.x + 화면이동.x / this.transform.scale,
          y: this.끄는중.current.y + 화면이동.y / this.transform.scale,
        };
        this.끄는중.lastPointer = p;
        this.끄는중.moved = true;
      }
      this.draw();
      return;
    }

    if (this.패닝) {
      const dx = p.x - this.패닝.start.x;
      const dy = p.y - this.패닝.start.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.패닝.moved = true;
      this.transform = translated(this.패닝.base, dx, dy);
      this.draw();
    }
  }

  _up(e) {
    this.포인터.delete(e.pointerId);
    this.root.classList.remove('grabbing');

    if (this.포인터.size < 2) this.핀치 = null;

    if (this.잇는중) {
      const 대상 = this.잇는중.target;
      const from = this.잇는중.from;
      this.잇는중 = null;
      if (대상) this.cb.onConnect?.(from, 대상);
      else this.draw();
      return;
    }

    if (this.끄는중) {
      const d = this.끄는중;
      this.끄는중 = null;
      if (d.moved) this.cb.onMoveNode?.(d.id, snapPoint(d.current));
      else this.draw();
      return;
    }

    if (this.패닝) {
      const 움직였나 = this.패닝.moved;
      this.패닝 = null;
      if (!움직였나) this._탭(this._local(e));
    }
  }

  /** 빈 곳을 누르면 연결선을 짚었는지 먼저 본다. */
  _탭(p) {
    const 도면점 = canvasPoint(this.transform, p);
    const 여유 = TOUCH_SLOP / this.transform.scale;
    const id = hitEdge(도면점, this.graph, 여유);
    this.select(null, id);
  }

  destroy() {
    this._resizeObserver.disconnect();
  }
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
