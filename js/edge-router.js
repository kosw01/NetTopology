// 연결선 경로 계산. iOS 의 EdgeRouter.swift / EdgeHitTest.swift 와 같다.

import { Graph } from './topology.js';

/** 장비 카드 기본 크기. 화면 코드와 이 값을 공유한다. */
export const NODE_W = 132;
export const NODE_H = 96;

/** 화면에서 손가락·마우스 판정 폭. 배율로 나눠 쓰면 화면상 폭이 일정해진다. */
export const TOUCH_SLOP = 22;

export function nodeFrame(x, y) {
  return { x, y, w: NODE_W, h: NODE_H,
           minX: x, minY: y, maxX: x + NODE_W, maxY: y + NODE_H,
           midX: x + NODE_W / 2, midY: y + NODE_H / 2 };
}

export function frameContains(f, p) {
  return p.x >= f.minX && p.x <= f.maxX && p.y >= f.minY && p.y <= f.maxY;
}

/**
 * a 에서 b 로 가는 경로.
 * 가로 거리가 더 멀면 좌우 변을, 세로가 멀면 위아래 변을 쓴다.
 * 그래야 선이 아이콘을 뚫고 지나가지 않는다.
 */
export function route(a, b, shape = 'ortho') {
  const dx = b.midX - a.midX;
  const dy = b.midY - a.midY;
  const 가로가멀다 = Math.abs(dx) >= Math.abs(dy);

  let start, end, startSide, endSide;

  if (가로가멀다) {
    startSide = dx >= 0 ? 'trailing' : 'leading';
    endSide   = dx >= 0 ? 'leading'  : 'trailing';
    start = { x: dx >= 0 ? a.maxX : a.minX, y: a.midY };
    end   = { x: dx >= 0 ? b.minX : b.maxX, y: b.midY };
  } else {
    startSide = dy >= 0 ? 'bottom' : 'top';
    endSide   = dy >= 0 ? 'top'    : 'bottom';
    start = { x: a.midX, y: dy >= 0 ? a.maxY : a.minY };
    end   = { x: b.midX, y: dy >= 0 ? b.minY : b.maxY };
  }

  const corners = [];
  if (shape === 'ortho') {
    if (가로가멀다) {
      const mx = (start.x + end.x) / 2;
      if (start.y !== end.y) {
        corners.push({ x: mx, y: start.y }, { x: mx, y: end.y });
      }
    } else {
      const my = (start.y + end.y) / 2;
      if (start.x !== end.x) {
        corners.push({ x: start.x, y: my }, { x: end.x, y: my });
      }
    }
  }

  return {
    start, end, startSide, endSide, corners,
    midPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/** 선 위의 점들을 순서대로. 그리기와 탭 판정에 함께 쓴다. */
export function routePoints(r) {
  return [r.start, ...r.corners, r.end];
}

/** 점과 선분 사이 최단 거리. */
export function distanceToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const 길이제곱 = vx * vx + vy * vy;

  if (길이제곱 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);

  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / 길이제곱;
  t = Math.min(Math.max(t, 0), 1);

  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** 도면 좌표 위의 점이 어느 연결선을 짚었는지. 가장 가까운 것을 고른다. */
export function hitEdge(point, graph, tolerance, shape = 'ortho') {
  let 최선 = null;

  for (const e of graph.edges) {
    const a = Graph.node(graph, e.from);
    const b = Graph.node(graph, e.to);
    if (!a || !b) continue;

    const pts = routePoints(route(nodeFrame(a.x, a.y), nodeFrame(b.x, b.y), shape));

    let 거리 = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
      거리 = Math.min(거리, distanceToSegment(point, pts[i], pts[i + 1]));
    }

    if (거리 > tolerance) continue;
    if (!최선 || 거리 < 최선.거리) 최선 = { id: e.id, 거리 };
  }

  return 최선?.id ?? null;
}
