// 도면 파일 포맷과 인쇄 지면 배치.
// iOS 의 TopologyFile / PageLayout / PageTiler 와 같다.

import { Graph } from './topology.js';
import { makeTransform, clampScale } from './layout.js';

// ─────────────────────────────────────────── 파일 포맷

export const FILE_VERSION = 1;

/** 세 플랫폼(iOS·안드로이드·웹)이 공유하는 도면 파일. */
export function makeFile({ title, graph, equipmentTypes, savedAt = new Date() }) {
  // 실제로 쓰인 장비만 담는다.
  const 쓰인키 = Graph.usedTypeKeys(graph);
  return {
    version: FILE_VERSION,
    title,
    savedAt: savedAt.toISOString(),
    equipmentTypes: equipmentTypes.filter(t => 쓰인키.has(t.key)),
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

export function encodeFile(file) {
  return JSON.stringify(file, null, 2);
}

export class FileFormatError extends Error {}
export class FileVersionError extends Error {}

export function decodeFile(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new FileFormatError('도면 파일 형식이 아닙니다.');
  }

  if (!obj || typeof obj !== 'object' ||
      !Array.isArray(obj.nodes) || !Array.isArray(obj.edges) ||
      typeof obj.version !== 'number') {
    throw new FileFormatError('도면 파일 형식이 아닙니다.');
  }

  if (obj.version > FILE_VERSION) {
    throw new FileVersionError(`이 앱보다 새로운 형식의 파일입니다. (버전 ${obj.version})`);
  }

  return {
    version: obj.version,
    title: String(obj.title ?? ''),
    savedAt: obj.savedAt ?? null,
    equipmentTypes: Array.isArray(obj.equipmentTypes) ? obj.equipmentTypes : [],
    nodes: obj.nodes,
    edges: obj.edges,
  };
}

export function fileGraph(file) {
  return { nodes: file.nodes, edges: file.edges };
}

// ─────────────────────────────────────────── 지면

/** A4 (72dpi 기준 포인트) */
export const A4_LANDSCAPE = { w: 842, h: 595 };
export const A4_PORTRAIT  = { w: 595, h: 842 };

export const PAGE_MARGIN = 36;
export const HEADER_H = 56;
export const LEGEND_H = 34;

/** 장비가 적을 때 지나치게 확대되지 않게 막는다. */
export const PAGE_MAX_SCALE = 1.4;

/** 도면이 세로로 길면 세로 지면을 쓴다. */
export function preferredPage(content) {
  if (content.w <= 0 || content.h <= 0) return A4_LANDSCAPE;
  return content.h > content.w * 1.15 ? A4_PORTRAIT : A4_LANDSCAPE;
}

export function headerRect(page) {
  return { x: PAGE_MARGIN, y: PAGE_MARGIN,
           w: page.w - PAGE_MARGIN * 2, h: HEADER_H };
}

export function legendRect(page) {
  return { x: PAGE_MARGIN, y: page.h - PAGE_MARGIN - LEGEND_H,
           w: page.w - PAGE_MARGIN * 2, h: LEGEND_H };
}

/** 집계표 한 줄 높이와 머리 높이. */
export const TALLY_ROW_H = 17;
export const TALLY_HEAD_H = 17;

/** 지면 폭에 따라 집계표를 몇 칸으로 늘어놓을지. */
export function tallyColumns(page) {
  return page.w >= 700 ? 4 : 3;
}

/** 집계표가 차지할 높이. 항목이 없으면 0. */
export function tallyHeight(page, itemCount) {
  if (itemCount <= 0) return 0;
  const rows = Math.ceil(itemCount / tallyColumns(page));
  return TALLY_HEAD_H + rows * TALLY_ROW_H + 8;
}

/** 집계표가 놓일 자리. 범례 바로 위. */
export function tallyRect(page, tallyH) {
  const bottom = page.h - PAGE_MARGIN - LEGEND_H - 6;
  return { x: PAGE_MARGIN, y: bottom - tallyH,
           w: page.w - PAGE_MARGIN * 2, h: tallyH };
}

/**
 * 도면이 들어갈 자리. 머리말과 (집계표·범례) 사이.
 * tallyH 는 모든 장에서 같아야 바둑판 분할이 어긋나지 않는다.
 */
export function drawingRect(page, tallyH = 0) {
  const top = PAGE_MARGIN + HEADER_H + 12;
  const bottom = page.h - PAGE_MARGIN - LEGEND_H - 12 - tallyH;
  return { x: PAGE_MARGIN, y: top,
           w: page.w - PAGE_MARGIN * 2, h: Math.max(0, bottom - top),
           minX: PAGE_MARGIN, minY: top,
           midX: PAGE_MARGIN + (page.w - PAGE_MARGIN * 2) / 2,
           midY: (top + bottom) / 2 };
}

// ─────────────────────────────────────────── 인쇄 배율

export const SCALE_MIN_PERCENT = 10;
export const SCALE_MAX_PERCENT = 400;

/** null 이면 한 장에 맞춰 자동으로 정한다. */
export const SCALE_FIT = null;

export const SCALE_PRESETS = [SCALE_FIT, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

export function scaleName(v) {
  return v === null ? '한 장 맞춤' : `${Math.round(v * 100)}%`;
}

/** 입력한 글자를 배율로 바꾼다. 숫자가 아니면 null. */
export function parseScale(text) {
  const 숫자만 = String(text ?? '').replace(/[^0-9]/g, '');
  if (숫자만 === '') return null;
  const p = parseInt(숫자만, 10);
  if (p < SCALE_MIN_PERCENT || p > SCALE_MAX_PERCENT) return null;
  return p / 100;
}

/** 이보다 많아지면 화면에서 경고한다. */
export const WARN_PAGE_COUNT = 12;

/**
 * 도면을 여러 장으로 나눈다. 표 계산 프로그램의 인쇄처럼 바둑판으로 자른다.
 * 한 장이면 지면 한가운데에, 여러 장이면 왼쪽 위부터 채운다.
 */
export function pageGrid(content, scale, drawing) {
  if (content.w <= 0 || content.h <= 0 || drawing.w <= 0 || drawing.h <= 0) {
    return { columns: 1, rows: 1, scale: 1, pageCount: 1, isSinglePage: true,
             tile: { w: drawing.w, h: drawing.h }, origin: { x: 0, y: 0 } };
  }

  const s = scale ?? Math.min(
    Math.min(drawing.w / content.w, drawing.h / content.h), PAGE_MAX_SCALE);

  const tile = { w: drawing.w / s, h: drawing.h / s };
  const cols = Math.max(1, Math.ceil(content.w / tile.w - 0.0001));
  const rows = Math.max(1, Math.ceil(content.h / tile.h - 0.0001));

  const origin = (cols === 1 && rows === 1)
    ? { x: content.midX - tile.w / 2, y: content.midY - tile.h / 2 }
    : { x: content.x, y: content.y };

  return { columns: cols, rows, scale: s, tile, origin,
           pageCount: cols * rows, isSinglePage: cols * rows === 1 };
}

/** 장 번호를 행·열로. 왼쪽에서 오른쪽, 그다음 아래로. */
export function pagePosition(grid, index) {
  return { row: Math.floor(index / grid.columns), column: index % grid.columns };
}

/** 그 장이 담는 도면 영역. */
export function pageCanvasRect(grid, index) {
  const p = pagePosition(grid, index);
  return {
    x: grid.origin.x + p.column * grid.tile.w,
    y: grid.origin.y + p.row * grid.tile.h,
    w: grid.tile.w, h: grid.tile.h,
  };
}

/** 그 장을 그릴 때 쓸 좌표 변환. */
export function pageTransform(grid, index, drawing) {
  const r = pageCanvasRect(grid, index);
  return {
    scale: grid.scale,
    offset: { x: drawing.minX - r.x * grid.scale,
              y: drawing.minY - r.y * grid.scale },
  };
}

export function pageLabel(grid, index) {
  if (grid.isSinglePage) return null;
  const p = pagePosition(grid, index);
  return `${index + 1} / ${grid.pageCount} · ${p.row + 1}행 ${p.column + 1}열`;
}
