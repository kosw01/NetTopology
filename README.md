# 망구성도 — 웹

장비와 장비의 연결 관계를 그림으로 정리하는 도구.
iOS 앱 **망구성도**와 **같은 JSON 파일**을 읽고 씁니다.

## 쓰는 법

<https://kosw01.github.io/NetTopology/>

- 폰에서 만든 도면을 `JSON` 으로 내보내 여기서 열 수 있습니다.
- 여기서 만든 도면도 같은 형식으로 내보내 폰에서 열립니다.
- 자료는 브라우저 안에만 저장됩니다. 서버로 아무것도 보내지 않습니다.

## 조작

| 하고 싶은 것 | 방법 |
| --- | --- |
| 화면 이동 | 빈 곳 끌기 |
| 확대·축소 | 휠, 트랙패드 핀치, 두 손가락 |
| 화면 맞춤 | 빈 곳 두 번 클릭 |
| 장비 옮기기 | 카드 끌기 (격자에 붙음) |
| 연결 만들기 | 카드 클릭 → 좌우 파란 손잡이를 다른 카드로 끌기 |
| 연결 고르기 | 선 근처 클릭 |
| 되돌리기 | `⌘Z` / `Ctrl+Z` |
| 다시 하기 | `⇧⌘Z` / `Ctrl+Shift+Z` |
| 삭제 | 고른 뒤 `Delete` |
| 선택 해제 | `Esc` |

## 인쇄

`인쇄` 버튼 → 배율을 정하고 → `인쇄 / PDF`.

브라우저 인쇄 대화상자에서 **대상을 "PDF로 저장"** 으로 고르면 PDF가 됩니다.
여백은 **없음**, 배경 그래픽은 **켬**으로 두세요.

배율을 올려 한 장에 안 담기면 표 계산 프로그램의 인쇄처럼 여러 장으로 나뉩니다.
이어 붙이면 큰 도면이 됩니다.

## 구조

화면과 순수 로직을 나눠 두었습니다. iOS · 안드로이드와 규칙을 맞추기 위해서입니다.

| 파일 | 역할 | iOS 대응 |
| --- | --- | --- |
| `js/topology.js` | 노드·연결 규칙 | `Topology.swift` |
| `js/equipment.js` | 장비 정의, 목록 편집, 병합 | `Equipment.swift` 외 |
| `js/edge-router.js` | 연결선 경로, 짚기 판정 | `EdgeRouter.swift` |
| `js/layout.js` | 좌표 변환, 격자, 자동 정렬, 되돌리기 | `CanvasTransform.swift` 외 |
| `js/page.js` | 파일 포맷, 지면 배치, 다중 장 | `TopologyFile.swift` 외 |
| `js/store.js` | 저장 (localStorage) | `DiagramRecord.swift` |
| `js/canvas.js` | 캔버스 그리기·조작 | `DiagramCanvasView.swift` |
| `js/preview.js` | 인쇄 지면 | `DiagramPageView.swift` |
| `js/app.js` | 화면 흐름 | `DiagramListView.swift` 외 |
| `js/icons.js` | 장비 아이콘 21종 | `EquipmentIcons.xcassets` |

## 테스트

```
node test.mjs
```

순수 로직 92개. iOS 의 Swift Testing 과 같은 항목을 확인합니다.

## 파일 형식

```json
{
  "version": 1,
  "title": "도면 이름",
  "savedAt": "2026-08-23T12:00:00.000Z",
  "equipmentTypes": [
    { "key": "server", "name": "서버", "iconName": "07_server",
      "category": "network", "isBuiltIn": true, "isHidden": false }
  ],
  "nodes": [
    { "id": "UUID", "typeKey": "server", "label": "1층 서버",
      "note": "포트 3번", "x": 120, "y": 240 }
  ],
  "edges": [
    { "id": "UUID", "from": "UUID", "to": "UUID", "kind": "data" }
  ]
}
```

도면이 쓰는 **장비 정의를 파일 안에 함께 싣습니다.**
받는 쪽에 그 장비가 없어도 도면이 온전히 열립니다.
`key` 가 같은데 내용이 다르면 새 항목으로 갈라 넣어 기존 도면이 깨지지 않습니다.
