// 순수 로직 검증. iOS 의 Swift Testing 과 같은 항목을 확인한다.
// 실행: node test.mjs

import { Graph, emptyGraph, hasNote, edgeConnects } from './js/topology.js';
import { BUILT_INS, EquipmentEditor, EquipmentMerger, makeKey, ALL_ICON_NAMES,
  tallyEquipment } from './js/equipment.js';
import { nodeFrame, route, routePoints, distanceToSegment, hitEdge, NODE_W, NODE_H }
  from './js/edge-router.js';
import {
  makeTransform, screenPoint, canvasPoint, translated, scaledAround,
  contentBounds, fitTransform, MIN_SCALE, MAX_SCALE,
  snapValue, snapPoint, freeSpot, autoArrange, connectedGroup, pickRoot,
  UndoStack,
} from './js/layout.js';
import {
  makeFile, encodeFile, decodeFile, fileGraph, FileFormatError, FileVersionError,
  A4_LANDSCAPE, A4_PORTRAIT, preferredPage, drawingRect, headerRect, legendRect,
  pageGrid, pagePosition, pageCanvasRect, pageTransform, pageLabel,
  parseScale, PAGE_MAX_SCALE, PAGE_MARGIN,
  tallyHeight, tallyRect, tallyColumns, LEGEND_H,
} from './js/page.js';

let 통과 = 0, 실패 = 0;
const 실패목록 = [];
let 현재묶음 = '';

function suite(name, fn) { 현재묶음 = name; fn(); }

function test(name, fn) {
  try {
    fn();
    통과 += 1;
  } catch (e) {
    실패 += 1;
    실패목록.push(`  ✗ [${현재묶음}] ${name}\n      ${e.message}`);
  }
}

function expect(cond, msg = '') {
  if (!cond) throw new Error(msg || '조건이 참이 아닙니다');
}

