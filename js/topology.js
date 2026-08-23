// 도면 자료구조와 규칙. iOS 의 Topology.swift 와 같다.

/** 연결선 종류. */
export const EDGE_KINDS = ['data', 'fiber', 'power'];

export const EDGE_KIND_NAMES = {
  data: '데이터',
  fiber: '광케이블',
  power: '전원',
};

/** 브라우저 기본 UUID. 구형 환경 대비로 대체 구현을 둔다. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function makeNode({ typeKey, label, note = '', x, y, id = uuid() }) {
  return { id, typeKey, label, note, x, y };
}

export function hasNote(node) {
  return String(node.note ?? '').trim() !== '';
}

export function makeEdge({ from, to, kind = 'data', id = uuid() }) {
  return { id, from, to, kind };
}

/** 방향을 무시한 비교. */
export function edgeConnects(e, a, b) {
  return (e.from === a && e.to === b) || (e.from === b && e.to === a);
}

export function emptyGraph() {
  return { nodes: [], edges: [] };
}

/**
 * 도면 한 장의 내용. 모든 함수가 새 객체를 돌려주므로
 * 되돌리기 이력에 그대로 쌓을 수 있다.
 */
export const Graph = {
  node(g, id) {
    return g.nodes.find(n => n.id === id) ?? null;
  },

  edge(g, id) {
    return g.edges.find(e => e.id === id) ?? null;
  },

  /** 해당 장비에 붙은 모든 연결. */
  edgesOf(g, nodeID) {
    return g.edges.filter(e => e.from === nodeID || e.to === nodeID);
  },

  /** 도면에서 실제로 쓰이고 있는 장비 종류 key 들. */
  usedTypeKeys(g) {
    return new Set(g.nodes.map(n => n.typeKey));
  },

  addNode(g, { typeKey, label, x, y }) {
    const node = makeNode({ typeKey, label, x, y });
    return { graph: { nodes: [...g.nodes, node], edges: g.edges }, node };
  },

  moveNode(g, id, x, y) {
    return {
      nodes: g.nodes.map(n => n.id === id ? { ...n, x, y } : n),
      edges: g.edges,
    };
  },

  updateNode(g, id, { label, note }) {
    return {
      nodes: g.nodes.map(n => {
        if (n.id !== id) return n;
        const m = { ...n };
        if (label !== undefined && label !== null) m.label = label;
        if (note !== undefined && note !== null) m.note = note;
        return m;
      }),
      edges: g.edges,
    };
  },

  /** 장비를 지우면 거기 붙은 연결도 함께 사라진다. */
  removeNode(g, id) {
    return {
      nodes: g.nodes.filter(n => n.id !== id),
      edges: g.edges.filter(e => e.from !== id && e.to !== id),
    };
  },

  /**
   * 자기 자신과의 연결과 이미 있는 연결은 만들지 않는다.
   * 만들지 못하면 edge 가 null 이다.
   */
  connect(g, a, b, kind = 'data') {
    if (a === b) return { graph: g, edge: null };
    if (!Graph.node(g, a) || !Graph.node(g, b)) return { graph: g, edge: null };
    if (g.edges.some(e => edgeConnects(e, a, b))) return { graph: g, edge: null };

    const edge = makeEdge({ from: a, to: b, kind });
    return { graph: { nodes: g.nodes, edges: [...g.edges, edge] }, edge };
  },

  setEdgeKind(g, id, kind) {
    return {
      nodes: g.nodes,
      edges: g.edges.map(e => e.id === id ? { ...e, kind } : e),
    };
  },

  removeEdge(g, id) {
    return { nodes: g.nodes, edges: g.edges.filter(e => e.id !== id) };
  },
};
