// 좌표 변환·격자·자동 정렬·되돌리기.
// iOS 의 CanvasTransform / GridSnap / AutoArrange / UndoStack 과 같다.

import { Graph } from './topology.js';
import { NODE_W, NODE_H, nodeFrame } from './edge-router.js';

// ─────────────────────────────────────────── 화면 변환

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3.0;

export function clampScale(s) {
  return Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);
}

/** 화면점 = 도면점 * scale + offset */
export function makeTransform(scale = 1, offset = { x: 0, y: 0 }) {
  return { scale: clampScale(scale), offset: { ...offset } };
}

export function screenPoint(t, p) {
  return { x: p.x * t.scale + t.offset.x, y: p.y * t.scale + t.offset.y };
}

export function canvasPoint(t, p) {
  return { x: (p.x - t.offset.x) / t.scale, y: (p.y - t.offset.y) / t.scale };
}

export function translated(t, dx, dy) {
  return makeTransform(t.scale, { x: t.offset.x + dx, y: t.offset.y + dy });
}

/** 화면 위 anchor 지점이 그대로 있도록 확대·축소한다. */
export function scaledAround(t, factor, anchor) {
  const 새배율 = clampScale(t.scale * factor);
  const 실제비 = 새배율 / t.scale;
  return makeTransform(새배율, {
    x: anchor.x - (anchor.x - t.offset.x) * 실제비,
    y: anchor.y - (anchor.y - t.offset.y) * 실제비,
  });
}

/** 모든 장비를 감싸는 사각형. */
export function contentBounds(nodes) {
  if (nodes.length === 0) return { x: 0, y: 0, w: 0, h: 0, midX: 0, midY: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const f = nodeFrame(n.x, n.y);
    minX = Math.min(minX, f.minX);
    minY = Math.min(minY, f.minY);
    maxX = Math.max(maxX, f.maxX);
    maxY = Math.max(maxY, f.maxY);
  }
  return {
    x: minX, y: minY, w: maxX - minX, h: maxY - minY,
    midX: (minX + maxX) / 2, midY: (minY + maxY) / 2,
  };
}

/** 도면 전체가 화면에 들어오도록 배율과 위치를 잡는다. */
export function fitTransform(content, viewport, padding = 40) {
  if (content.w <= 0 || content.h <= 0 ||
      viewport.w <= 0 || viewport.h <= 0) return makeTransform();

  const w = content.w + padding * 2;
  const h = content.h + padding * 2;
  const s = clampScale(Math.min(viewport.w / w, viewport.h / h));

  return makeTransform(s, {
    x: viewport.w / 2 - content.midX * s,
    y: viewport.h / 2 - content.midY * s,
  });
}

// ─────────────────────────────────────────── 격자

export const GRID_STEP = 20;

