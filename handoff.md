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
| `server/src/types/index.ts` | `LayoutElement` 인터페이스 추가 (27개 필드, imageData 포함) |
| `server/src/services/parser.ts` | `parseLayout()` — BFS DOM 순회 + `<img>` 요소 screenshot 캡쳐 |
| `server/src/routes/extract.ts` | `POST /api/extract-layout` 엔드포인트 + `validateUrl` 미들웨어 |

### 플러그인

| 파일 | 내용 |
|------|------|
| `plugin/src/types/index.ts` | `LayoutElement` 타입 + `PluginMessage`에 `layoutMode` 추가 |
| `plugin/src/plugin/tableRenderer.ts` | `renderLayout()` — LayoutElement[]를 Figma 노드로 재구성 |
| `plugin/src/plugin/controller.ts` | `layoutMode` 분기 + 디버그 로그 추가 |
| `plugin/src/ui/App.tsx` | "Style Analysis" / "Layout Reconstruction" 모드 선택 UI |

### 렌더링 규칙

- **컨테이너** → `FrameNode` (배경색, 보더 적용)
- **텍스트** → `FrameNode` + `TextNode` (실제 폰트/크기/색상 적용)
- **이미지** → `imageData`가 있으면 `figma.createImage()`로 실제 이미지 삽입, 없으면 회색 플레이스홀더
- 모든 요소는 원본 웹 페이지와 동일한 좌표에 절대 배치

## 4. 코드 품질 개선 (/simplify)

| 문제 | 수정 |
|------|------|
| `findElementById` O(n^2) | `elementMap` 사전 빌드로 O(1) lookup |
| 샘플 텍스트/속성 그리드/컬러 스와치 복붙 | `createSampleText()`, `createStylePropsGrid()`, `createColorSwatchRow()` 헬퍼 추출 |
| 부모 배치 + 박스 스타일 적용 3회 반복 | `placeInParent()`, `applyBoxStyle()` 헬퍼 추출 |
| `getLocalStyles()` 매 사이트마다 호출 | `buildExistingStyleMaps()` 1회 호출 후 전달 |
| Puppeteer 브라우저 실행 보일러플레이트 중복 | `openPage()` 공유 헬퍼 추출 |
| URL 검증 중복 | `validateUrl` Express 미들웨어로 추출 |

## 5. 디버깅 및 기타

- `controller.ts` / `App.tsx`에 `[StyleGrabber]`, `[UI]` 디버그 로그 추가 (Figma 콘솔에서 확인 가능)
- `/api/extract-layout` 404 이슈 → 서버 재빌드+재시작으로 해결
- `CLAUDE.md`에 커밋 시 Co-Authored-By 미포함 규칙 추가
- GitHub 푸시 완료: `github.com/tnwlsdldkdlel/style-grab-bar`

---

## 6. 레이아웃 렌더링 정확도 개선

캡처 이미지와 Figma 레이아웃이 불일치하는 문제를 수정.

### 문제 원인

- **중첩 렌더링 좌표 오차**: 자식을 부모 프레임 안에 넣고 상대좌표(`child.x - parent.x`)를 계산하는 방식에서, 깊은 중첩(content 영역)일수록 반올림 오차가 누적되고, 중간 부모가 렌더링 조건에 안 맞아 `nodeMap`에 없으면 좌표계가 불일치
- **Figma 기본 clipsContent=true**: 웹의 기본 overflow는 visible이지만 Figma Frame은 기본적으로 자식을 클리핑 → 부모 밖으로 나가는 요소가 안 보임
- **z-index 미적용**: 추출은 하지만 Figma 레이어 순서에 반영하지 않음

### 수정 내용

| 파일 | 변경 |
|------|------|
| `server/src/types/index.ts` | `LayoutElement`에 `overflow` 필드 추가 |
| `plugin/src/types/index.ts` | 동일 |
| `server/src/services/parser.ts` | CSS `overflow` 속성 추출 추가 |
| `plugin/src/plugin/tableRenderer.ts` | 플랫 렌더링 + overflow 반영 + z-index 정렬 |