function eq(a, b, msg = '') {
  if (a !== b) throw new Error(msg || `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

function near(a, b, tol = 0.01) {
  if (Math.abs(a - b) > tol) throw new Error(`${a} 와 ${b} 가 다릅니다`);
}

// ─────────────────────────────────────────── 그래프 규칙

suite('그래프 규칙', () => {
  function 기본도면() {
    let g = emptyGraph();
    const r1 = Graph.addNode(g, { typeKey: 'server', label: '서버', x: 0, y: 0 });
    const r2 = Graph.addNode(r1.graph, { typeKey: 'hub', label: '허브', x: 200, y: 0 });
    return { g: r2.graph, a: r1.node, b: r2.node };
  }

  test('장비를 지우면 거기 붙은 연결도 사라진다', () => {
    const { g: g0, a, b } = 기본도면();
    const r = Graph.addNode(g0, { typeKey: 'router', label: '라우터', x: 400, y: 0 });
    let g = Graph.connect(r.graph, a.id, b.id).graph;
    g = Graph.connect(g, b.id, r.node.id).graph;
    eq(g.edges.length, 2);

    g = Graph.removeNode(g, b.id);
    eq(g.nodes.length, 2);
    eq(g.edges.length, 0);
  });

  test('같은 두 장비는 두 번 연결되지 않는다', () => {
    const { g, a, b } = 기본도면();
    const r1 = Graph.connect(g, a.id, b.id);
    expect(r1.edge !== null);
    expect(Graph.connect(r1.graph, a.id, b.id).edge === null);
    expect(Graph.connect(r1.graph, b.id, a.id).edge === null);   // 방향만 바꿔도 같은 연결
    eq(r1.graph.edges.length, 1);
  });

  test('자기 자신과는 연결되지 않는다', () => {
    const { g, a } = 기본도면();
    expect(Graph.connect(g, a.id, a.id).edge === null);
  });

  test('도면에 없는 장비와는 연결되지 않는다', () => {
    const { g, a } = 기본도면();
    expect(Graph.connect(g, a.id, 'no-such-id').edge === null);
  });

  test('연결 하나만 지워도 장비는 남는다', () => {
    const { g, a, b } = 기본도면();
    const r = Graph.connect(g, a.id, b.id);
    const g2 = Graph.removeEdge(r.graph, r.edge.id);
    eq(g2.edges.length, 0);
    eq(g2.nodes.length, 2);
  });

  test('장비에 붙은 연결을 모두 찾는다', () => {
    const { g: g0, a, b } = 기본도면();
    const r = Graph.addNode(g0, { typeKey: 'router', label: 'C', x: 400, y: 0 });
    let g = Graph.connect(r.graph, a.id, b.id).graph;
    g = Graph.connect(g, b.id, r.node.id).graph;
    eq(Graph.edgesOf(g, b.id).length, 2);
    eq(Graph.edgesOf(g, a.id).length, 1);
  });

  test('메모가 공백뿐이면 메모 없음으로 본다', () => {
    const { g, a } = 기본도면();
    const g1 = Graph.updateNode(g, a.id, { note: '   \n ' });
    eq(hasNote(Graph.node(g1, a.id)), false);
    const g2 = Graph.updateNode(g1, a.id, { note: '포트 3번' });
    eq(hasNote(Graph.node(g2, a.id)), true);
  });

  test('연결 종류를 바꿀 수 있다', () => {
    const { g, a, b } = 기본도면();
    const r = Graph.connect(g, a.id, b.id);
    const g2 = Graph.setEdgeKind(r.graph, r.edge.id, 'fiber');
    eq(Graph.edge(g2, r.edge.id).kind, 'fiber');
  });
});

// ─────────────────────────────────────────── 장비 정의

suite('장비 정의', () => {
  test('기본 장비는 17종이고 key 가 겹치지 않는다', () => {
    eq(BUILT_INS.length, 17);
    eq(new Set(BUILT_INS.map(t => t.key)).size, 17);
  });

  test('아이콘 목록이 21개고 기본 장비 아이콘이 모두 그 안에 있다', () => {
    eq(ALL_ICON_NAMES.length, 21);
    const 전체 = new Set(ALL_ICON_NAMES);
    for (const t of BUILT_INS) expect(전체.has(t.iconName), `${t.iconName} 없음`);
  });

  test('이름이 겹치면 뒤에 번호를 붙여 key 를 만든다', () => {
    const 있는것 = new Set(['광_컨버터', '광_컨버터_2']);
    eq(makeKey('광 컨버터', 있는것), '광_컨버터_3');
    eq(makeKey('새 장비', 있는것), '새_장비');
  });

  test('이름이 비어 있어도 key 가 만들어진다', () => {
    eq(makeKey('   ', new Set()), 'custom');
  });

  test('새 장비가 목록 끝에 붙는다', () => {
    const r = EquipmentEditor.add(BUILT_INS,
      { name: 'NAS', iconName: '07_server', category: 'network' });
    eq(r.length, BUILT_INS.length + 1);
    eq(r[r.length - 1].name, 'NAS');
    eq(r[r.length - 1].isBuiltIn, false);
  });

  test('이름이 비면 아무것도 안 만든다', () => {
    eq(EquipmentEditor.add(BUILT_INS,
      { name: '   ', iconName: '18_etc_gear', category: 'etc' }).length,
      BUILT_INS.length);
  });

  test('수정해도 key 는 그대로다', () => {
    const r = EquipmentEditor.update(BUILT_INS, 'server',
      { name: '메인 서버', iconName: '20_etc_device', category: 'etc' });
    const t = r.find(x => x.key === 'server');
    eq(t.name, '메인 서버');
    eq(t.iconName, '20_etc_device');
    eq(t.isBuiltIn, true);   // 기본 장비 표시는 유지된다
  });

  test('수정할 때 이름을 비우면 원래 이름을 지킨다', () => {
    const r = EquipmentEditor.update(BUILT_INS, 'server',
      { name: '  ', iconName: '07_server', category: 'network' });
    eq(r.find(x => x.key === 'server').name, '서버');
  });

  test('숨기면 표시만 바뀌고 목록에는 남는다', () => {
    const r = EquipmentEditor.setHidden(BUILT_INS, 'cctv', true);
    eq(r.length, BUILT_INS.length);
    eq(r.find(x => x.key === 'cctv').isHidden, true);
    eq(EquipmentEditor.setHidden(r, 'cctv', false)
       .find(x => x.key === 'cctv').isHidden, false);
  });

  test('기본 장비는 지워지지 않는다', () => {
    eq(EquipmentEditor.remove(BUILT_INS, 'server').length, BUILT_INS.length);
  });

  test('내가 만든 장비는 지워진다', () => {
    const 추가됨 = EquipmentEditor.add(BUILT_INS,
      { name: 'NAS', iconName: '07_server', category: 'network' });
    const key = 추가됨[추가됨.length - 1].key;
    eq(EquipmentEditor.remove(추가됨, key).length, BUILT_INS.length);
  });
});

// ─────────────────────────────────────────── 연결선 경로

suite('연결선 경로', () => {
  const 왼쪽 = nodeFrame(0, 0);

  test('가로로 멀면 좌우 변에서 선이 나간다', () => {
    const r = route(왼쪽, nodeFrame(400, 20));
    eq(r.startSide, 'trailing');
    eq(r.endSide, 'leading');
    eq(r.start.x, 왼쪽.maxX);
  });

  test('세로로 멀면 위아래 변에서 선이 나간다', () => {
    const r = route(왼쪽, nodeFrame(20, 400));
    eq(r.startSide, 'bottom');
    eq(r.endSide, 'top');
    eq(r.start.y, 왼쪽.maxY);
  });

  test('왼쪽으로 갈 때는 방향이 뒤집힌다', () => {
    const r = route(nodeFrame(400, 0), 왼쪽);
    eq(r.startSide, 'leading');
    eq(r.endSide, 'trailing');
  });

  test('높이가 같으면 꺾이지 않는다', () => {
    eq(route(왼쪽, nodeFrame(400, 0)).corners.length, 0);
  });

  test('높이가 다르면 두 번 꺾인다', () => {
    const r = route(왼쪽, nodeFrame(400, 200));
    eq(r.corners.length, 2);
    const mx = (r.start.x + r.end.x) / 2;
    near(r.corners[0].x, mx);
    near(r.corners[1].x, mx);
  });

  test('곡선에는 꺾임점이 없다', () => {
    eq(route(왼쪽, nodeFrame(400, 200), 'curve').corners.length, 0);
  });

  test('선분 밖의 점은 끝점까지의 거리로 잰다', () => {
    const a = { x: 0, y: 0 }, b = { x: 100, y: 0 };
    near(distanceToSegment({ x: 150, y: 0 }, a, b), 50);
    near(distanceToSegment({ x: 50, y: 30 }, a, b), 30);
  });
});

// ─────────────────────────────────────────── 연결선 짚기

suite('연결선 짚기', () => {
  function 기본도면() {
    let g = emptyGraph();
    const r1 = Graph.addNode(g, { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const r2 = Graph.addNode(r1.graph, { typeKey: 'hub', label: 'B', x: 400, y: 0 });
    const r3 = Graph.connect(r2.graph, r1.node.id, r2.node.id);
    return { g: r3.graph, id: r3.edge.id };
  }

  function 선중앙(g) {
    const [a, b] = g.nodes;
    return route(nodeFrame(a.x, a.y), nodeFrame(b.x, b.y)).midPoint;
  }

  test('선 위를 누르면 그 연결을 찾는다', () => {
    const { g, id } = 기본도면();
    eq(hitEdge(선중앙(g), g, 22), id);
  });

  test('선에서 멀면 아무것도 안 잡힌다', () => {
    const { g } = 기본도면();
    const p = 선중앙(g);
    eq(hitEdge({ x: p.x, y: p.y + 300 }, g, 22), null);
  });

  test('여유 폭을 넓히면 멀리서도 잡힌다', () => {
    const { g, id } = 기본도면();
    const p = 선중앙(g);
    eq(hitEdge({ x: p.x, y: p.y + 50 }, g, 22), null);
    eq(hitEdge({ x: p.x, y: p.y + 50 }, g, 60), id);
  });

  test('연결이 없으면 아무것도 안 잡힌다', () => {
    const r = Graph.addNode(emptyGraph(), { typeKey: 'server', label: 'A', x: 0, y: 0 });
    eq(hitEdge({ x: 0, y: 0 }, r.graph, 100), null);
  });

  test('겹칠 때는 더 가까운 연결을 고른다', () => {
    let g = emptyGraph();
    const a = Graph.addNode(g, { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const b = Graph.addNode(a.graph, { typeKey: 'hub', label: 'B', x: 500, y: 0 });
    const c = Graph.addNode(b.graph, { typeKey: 'router', label: 'C', x: 500, y: 300 });
    const e1 = Graph.connect(c.graph, a.node.id, b.node.id);
    const e2 = Graph.connect(e1.graph, a.node.id, c.node.id);

    const r = route(nodeFrame(0, 0), nodeFrame(500, 0));
    eq(hitEdge(r.midPoint, e2.graph, 400), e1.edge.id);
  });
});

// ─────────────────────────────────────────── 화면 변환

suite('화면 변환', () => {
  test('화면 좌표로 갔다 오면 제자리다', () => {
    const t = makeTransform(1.7, { x: 33, y: -21 });
    const p = { x: 120, y: 240 };
    const 돌아온점 = canvasPoint(t, screenPoint(t, p));
    near(돌아온점.x, p.x);
    near(돌아온점.y, p.y);
  });

  test('배율은 상한과 하한을 넘지 않는다', () => {
    eq(makeTransform(99).scale, MAX_SCALE);
    eq(makeTransform(0.01).scale, MIN_SCALE);
  });

  test('확대해도 손가락 아래 지점은 제자리에 있다', () => {
    const t = makeTransform(1, { x: 0, y: 0 });
    const anchor = { x: 200, y: 300 };
    const 확대 = scaledAround(t, 2, anchor);
    const 전 = canvasPoint(t, anchor);
    const 후 = canvasPoint(확대, anchor);
    near(전.x, 후.x);
    near(전.y, 후.y);
  });

  test('이동은 배율을 건드리지 않는다', () => {
    const t = translated(makeTransform(2, { x: 10, y: 10 }), 5, -3);
    eq(t.offset.x, 15);
    eq(t.offset.y, 7);
    eq(t.scale, 2);
  });

  test('화면 맞춤은 도면 중심을 화면 중심에 놓는다', () => {
    const content = { x: 100, y: 200, w: 400, h: 300, midX: 300, midY: 350 };
    const t = fitTransform(content, { w: 800, h: 600 });
    const c = screenPoint(t, { x: content.midX, y: content.midY });
    near(c.x, 400);
    near(c.y, 300);
  });

  test('장비 하나뿐이어도 배율 상한을 넘지 않는다', () => {
    const c = { x: 0, y: 0, w: 10, h: 10, midX: 5, midY: 5 };
    expect(fitTransform(c, { w: 900, h: 900 }).scale <= MAX_SCALE);
  });

  test('빈 도면은 기본 상태를 준다', () => {
    const t = fitTransform({ x: 0, y: 0, w: 0, h: 0, midX: 0, midY: 0 }, { w: 400, h: 400 });
    eq(t.scale, 1);
    eq(t.offset.x, 0);
  });

  test('장비 전체를 감싸는 사각형을 구한다', () => {
    const r = contentBounds([{ x: 0, y: 0 }, { x: 300, y: 200 }]);
    eq(r.x, 0);
    eq(r.x + r.w, 300 + NODE_W);
    eq(r.y + r.h, 200 + NODE_H);
  });

  test('장비가 없으면 빈 사각형이다', () => {
    eq(contentBounds([]).w, 0);
  });
});

// ─────────────────────────────────────────── 격자 정렬

suite('격자 정렬', () => {
  test('가까운 격자점으로 붙는다', () => {
    eq(snapValue(23), 20);
    eq(snapValue(31), 40);
    eq(snapValue(-9), -0);
    eq(snapValue(-11), -20);
  });

  test('이미 격자 위면 그대로다', () => {
    const p = snapPoint({ x: 60, y: 140 });
    eq(p.x, 60);
    eq(p.y, 140);
  });

  test('빈 자리에는 그대로 놓는다', () => {
    const p = freeSpot({ x: 100, y: 100 }, []);
    eq(p.x, 100);
    eq(p.y, 100);
  });

  test('이미 장비가 있으면 비켜 놓는다', () => {
    const p = freeSpot({ x: 100, y: 100 }, [{ x: 100, y: 100 }]);
    expect(p.x > 100);
  });

  test('여러 개가 겹쳐 있어도 빈 자리를 찾는다', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      ({ x: 100 + i * 40, y: 100 + i * 40 }));
    const p = freeSpot({ x: 100, y: 100 }, nodes);
    const 겹침 = nodes.some(n =>
      Math.abs(n.x - p.x) < NODE_W * 0.6 && Math.abs(n.y - p.y) < NODE_H * 0.6);
    eq(겹침, false);
  });

  test('비켜 놓은 자리도 격자 위에 있다', () => {
    const p = freeSpot({ x: 100, y: 100 }, [{ x: 100, y: 100 }]);
    eq(snapPoint(p).x, p.x);
    eq(snapPoint(p).y, p.y);
  });
});

// ─────────────────────────────────────────── 자동 정렬

suite('자동 정렬', () => {
  function 별모양() {
    let g = emptyGraph();
    const hub = Graph.addNode(g, { typeKey: 'hub', label: '허브', x: 0, y: 0 });
    g = hub.graph;
    for (let i = 0; i < 3; i += 1) {
      const n = Graph.addNode(g, { typeKey: 'server', label: `S${i}`, x: 0, y: 0 });
      g = Graph.connect(n.graph, hub.node.id, n.node.id).graph;
    }
    return { g, hub: hub.node.id };
  }

  const 좌표 = (g, label) => g.nodes.find(n => n.label === label);

  test('세로 정렬은 뿌리가 맨 위에 온다', () => {
    const { g, hub } = 별모양();
    const r = autoArrange(g, { root: hub, direction: 'vertical' });
    const h = 좌표(r, '허브');
    for (let i = 0; i < 3; i += 1) expect(h.y < 좌표(r, `S${i}`).y);
    eq(좌표(r, 'S0').y, 좌표(r, 'S1').y);
    expect(좌표(r, 'S0').x < 좌표(r, 'S1').x);
  });

  test('가로 정렬은 뿌리가 맨 왼쪽에 온다', () => {
    const { g, hub } = 별모양();
    const r = autoArrange(g, { root: hub, direction: 'horizontal' });
    const h = 좌표(r, '허브');
    for (let i = 0; i < 3; i += 1) expect(h.x < 좌표(r, `S${i}`).x);
    eq(좌표(r, 'S0').x, 좌표(r, 'S1').x);
  });

  test('부모는 자식들 한가운데에 선다', () => {
    const { g, hub } = 별모양();
    const r = autoArrange(g, { root: hub, direction: 'vertical' });
    const 가운데 = (좌표(r, 'S0').x + 좌표(r, 'S2').x) / 2;
    expect(Math.abs(좌표(r, '허브').x - 가운데) < 20);
  });

  test('고른 장비가 뿌리가 된다', () => {
    let g = emptyGraph();
    const a = Graph.addNode(g, { typeKey: 'modem', label: '모뎀', x: 0, y: 0 });
    const b = Graph.addNode(a.graph, { typeKey: 'hub', label: '허브', x: 0, y: 0 });
    const c = Graph.addNode(b.graph, { typeKey: 'server', label: '서버', x: 0, y: 0 });
    g = Graph.connect(c.graph, a.node.id, b.node.id).graph;
    g = Graph.connect(g, b.node.id, c.node.id).graph;

    const r = autoArrange(g, { root: a.node.id, direction: 'vertical' });
    expect(좌표(r, '모뎀').y < 좌표(r, '허브').y);
    expect(좌표(r, '허브').y < 좌표(r, '서버').y);
  });

  test('지정하지 않으면 연결이 많은 장비가 뿌리다', () => {
    const { g, hub } = 별모양();
    eq(pickRoot(connectedGroup(hub, g), g), hub);
  });

  test('고리가 있어도 겹치지 않게 배치된다', () => {
    let g = emptyGraph();
    const a = Graph.addNode(g, { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const b = Graph.addNode(a.graph, { typeKey: 'hub', label: 'B', x: 0, y: 0 });
    const c = Graph.addNode(b.graph, { typeKey: 'router', label: 'C', x: 0, y: 0 });
    g = Graph.connect(c.graph, a.node.id, b.node.id).graph;
    g = Graph.connect(g, b.node.id, c.node.id).graph;
    g = Graph.connect(g, c.node.id, a.node.id).graph;   // 고리

    const r = autoArrange(g, { root: a.node.id });
    eq(r.nodes.length, 3);
    eq(new Set(r.nodes.map(n => `${n.x},${n.y}`)).size, 3);
  });

  test('떨어진 덩어리는 겹치지 않는다', () => {
    let g = emptyGraph();
    const a1 = Graph.addNode(g, { typeKey: 'server', label: 'A1', x: 0, y: 0 });
    const a2 = Graph.addNode(a1.graph, { typeKey: 'hub', label: 'A2', x: 0, y: 0 });
    g = Graph.connect(a2.graph, a1.node.id, a2.node.id).graph;
    const b1 = Graph.addNode(g, { typeKey: 'router', label: 'B1', x: 0, y: 0 });
    const b2 = Graph.addNode(b1.graph, { typeKey: 'modem', label: 'B2', x: 0, y: 0 });
    g = Graph.connect(b2.graph, b1.node.id, b2.node.id).graph;

    const r = autoArrange(g, { direction: 'vertical' });
    const 첫덩어리최대x = Math.max(좌표(r, 'A1').x, 좌표(r, 'A2').x);
    expect(좌표(r, 'B1').x > 첫덩어리최대x);
  });

  test('정렬 결과는 격자 위에 떨어진다', () => {
    const { g, hub } = 별모양();
    for (const n of autoArrange(g, { root: hub }).nodes) {
      eq(snapPoint({ x: n.x, y: n.y }).x, n.x);
      eq(snapPoint({ x: n.x, y: n.y }).y, n.y);
    }
  });

  test('연결은 그대로 남는다', () => {
    let g = emptyGraph();
    const a = Graph.addNode(g, { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const b = Graph.addNode(a.graph, { typeKey: 'hub', label: 'B', x: 0, y: 0 });
    g = Graph.connect(b.graph, a.node.id, b.node.id, 'fiber').graph;

    const r = autoArrange(g);
    eq(r.edges.length, 1);
    eq(r.edges[0].kind, 'fiber');
  });

  test('빈 도면은 그대로다', () => {
    eq(autoArrange(emptyGraph()).nodes.length, 0);
  });
});

// ─────────────────────────────────────────── 되돌리기

suite('되돌리기 이력', () => {
  test('처음에는 되돌릴 것이 없다', () => {
    const s = new UndoStack();
    eq(s.canUndo, false);
    eq(s.canRedo, false);
  });

  test('한 단계 되돌리면 이전 상태가 나온다', () => {
    const s = new UndoStack();
    s.record(1);
    eq(s.undo(2), 1);
    eq(s.canUndo, false);
    eq(s.canRedo, true);
  });

  test('되돌린 것을 다시 할 수 있다', () => {
    const s = new UndoStack();
    s.record(1);
    s.undo(2);
    eq(s.redo(1), 2);
    eq(s.canUndo, true);
  });

  test('여러 단계를 역순으로 되돌린다', () => {
    const s = new UndoStack();
    [1, 2, 3].forEach(v => s.record(v));
    eq(s.undo(4), 3);
    eq(s.undo(3), 2);
    eq(s.undo(2), 1);
    eq(s.undo(1), null);
  });

  test('되돌린 뒤 새로 바꾸면 다시하기 이력이 사라진다', () => {
    const s = new UndoStack();
    s.record(1);
    s.undo(2);
    eq(s.canRedo, true);
    s.record(1);
    eq(s.canRedo, false);
  });

  test('같은 상태를 연달아 쌓지 않는다', () => {
    const s = new UndoStack();
    s.record(1);
    s.record(1);
    eq(s.past.length, 1);
  });

  test('한도를 넘으면 오래된 것부터 버린다', () => {
    const s = new UndoStack(3);
    [1, 2, 3, 4, 5].forEach(v => s.record(v));
    eq(s.past.length, 3);
    eq(s.past[0], 3);
  });

  test('도면을 담아 되돌릴 수 있다', () => {
    const r = Graph.addNode(emptyGraph(), { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const 원본 = r.graph;
    const s = new UndoStack();
    s.record(원본);
    const 지운뒤 = Graph.removeNode(원본, r.node.id);
    eq(지운뒤.nodes.length, 0);
    eq(s.undo(지운뒤).nodes.length, 1);
  });
});

// ─────────────────────────────────────────── 도면 파일

suite('도면 파일', () => {
  function 서버허브도면() {
    let g = emptyGraph();
    const a = Graph.addNode(g, { typeKey: 'server', label: '서버', x: 0, y: 0 });
    const b = Graph.addNode(a.graph, { typeKey: 'hub', label: '허브', x: 300, y: 0 });
    return Graph.connect(b.graph, a.node.id, b.node.id, 'fiber').graph;
  }

  test('저장했다 불러오면 내용이 같다', () => {
    const f = makeFile({ title: '1공구', graph: 서버허브도면(), equipmentTypes: BUILT_INS });
    const 복원 = decodeFile(encodeFile(f));
    eq(복원.title, '1공구');
    eq(복원.nodes.length, 2);
    eq(복원.edges.length, 1);
    eq(복원.edges[0].kind, 'fiber');
  });

  test('쓰이지 않은 장비 정의는 파일에 담지 않는다', () => {
    const f = makeFile({ title: 'T', graph: 서버허브도면(), equipmentTypes: BUILT_INS });
    eq(f.equipmentTypes.length, 2);
  });

  test('형식이 아닌 파일은 오류를 낸다', () => {
    let 던짐 = false;
    try { decodeFile('이건 도면이 아닙니다'); } catch (e) {
      던짐 = e instanceof FileFormatError;
    }
    eq(던짐, true);
  });

  test('더 새로운 버전의 파일은 거절한다', () => {
    const f = makeFile({ title: 'T', graph: 서버허브도면(), equipmentTypes: BUILT_INS });
    f.version = 99;
    let 던짐 = false;
    try { decodeFile(encodeFile(f)); } catch (e) {
      던짐 = e instanceof FileVersionError;
    }
    eq(던짐, true);
  });
});

// ─────────────────────────────────────────── 장비 정의 병합

suite('장비 정의 병합', () => {
  const 서버 = BUILT_INS.find(t => t.key === 'server');

  test('같은 내용의 장비는 중복 추가되지 않는다', () => {
    const r = EquipmentMerger.merge([서버], [서버]);
    eq(r.equipmentTypes.length, 1);
    eq(r.addedCount, 0);
    eq(Object.keys(r.keyRemap).length, 0);
  });

  test('없던 장비는 그대로 추가된다', () => {
    const 신규 = { key: 'gateway', name: '게이트웨이', iconName: '10_hub', category: 'network' };
    const r = EquipmentMerger.merge([서버], [신규]);
    eq(r.equipmentTypes.length, 2);
    eq(r.addedCount, 1);
  });

  test('key 는 같은데 다른 장비면 새 key 를 발급한다', () => {
    const 남의서버 = { key: 'server', name: '계측서버',
                     iconName: '01_dynamic_logger', category: 'measure' };
    const r = EquipmentMerger.merge([서버], [남의서버]);
    eq(r.equipmentTypes.length, 2);
    expect(r.keyRemap['server'] !== undefined);
    expect(r.keyRemap['server'] !== 'server');
    eq(r.equipmentTypes.find(t => t.key === 'server').name, '서버');
  });

  test('내용이 같은 장비가 다른 key 로 있으면 그쪽으로 연결한다', () => {
    const 다른key = { ...서버, key: 'srv' };
    const r = EquipmentMerger.merge([서버], [다른key]);
    eq(r.equipmentTypes.length, 1);
    eq(r.keyRemap['srv'], 'server');
  });

  test('remap 을 적용하면 노드가 새 key 를 가리킨다', () => {
    const r = Graph.addNode(emptyGraph(), { typeKey: 'server', label: 'A', x: 0, y: 0 });
    const 바뀐 = EquipmentMerger.apply({ server: '계측서버' }, r.graph);
    eq(바뀐.nodes[0].typeKey, '계측서버');
  });

  test('remap 이 비어 있으면 도면이 그대로다', () => {
    const r = Graph.addNode(emptyGraph(), { typeKey: 'server', label: 'A', x: 0, y: 0 });
    eq(EquipmentMerger.apply({}, r.graph).nodes[0].typeKey, 'server');
  });

  test('같은 파일을 두 번 불러도 장비가 늘지 않는다', () => {
    const 남의장비 = { key: 'nas', name: 'NAS', iconName: '07_server', category: 'network' };
    const 한번 = EquipmentMerger.merge(BUILT_INS, [남의장비]);
    const 두번 = EquipmentMerger.merge(한번.equipmentTypes, [남의장비]);
    eq(두번.addedCount, 0);
    eq(두번.equipmentTypes.length, 한번.equipmentTypes.length);
  });
});

// ─────────────────────────────────────────── 지면 배치

suite('지면 배치', () => {
  const 그릴자리 = drawingRect(A4_LANDSCAPE);

  test('세로로 긴 도면은 세로 지면을 고른다', () => {
    eq(preferredPage({ w: 400, h: 1200 }), A4_PORTRAIT);
    eq(preferredPage({ w: 1200, h: 400 }), A4_LANDSCAPE);
  });

  test('정사각형에 가까우면 가로 지면을 쓴다', () => {
    eq(preferredPage({ w: 500, h: 520 }), A4_LANDSCAPE);
  });

  test('머리말·도면·범례가 겹치지 않는다', () => {
    for (const page of [A4_LANDSCAPE, A4_PORTRAIT]) {
      const h = headerRect(page), d = drawingRect(page), l = legendRect(page);
      expect(h.y + h.h <= d.y);
      expect(d.y + d.h <= l.y);
      expect(d.h > 0);
    }
  });

  test('모든 영역이 여백 안에 있다', () => {
    const page = A4_LANDSCAPE;
    for (const r of [headerRect(page), drawingRect(page), legendRect(page)]) {
      expect(r.x >= PAGE_MARGIN);
      expect(r.x + r.w <= page.w - PAGE_MARGIN);
      expect(r.y >= PAGE_MARGIN);
      expect(r.y + r.h <= page.h - PAGE_MARGIN);
    }
  });
});

// ─────────────────────────────────────────── 지면 나누기

suite('지면 나누기', () => {
  const 그릴자리 = drawingRect(A4_LANDSCAPE);
  const rect = (x, y, w, h) => ({ x, y, w, h, midX: x + w / 2, midY: y + h / 2 });

  test('한 장 맞춤은 언제나 한 장이다', () => {
    const g = pageGrid(rect(0, 0, 8000, 5000), null, 그릴자리);
    eq(g.pageCount, 1);
    eq(g.isSinglePage, true);
  });

  test('작은 도면은 100% 여도 한 장이다', () => {
    const g = pageGrid(rect(0, 0, 400, 300), 1.0, 그릴자리);
    eq(g.pageCount, 1);
    eq(g.scale, 1.0);
  });

  test('배율을 올리면 장수가 늘어난다', () => {
    const c = rect(0, 0, 1500, 900);
    expect(pageGrid(c, 2.0, 그릴자리).pageCount >
           pageGrid(c, 0.5, 그릴자리).pageCount);
  });

  test('가로로 넓으면 열이 늘어난다', () => {
    const g = pageGrid(rect(0, 0, 그릴자리.w * 1.5, 그릴자리.h * 0.8), 1.0, 그릴자리);
    eq(g.columns, 2);
    eq(g.rows, 1);
  });

  test('장 번호가 행과 열로 풀린다', () => {
    const g = pageGrid(rect(0, 0, 그릴자리.w * 1.5, 그릴자리.h * 1.5), 1.0, 그릴자리);
    eq(g.columns, 2);
    eq(g.rows, 2);
    eq(pagePosition(g, 0).row, 0);
    eq(pagePosition(g, 1).column, 1);
    eq(pagePosition(g, 2).row, 1);
  });

  test('한 장이면 지면 한가운데에 온다', () => {
    const c = rect(100, 50, 400, 300);
    const g = pageGrid(c, 1.0, 그릴자리);
    const r = pageCanvasRect(g, 0);
    near(r.x + r.w / 2, c.midX);
    near(r.y + r.h / 2, c.midY);
  });

  test('여러 장이면 왼쪽 위부터 채운다', () => {
    const c = rect(100, 50, 그릴자리.w * 1.5, 그릴자리.h * 1.2);
    const g = pageGrid(c, 1.0, 그릴자리);
    expect(g.pageCount > 1);
    const 첫장 = pageCanvasRect(g, 0);
    near(첫장.x, c.x);
    near(첫장.y, c.y);
  });

  test('각 장의 시작점이 그릴 자리 왼쪽 위로 간다', () => {
    const c = rect(0, 0, 그릴자리.w * 1.5, 그릴자리.h * 1.2);
    const g = pageGrid(c, 1.0, 그릴자리);
    for (let i = 0; i < g.pageCount; i += 1) {
      const t = pageTransform(g, i, 그릴자리);
      const r = pageCanvasRect(g, i);
      near(r.x * t.scale + t.offset.x, 그릴자리.minX);
      near(r.y * t.scale + t.offset.y, 그릴자리.minY);
    }
  });

  test('모든 장을 합치면 도면 전체를 덮는다', () => {
    const nodes = Array.from({ length: 24 }, (_, i) =>
      ({ x: (i % 6) * 220, y: Math.floor(i / 6) * 160 }));
    const c = contentBounds(nodes);
    const g = pageGrid(c, 1.0, 그릴자리);

    for (const n of nodes) {
      const p = { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 };
      const 담김 = Array.from({ length: g.pageCount }, (_, i) => pageCanvasRect(g, i))
        .some(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
      expect(담김, '어느 장에도 안 담긴 장비가 있다');
    }
  });

  test('한 장이면 쪽 번호를 붙이지 않는다', () => {
    eq(pageLabel(pageGrid(rect(0, 0, 300, 200), 1.0, 그릴자리), 0), null);
  });

  test('여러 장이면 쪽 번호를 붙인다', () => {
    const g = pageGrid(rect(0, 0, 그릴자리.w * 1.5, 그릴자리.h * 0.8), 1.0, 그릴자리);
    expect(pageLabel(g, 0).includes('1 / 2'));
  });

  test('배율 글자를 숫자로 읽는다', () => {
    near(parseScale('44'), 0.44);
    near(parseScale(' 120 % '), 1.2);
    eq(parseScale('abc'), null);
    eq(parseScale(''), null);
  });

  test('범위를 벗어난 배율은 받지 않는다', () => {
    eq(parseScale('5'), null);
    eq(parseScale('999'), null);
    near(parseScale('10'), 0.1);
    near(parseScale('400'), 4.0);
  });
});

// ─────────────────────────────────────────── 장비 집계

suite('장비 집계', () => {
  /** 서버 2, 허브 1, 동적로거 3 */
  function 도면() {
    let g = emptyGraph();
    const 넣기 = (key, n) => {
      for (let i = 0; i < n; i += 1) {
        g = Graph.addNode(g, { typeKey: key, label: `${key}${i}`, x: 0, y: 0 }).graph;
      }
    };
    넣기('server', 2);
    넣기('hub', 1);
    넣기('dynamic_logger', 3);
    return g;
  }

  test('종류별로 수량을 센다', () => {
    const t = tallyEquipment(도면(), BUILT_INS);
    eq(t.length, 3);
    eq(t.find(x => x.key === 'server').count, 2);
    eq(t.find(x => x.key === 'hub').count, 1);
    eq(t.find(x => x.key === 'dynamic_logger').count, 3);
  });

  test('합계가 장비 수와 같다', () => {
    const g = 도면();
    eq(tallyEquipment(g, BUILT_INS).reduce((s, x) => s + x.count, 0), g.nodes.length);
  });

  test('분류 순서대로 정렬된다', () => {
    const t = tallyEquipment(도면(), BUILT_INS);
    // 계측(dynamic_logger) 이 통신(server, hub) 보다 먼저
    eq(t[0].key, 'dynamic_logger');
  });

  test('장비 정의를 함께 돌려준다', () => {
    const t = tallyEquipment(도면(), BUILT_INS);
    eq(t.find(x => x.key === 'server').type.name, '서버');
  });

  test('정의가 없는 장비도 세되 type 은 null 이다', () => {
    let g = emptyGraph();
    g = Graph.addNode(g, { typeKey: '없는것', label: 'X', x: 0, y: 0 }).graph;
    const t = tallyEquipment(g, BUILT_INS);
    eq(t.length, 1);
    eq(t[0].count, 1);
    eq(t[0].type, null);
  });

  test('빈 도면은 빈 집계다', () => {
    eq(tallyEquipment(emptyGraph(), BUILT_INS).length, 0);
  });

  test('항목이 없으면 집계표 높이가 0 이다', () => {
    eq(tallyHeight(A4_LANDSCAPE, 0), 0);
  });

  test('항목이 늘면 집계표가 높아진다', () => {
    const cols = tallyColumns(A4_LANDSCAPE);
    expect(tallyHeight(A4_LANDSCAPE, cols * 2) > tallyHeight(A4_LANDSCAPE, cols));
  });

  test('한 줄 안에 들어가면 높이가 같다', () => {
    const cols = tallyColumns(A4_LANDSCAPE);
    eq(tallyHeight(A4_LANDSCAPE, 1), tallyHeight(A4_LANDSCAPE, cols));
  });

  test('집계표가 들어가면 도면 자리가 줄어든다', () => {
    const h = tallyHeight(A4_LANDSCAPE, 8);
    expect(drawingRect(A4_LANDSCAPE, h).h < drawingRect(A4_LANDSCAPE, 0).h);
  });

  test('집계표는 도면과 범례 사이에 놓인다', () => {
    const h = tallyHeight(A4_LANDSCAPE, 8);
    const d = drawingRect(A4_LANDSCAPE, h);
    const t = tallyRect(A4_LANDSCAPE, h);
    const l = legendRect(A4_LANDSCAPE);
    expect(d.y + d.h <= t.y, '도면과 집계표가 겹친다');
    expect(t.y + t.h <= l.y, '집계표와 범례가 겹친다');
  });

  test('집계표를 넣어도 여백 안에 머문다', () => {
    const h = tallyHeight(A4_PORTRAIT, 12);
    const t = tallyRect(A4_PORTRAIT, h);
    expect(t.x >= PAGE_MARGIN);
    expect(t.y >= PAGE_MARGIN);
    expect(t.y + t.h <= A4_PORTRAIT.h - PAGE_MARGIN);
  });

  test('세로 지면은 칸이 더 적다', () => {
    expect(tallyColumns(A4_PORTRAIT) < tallyColumns(A4_LANDSCAPE));
  });
});

// ─────────────────────────────────────────── 결과

console.log('');
if (실패 > 0) {
  console.log(실패목록.join('\n'));
  console.log('');
}
console.log(`  ${통과} passed, ${실패} failed`);
console.log('');
process.exit(실패 > 0 ? 1 : 0);
