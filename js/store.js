// 브라우저 저장소. iOS 의 DiagramRecord / EquipmentStore 에 해당한다.
// SwiftData 대신 localStorage 를 쓰되, 담기는 내용과 규칙은 같다.

import { BUILT_INS } from './equipment.js';
import { Graph, emptyGraph, uuid } from './topology.js';
import { makeFile, encodeFile, decodeFile, fileGraph } from './page.js';

const KEY_DIAGRAMS = 'nettopo.diagrams';
const KEY_TYPES = 'nettopo.equipmentTypes';

function 읽기(key, 기본값) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? 기본값 : JSON.parse(raw);
  } catch {
    return 기본값;
  }
}

function 쓰기(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 저장 공간이 가득 찼거나 사생활 보호 모드일 수 있다.
    return false;
  }
}

export const Store = {
  // ─────────────────────── 장비 정의

  types() {
    const list = 읽기(KEY_TYPES, null);
    if (!Array.isArray(list) || list.length === 0) {
      쓰기(KEY_TYPES, BUILT_INS);
      return [...BUILT_INS];
    }
    return list;
  },

  /** 목록에 보여줄 장비. 숨긴 것은 뺀다. */
  visibleTypes() {
    return Store.types().filter(t => !t.isHidden);
  },

  typeFor(key) {
    return Store.types().find(t => t.key === key) ?? null;
  },

  saveTypes(list) {
    return 쓰기(KEY_TYPES, list);
  },

  // ─────────────────────── 도면

  /** 최근 수정 순. */
  diagrams() {
    const list = 읽기(KEY_DIAGRAMS, []);
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  },

  diagram(id) {
    return Store.diagrams().find(d => d.id === id) ?? null;
  },

  saveAll(list) {
    return 쓰기(KEY_DIAGRAMS, list);
  },

  /** 같은 이름이 있으면 뒤에 번호를 붙인다. */
  uniqueTitle(원본) {
    const 정리 = String(원본 ?? '').trim();
    const 기준 = 정리 === '' ? '이름 없는 도면' : 정리;
    const 있는것 = new Set(Store.diagrams().map(d => d.title));

    if (!있는것.has(기준)) return 기준;
    let n = 2;
    while (있는것.has(`${기준} (${n})`)) n += 1;
    return `${기준} (${n})`;
  },

  create(title, graph = emptyGraph()) {
    const d = {
      id: uuid(),
      title: Store.uniqueTitle(title),
      graph,
      updatedAt: Date.now(),
    };
    Store.saveAll([d, ...읽기(KEY_DIAGRAMS, [])]);
    return d;
  },

  update(id, patch) {
    const list = 읽기(KEY_DIAGRAMS, []);
    const next = list.map(d => d.id !== id ? d
      : { ...d, ...patch, updatedAt: Date.now() });
    Store.saveAll(next);
    return next.find(d => d.id === id) ?? null;
  },

  rename(id, title) {
    const 정리 = String(title ?? '').trim();
    return Store.update(id, { title: 정리 === '' ? '이름 없는 도면' : 정리 });
  },

  remove(id) {
    Store.saveAll(읽기(KEY_DIAGRAMS, []).filter(d => d.id !== id));
  },

  duplicate(id) {
    const d = Store.diagram(id);
    if (!d) return null;
    return Store.create(`${d.title} 사본`, d.graph);
  },

  // ─────────────────────── 파일

  /** 내보낼 JSON 글자. */
  exportText(id) {
    const d = Store.diagram(id);
    if (!d) return null;
    return encodeFile(makeFile({
      title: d.title,
      graph: d.graph,
      equipmentTypes: Store.types(),
    }));
  },

  /**
   * 파일을 읽어 도면을 만든다.
   * 파일이 들고 온 장비 정의를 기존 목록에 합치고,
   * key 가 갈렸으면 도면이 새 key 를 가리키게 한다.
   */
  importText(text, merger) {
    const file = decodeFile(text);
    const merged = merger.merge(Store.types(), file.equipmentTypes);
    Store.saveTypes(merged.equipmentTypes);

    const graph = merger.apply(merged.keyRemap, fileGraph(file));
    const d = Store.create(file.title, graph);

    return {
      diagram: d,
      addedCount: merged.addedCount,
      remapCount: Object.keys(merged.keyRemap).length,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    };
  },

  /** 모든 자료를 지운다. */
  reset() {
    localStorage.removeItem(KEY_DIAGRAMS);
    localStorage.removeItem(KEY_TYPES);
  },
};