- **플랫 렌더링**: 모든 요소를 부모-자식 중첩 없이 rootFrame에 절대좌표로 직접 배치 → `getBoundingClientRect()` 좌표를 그대로 사용하여 캡처와 일치
- **overflow 반영**: `applyBoxStyle()`에서 `overflow: hidden/clip/scroll/auto`인 경우만 `clipsContent = true`, 나머지는 `false`
- **z-index 정렬**: DOM 순서 + z-index 기준으로 Figma 레이어 순서 정렬

---

## 7. Semantic Layout (Auto Layout) 모드

절대 좌표 배치 대신 Figma Auto Layout으로 웹 레이아웃을 재구성하는 모드.

### 핵심 구조

- `server/src/services/parser.ts` — `parseSemanticLayout()`: 재귀 DFS로 DOM → `LayoutNode` 트리 변환
- `plugin/src/plugin/tableRenderer.ts` — `renderSemanticLayout()` / `renderNode()`: LayoutNode → Figma Auto Layout 프레임
- `server/src/routes/extract.ts` — `POST /api/extract-semantic-layout` 엔드포인트
- `plugin/src/ui/App.tsx` — "Auto Layout" 모드 라디오 버튼 추가

### CSS → Figma 매핑

| CSS | Figma |
|-----|-------|
| `display:flex` direction | `layoutMode: HORIZONTAL/VERTICAL` |
| `gap` | `itemSpacing` |
| `justify-content: space-between` | `primaryAxisAlignItems: SPACE_BETWEEN` |
| `align-items: center` | `counterAxisAlignItems: CENTER` |
| `margin: 0 auto` | 부모 `counterAxisAlignItems: CENTER` + 자식 FIXED width |
| `flex-wrap: wrap` + gap | `layoutWrap: WRAP` + `counterAxisSpacing` |
| 부모 대비 90%+ 너비 | `layoutSizingHorizontal: FILL` |
| `linear-gradient()` (var() fallback, rgba alpha 포함) | `GRADIENT_LINEAR` paint |

### 주요 해결한 문제들

- **widthMode 감지**: `getComputedStyle().width`는 항상 px → 부모 콘텐츠 영역 대비 비율로 fill/fixed/hug 판단
- **simplifyTree 래퍼 제거 시 정렬 손실**: `crossAxisAlign`, `mainAxisAlign`, `gap`, `isCentered` 보존 조건 추가
- **텍스트 누락 (혼합 콘텐츠)**: `<p>텍스트<span>자식</span>텍스트</p>` 구조에서 직접 텍스트 노드가 버려짐 → `childNodes` 순회하여 synthetic text leaf 생성
- **`display: initial`**: 인라인 태그(`span`, `a`, `em` 등)가 block으로 잘못 처리됨 → 태그 기반 인라인 감지 추가
- **margin:auto 감지 강화**: 인라인 스타일 + shorthand + 위치 기반(양쪽 margin 동일) 3중 감지
- **gradient 파싱 개선**: `var()` fallback 색상 추출, `rgba(.5)` alpha 처리, 중첩 괄호 파싱

---

## 알려진 제한사항

- **폰트**: Figma에 설치되지 않은 웹폰트는 Inter로 fallback되며, 속성 그리드에 "(fallback)" 표시
- **이미지**: `<img>` 최대 30개까지 캡쳐 (JPEG quality 50), 나머지는 플레이스홀더
- **타입 동기화**: `LayoutElement`/`LayoutNode`가 `server/src/types`와 `plugin/src/types` 양쪽에 수동 정의 — 변경 시 양쪽 동기화 필요
- **Layout 모드**: 최대 500개 요소, DOM 깊이 12단계 제한
- **미지원 CSS**: transform, pseudo-elements(::before/::after)
