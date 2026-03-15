# StyleGrabber 작업 핸드오프

## 작업 요약

웹사이트에서 추출한 스타일을 Figma에서 **이미지가 아닌 개별 노드**로 확인할 수 있도록 3단계에 걸쳐 기능을 추가하고, 코드 품질을 개선했다.

---

## 1. B단계 — 실제 스타일 속성 적용

**변경 파일:** `plugin/src/plugin/tableRenderer.ts`

- 샘플 텍스트("Aa Bb Cc 123")에 추출된 fontSize, fontWeight, lineHeight, letterSpacing, color를 실제 적용
- CSS fontWeight(100~900)를 Figma style 이름(Thin, Regular, Bold 등)으로 매핑하는 `weightToStyle()` 추가
- `tryLoadFont()` — 추출된 폰트 로드 시도, 대체 이름 변형("SemiBold" → "Semibold" 등) 시도 후 실패 시 Inter fallback
- `preloadFonts()` — 렌더링 전 모든 고유 폰트를 사전 로드

## 2. C단계 — Figma 스타일 등록

**변경 파일:** `plugin/src/plugin/tableRenderer.ts`

- `registerFigmaStyles()` — `figma.createTextStyle()` / `figma.createPaintStyle()`로 Figma 스타일 패널에 등록
  - Text Style 이름 규칙: `사이트명/그룹/폰트명 크기/weight`
  - Paint Style 이름 규칙: `사이트명/Colors/#HEX`
- 샘플 텍스트 노드에 `textStyleId` / `fillStyleId`로 연결 → 클릭 시 속성 패널에서 확인 가능

## 3. Layout Reconstruction 모드

웹 페이지의 DOM 요소를 Figma 개별 노드(프레임/텍스트)로 재구성하는 신규 모드.

### 서버

| 파일 | 내용 |
|------|------|
| `server/src/types/index.ts` | `LayoutElement` 인터페이스 추가 (26개 필드) |
| `server/src/services/parser.ts` | `parseLayout()` — BFS로 DOM 순회, 최대 500개 요소의 위치/크기/스타일 추출 |
| `server/src/routes/extract.ts` | `POST /api/extract-layout` 엔드포인트 추가 |

### 플러그인

| 파일 | 내용 |
|------|------|
| `plugin/src/types/index.ts` | `LayoutElement` 타입 + `PluginMessage`에 `layoutMode` 추가 |
| `plugin/src/plugin/tableRenderer.ts` | `renderLayout()` — LayoutElement[]를 Figma 노드로 재구성 |
| `plugin/src/plugin/controller.ts` | `layoutMode` 분기 추가 |
| `plugin/src/ui/App.tsx` | "Style Analysis" / "Layout Reconstruction" 라디오 버튼, 엔드포인트 분기 |

### 렌더링 규칙

- **컨테이너** → `FrameNode` (배경색, 보더 적용)
- **텍스트** → `FrameNode` + `TextNode` (실제 폰트/크기/색상 적용)
- **이미지** → 회색 플레이스홀더 + "Image" 라벨
- 모든 요소는 원본 웹 페이지와 동일한 좌표에 절대 배치

## 4. 코드 품질 개선 (/simplify)

| 문제 | 수정 |
|------|------|
| `findElementById` O(n^2) | `elementMap` 사전 빌드로 O(1) lookup |
| 샘플 텍스트/속성 그리드/컬러 스와치 2~3회 복붙 | `createSampleText()`, `createStylePropsGrid()`, `createColorSwatchRow()` 헬퍼 추출 |
| 부모 배치 + 박스 스타일 적용 3회 반복 | `placeInParent()`, `applyBoxStyle()` 헬퍼 추출 |
| `getLocalStyles()` 매 사이트마다 호출 | `buildExistingStyleMaps()` 1회 호출 후 전달 |
| Puppeteer 브라우저 실행 보일러플레이트 중복 | `openPage()` 공유 헬퍼 추출 |
| URL 검증 중복 | `validateUrl` Express 미들웨어로 추출 |

---

## 알려진 제한사항

- **폰트**: Figma에 설치되지 않은 웹폰트는 Inter로 fallback되며, 속성 그리드에 "(fallback)" 표시
- **이미지**: `<img>` 요소는 실제 이미지가 아닌 회색 플레이스홀더로 표시
- **타입 동기화**: `LayoutElement`가 `server/src/types`와 `plugin/src/types` 양쪽에 수동 정의되어 있어 변경 시 양쪽 동기화 필요
- **Layout 모드**: 스크린샷 전송 없음, 최대 500개 요소 제한, DOM 깊이 12단계 제한