export function snapValue(v) {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

export function snapPoint(p) {
  return { x: snapValue(p.x), y: snapValue(p.y) };
}

/** 새 장비를 놓을 자리. 이미 있는 자리면 대각선으로 비켜 놓는다. */
export function freeSpot(target, nodes, maxTries = 40) {
  let 후보 = snapPoint(target);

  for (let i = 0; i < maxTries; i += 1) {
    const 겹침 = nodes.some(n =>
      Math.abs(n.x - 후보.x) < NODE_W * 0.6 &&
      Math.abs(n.y - 후보.y) < NODE_H * 0.6);
    if (!겹침) return 후보;
    후보 = { x: 후보.x + GRID_STEP * 2, y: 후보.y + GRID_STEP * 2 };
  }
  return 후보;
}

// ─────────────────────────────────────────── 자동 정렬

export const ARRANGE_STEPS = {
  vertical:   { slot: 200, depth: 140 },
  horizontal: { slot: 140, depth: 220 },
};

/** 방향을 무시한 이웃 목록. 도면에 담긴 순서를 지킨다. */
export function neighbors(id, graph) {
  const 상대 = new Set(Graph.edgesOf(graph, id).map(e => e.from === id ? e.to : e.from));
  return graph.nodes.map(n => n.id).filter(x => 상대.has(x));
}

/** 한 장비에서 연결을 타고 닿을 수 있는 모든 장비. */
export function connectedGroup(start, graph) {
  const 결과 = [];
  const 봤음 = new Set([start]);
  const 대기 = [start];

  while (대기.length > 0) {
    const 현재 = 대기.shift();
    결과.push(현재);
    for (const id of neighbors(현재, graph)) {
      if (봤음.has(id)) continue;
      봤음.add(id);
      대기.push(id);
    }
  }
  return 결과;
}

/** 연결이 가장 많은 장비. 동률이면 도면에 먼저 담긴 쪽. */
export function pickRoot(group, graph) {
  const 순서 = new Map(graph.nodes.map((n, i) => [n.id, i]));
  let best = group[0];
  for (const id of group) {
    const d = Graph.edgesOf(graph, id).length;
    const bd = Graph.edgesOf(graph, best).length;
    if (d > bd || (d === bd && (순서.get(id) ?? 0) < (순서.get(best) ?? 0))) best = id;
  }
  return best;
}

/**
 * 뿌리에서 뻗어나가는 부모·자식 관계를 만든다.
 * 고리가 있어도 먼저 닿은 쪽을 부모로 삼아 나무 하나로 편다.
 */
export function buildTree(root, graph) {
  const 자식 = new Map();
  const 깊이 = new Map([[root, 0]]);
  const 대기 = [root];

  while (대기.length > 0) {
    const 현재 = 대기.shift();
    for (const id of neighbors(현재, graph)) {
      if (깊이.has(id)) continue;
      깊이.set(id, (깊이.get(현재) ?? 0) + 1);
      if (!자식.has(현재)) 자식.set(현재, []);
      자식.get(현재).push(id);
      대기.push(id);
    }
  }
  return { 자식, 깊이 };
}

/** 잎은 순서대로 칸을 차지하고, 부모는 자식들의 한가운데에 선다. */
function 칸계산(id, 자식, 칸, 상태) {
  const 아이들 = 자식.get(id) ?? [];

  if (아이들.length === 0) {
    칸.set(id, 상태.다음);
    상태.다음 += 1;
    return 칸.get(id);
  }

  const 자리들 = 아이들.map(c => 칸계산(c, 자식, 칸, 상태));
  const 가운데 = (자리들[0] + 자리들[자리들.length - 1]) / 2;
  칸.set(id, 가운데);
  return 가운데;
}

/**
 * 연결 관계를 따라 계층으로 배치한다.
 * 자식을 부모 아래에 모아 놓아 선이 엉키지 않게 한다.
 */
export function autoArrange(graph, { root = null, direction = 'vertical',
                                     origin = { x: 60, y: 60 } } = {}) {
  if (graph.nodes.length === 0) return graph;

  const step = ARRANGE_STEPS[direction] ?? ARRANGE_STEPS.vertical;
  const 좌표 = new Map();
  const 처리함 = new Set();
  const 상태 = { 다음: 0 };

  for (const n of graph.nodes) {
    if (처리함.has(n.id)) continue;

    const 무리 = connectedGroup(n.id, graph);
    무리.forEach(id => 처리함.add(id));

    // 사용자가 고른 장비가 이 무리에 있으면 그것을 꼭대기로 삼는다.
    const 뿌리 = (root && 무리.includes(root)) ? root : pickRoot(무리, graph);

    const { 자식, 깊이 } = buildTree(뿌리, graph);
    const 칸 = new Map();
    칸계산(뿌리, 자식, 칸, 상태);

    for (const id of 무리) {
      const s = 칸.get(id) ?? 0;
      const d = 깊이.get(id) ?? 0;
      좌표.set(id, direction === 'vertical'
        ? { x: origin.x + s * step.slot,  y: origin.y + d * step.depth }
        : { x: origin.x + d * step.depth, y: origin.y + s * step.slot });
    }

    상태.다음 += 1;   // 무리와 무리 사이를 한 칸 띄운다
  }

  return {
    nodes: graph.nodes.map(n => {
      const p = 좌표.get(n.id);
      if (!p) return n;
      const 붙임 = snapPoint(p);
      return { ...n, x: 붙임.x, y: 붙임.y };
    }),
    edges: graph.edges,
  };
}

// ─────────────────────────────────────────── 되돌리기

/**
 * 되돌리기·다시하기 이력. 상태를 통째로 쌓는다.
 * 도면 하나가 수십 KB 라 20 단계는 부담이 없다.
 */
export class UndoStack {
  constructor(limit = 20) {
    this.limit = Math.max(1, limit);
    this.past = [];
    this.future = [];
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  /**
   * 바꾸기 직전에 현재 상태를 넣는다.
   * 새 변경이 생기면 다시하기 이력은 버린다 — 갈라진 미래는 의미가 없다.
   */
  record(state) {
    const last = this.past[this.past.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(state)) return;

    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current) {
    if (this.past.length === 0) return null;
    const 이전 = this.past.pop();
    this.future.push(current);
    if (this.future.length > this.limit) this.future.shift();
    return 이전;
  }

  redo(current) {
    if (this.future.length === 0) return null;
    const 다음 = this.future.pop();
    this.past.push(current);
    if (this.past.length > this.limit) this.past.shift();
    return 다음;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
