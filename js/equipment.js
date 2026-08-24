// 장비 정의. iOS 의 Equipment.swift / EquipmentEditor.swift 와 같은 규칙이다.

import { ICON_NAMES } from './icons.js';

/** 장비 분류. 노드 색상 계열을 결정한다. */
export const CATEGORIES = ['measure', 'network', 'power', 'etc'];

export const CATEGORY_NAMES = {
  measure: '계측 / 로거',
  network: '통신 / 시스템',
  power: '전원',
  etc: '기타',
};

export const DEFAULT_ICON = '18_etc_gear';

export { ICON_NAMES as ALL_ICON_NAMES };

/** 기본 17종. 첫 실행 때 심는다. */
export const BUILT_INS = [
  { key: 'dynamic_logger',    name: '동적로거',        iconName: '01_dynamic_logger',    category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'static_logger',     name: '정적로거',        iconName: '02_static_logger',     category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'time_sync',         name: '시각동기장치',    iconName: '03_syn_time_sync',     category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'bus_comm',          name: '버스통신장치',    iconName: '04_bco_bus_comm',      category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'data_acq',          name: '데이터수집장치',  iconName: '05_ucl_data_acq',      category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'expander',          name: '신호확장기',      iconName: '06_mdi_expander',      category: 'measure', isBuiltIn: true, isHidden: false },
  { key: 'server',            name: '서버',            iconName: '07_server',            category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'modem',             name: '인터넷 모뎀',     iconName: '08_internet_modem',    category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'router',            name: '라우터',          iconName: '09_router',            category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'hub',               name: '허브',            iconName: '10_hub',               category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'optical_converter', name: '광 컨버터',       iconName: '11_optical_converter', category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'remote_switch',     name: '원격제어 스위치', iconName: '12_remote_switch',     category: 'network', isBuiltIn: true, isHidden: false },
  { key: 'ups',               name: 'UPS',             iconName: '13_ups',               category: 'power',   isBuiltIn: true, isHidden: false },
  { key: 'solar_panel',       name: '태양광 패널',     iconName: '14_solar_panel',       category: 'power',   isBuiltIn: true, isHidden: false },
  { key: 'battery_bank',      name: '축전기',          iconName: '15_battery_bank',      category: 'power',   isBuiltIn: true, isHidden: false },
  { key: 'cctv',              name: 'CCTV',            iconName: '16_cctv',              category: 'etc',     isBuiltIn: true, isHidden: false },
  { key: 'camera',            name: '카메라',          iconName: '17_camera',            category: 'etc',     isBuiltIn: true, isHidden: false },
];

/** 이름에서 key 를 뽑는다. 겹치면 뒤에 번호를 붙인다. */
export function makeKey(name, existing) {
  const base = String(name ?? '').trim().replace(/ /g, '_');
  const seed = base === '' ? 'custom' : base;
  if (!existing.has(seed)) return seed;

  let n = 2;
  while (existing.has(`${seed}_${n}`)) n += 1;
  return `${seed}_${n}`;
}

export const EquipmentEditor = {
  /** 새 장비를 목록 끝에 붙인다. */
  add(list, { name, iconName, category }) {
    const 정리 = String(name ?? '').trim();
    if (정리 === '') return list;

    const key = makeKey(정리, new Set(list.map(t => t.key)));
    return [...list, {
      key, name: 정리, iconName, category,
      isBuiltIn: false, isHidden: false,
    }];
  },

  /** 이름·아이콘·분류를 고친다. key 는 바꾸지 않는다 — 도면이 그걸 가리키고 있다. */
  update(list, key, { name, iconName, category }) {
    const 정리 = String(name ?? '').trim();
    return list.map(t => t.key !== key ? t : {
      ...t,
      name: 정리 === '' ? t.name : 정리,
      iconName, category,
    });
  },

  /**
   * 목록에서 감추거나 다시 꺼낸다. 실제로 지우지 않는 이유는
   * 이미 도면에 쓰인 장비가 사라지면 그 도면이 깨지기 때문이다.
   */
  setHidden(list, key, hidden) {
    return list.map(t => t.key !== key ? t : { ...t, isHidden: hidden });
  },

  /** 사용자가 만든 장비만 진짜로 지울 수 있다. */
  remove(list, key) {
    const t = list.find(x => x.key === key);
    if (!t || t.isBuiltIn) return list;
    return list.filter(x => x.key !== key);
  },
};

/** 두 정의가 같은 장비인지. 이름·아이콘·분류가 모두 같으면 같은 것으로 본다. */
export function sameEquipment(a, b) {
  return a.name === b.name && a.iconName === b.iconName && a.category === b.category;
}

export const EquipmentMerger = {
  /**
   * 파일의 장비 정의를 기존 목록에 합친다.
   * key 가 같은데 내용이 다르면 새 key 를 발급하고 remap 에 기록한다.
   */
  merge(existing, incoming) {
    let result = [...existing];
    const keyRemap = {};
    let addedCount = 0;

    for (const t of incoming) {
      const found = result.find(x => x.key === t.key);

      if (found) {
        if (sameEquipment(found, t)) continue;   // 그대로 쓴다

        // key 충돌 — 내용이 다르므로 새 key 로 넣는다.
        const 새키 = makeKey(t.name, new Set(result.map(x => x.key)));
        result.push({ ...t, key: 새키, isBuiltIn: false, isHidden: false });
        keyRemap[t.key] = 새키;
        addedCount += 1;
      } else {
        // 내용이 같은 장비가 다른 key 로 이미 있으면 그쪽으로 연결한다.
        const 동일 = result.find(x => sameEquipment(x, t));
        if (동일) {
          keyRemap[t.key] = 동일.key;
          continue;
        }
        result.push({ ...t, isBuiltIn: false, isHidden: false });
        addedCount += 1;
      }
    }

    return { equipmentTypes: result, keyRemap, addedCount };
  },

  /** remap 에 따라 노드의 typeKey 를 바꾼다. */
  apply(remap, graph) {
    if (Object.keys(remap).length === 0) return graph;
    return {
      nodes: graph.nodes.map(n =>
        remap[n.typeKey] ? { ...n, typeKey: remap[n.typeKey] } : n),
      edges: graph.edges,
    };
  },
};

/**
 * 도면에 쓰인 장비를 종류별로 센다.
 * 분류 순서 → 목록에 담긴 순서로 정렬해 인쇄물에서 순서가 흔들리지 않게 한다.
 */
export function tallyEquipment(graph, types) {
  const 셈 = new Map();
  for (const n of graph.nodes) {
    셈.set(n.typeKey, (셈.get(n.typeKey) ?? 0) + 1);
  }

  const 순서 = new Map(types.map((t, i) => [t.key, i]));

  return [...셈.entries()]
    .map(([key, count]) => ({
      key,
      count,
      type: types.find(t => t.key === key) ?? null,
    }))
    .sort((a, b) => {
      const ca = CATEGORIES.indexOf(a.type?.category ?? 'etc');
      const cb = CATEGORIES.indexOf(b.type?.category ?? 'etc');
      if (ca !== cb) return ca - cb;
      return (순서.get(a.key) ?? 0) - (순서.get(b.key) ?? 0);
    });
}
