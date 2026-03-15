# StyleGrabber Handoff

## 프로젝트 개요

Figma 플러그인으로, URL을 입력하면 해당 웹사이트의 타이포그래피/컬러 스타일을 추출하여 Figma 캔버스에 디자인 가이드 형태로 자동 생성한다.

## 기술 스택

- **모노레포:** npm workspaces (`plugin/`, `server/`)
- **Plugin:** TypeScript + React 18 + esbuild (target: es2017)
- **Server:** TypeScript + Express + Puppeteer (headless)
- **빌드:** `npm run build:plugin` / `npm run build:server`

## 실행 방법

```bash
cd StyleGrabber
npm install
npm run build:server && npm start --workspace=server   # 서버 (localhost:3001)
npm run build:plugin                                     # 플러그인 빌드
```

Figma → Plugins → Development → Import plugin from manifest → `plugin/manifest.json` 선택

## 완료된 기능 (Phase 0~11)

### 핵심 파이프라인
- **서버 파싱** — Puppeteer로 페이지 로드 후 Computed Style 기반 타이포그래피 추출
- **API** — `POST /api/extract` (단일 URL → 스타일 JSON 반환)
- **플러그인 UI** — URL 다수 입력, 진행 상태 바, 성공/실패 결과 목록
- **캔버스 렌더링** — 사이트별 디자인 가이드 프레임 자동 생성

### 시각적 고도화
- **타이포그래피 카드** — 샘플 텍스트 미리보기 + 속성 그리드 + 컬러 스와치 + 빈도 배지
- **컬러 팔레트 섹션** — 사각 스와치 + 사용 횟수 + 적용 셀렉터
- **Auto Layout** — 모든 프레임에 적용, 수정해도 레이아웃 유지
- **섹션 구조화** — Typography(의미 그룹별 분리) / Color Palette

### 분석 기능
- **의미론적 태깅** — heading, body, interactive, navigation, table, other 자동 분류
- **사용 빈도** — count 기반 정렬, 빈도 배지 (10x+ 빨강, 3x+ 초록)
- **그리드 탐지** — 8px/4px 스케일 시스템 감지 시 배지 표시
- **비교 대시보드** — 2개+ 사이트 시 좌측에 자동 생성 (요약 카드 + 공통/고유 비교)

## 주요 파일

| 파일 | 역할 |
|------|------|
| `server/src/services/parser.ts` | Puppeteer 기반 스타일 파서 (count, semanticGroup, scaleSystem) |
| `server/src/routes/extract.ts` | REST API 엔드포인트 |
| `plugin/src/plugin/tableRenderer.ts` | Figma 캔버스 렌더링 (카드, 팔레트, 대시보드, 비교 분석) |
| `plugin/src/plugin/controller.ts` | 플러그인 메인 컨트롤러 |
| `plugin/src/ui/App.tsx` | React UI (URL 입력 + 서버 요청 + 진행 상태) |
| `plugin/src/types/index.ts` | 공유 타입 (TypographyStyle, ExtractResult, SemanticGroup) |
| `plugin/build.mjs` | esbuild 빌드 스크립트 (JS 인라인 → ui.html) |

## 알려진 제약/이슈

- Figma 플러그인 샌드박스에서 `?.`, `??` 문법 사용 불가 → esbuild target `es2017`로 고정
- 서버가 로컬(`localhost:3001`)에서 실행되어야 플러그인이 동작
- Puppeteer가 SPA를 완전히 로드하지 못하는 경우 일부 스타일 누락 가능

## 완료된 추가 기능 (Phase 11-2~14)

- **컴포넌트 규격 추출** — button/input/textarea의 height, padding, border-radius, 배경색, 테두리 추출 및 캔버스 렌더링
- **유사 스타일 클러스터링** — fontSize/fontWeight/lineHeight 오차 범위 내 유사 스타일을 Base + Variants로 그룹핑, 캔버스에 시각적 표시
- **파편화 경고** — 동일 셀렉터에서 3개 이상 스타일 분산 시 경고 배지 (5개+ = HIGH RISK)
- **의미론적 위계 (System View)** — 그룹별 Base Style 자동 지정, Heading은 H1→H6 순서로 위계 트리 렌더링
- **일관성 배지** — 셀렉터별 일관성 80% 이상이면 "Consistent" 배지를 타이포그래피 카드에 표시
- **위계 오류 탐지** — 하위 헤딩이 상위보다 큰 경우, 동일 역할 내 폰트 혼용 감지
- **Type Scale 비율 감지** — 1.067~1.618 범위의 알려진 비율 자동 탐지
- **시스템 정합성 점수** — 0~100점 시스템 점수를 사이트 프레임 상단 + 대시보드에 표시

## 스마트 렌더링 (Phase 15~17)

- **데이터 정제 엔진** — Consistency 50% 미만 비표준 필터링, 유사값(±1px) 빈도 기반 병합, 빈도순 정렬
- **System View 자동 생성** — 정제된 위계 테이블 + Insight Tag("System Base", "Most Consistent", "High Usage") 배지
- **Cleaned Version 토글** — UI 체크박스로 원본/정제 뷰 전환, 정제 모드 시 버튼 보라색 변경

## 멀티 페이지 통합 (Phase 18)

- **교차 페이지 집계** — 복수 URL에서 동일 CSS 속성 스타일을 병합, sourceUrls 추적
- **Primary System Token** — 80% 이상 페이지에서 발견된 스타일에 "PRIMARY TOKEN" 배지 부여
- **Global Standard 프레임** — 2개+ URL 시 교차 페이지 공통 타이포/컬러를 별도 프레임으로 렌더링
- **교차 페이지 컴포넌트 규격** — 공통 발견된 button/input/textarea 규격을 별도 프레임으로 렌더링

## v2.0 Side-by-Side View (Phase 19~21)

- **스크린샷 캡처** — Puppeteer로 페이지 캡처(JPEG 60%, viewport 1280×800, 최대 높이 2048px), base64로 API 응답에 포함
- **Side-by-Side 레이아웃** — 사이트별로 좌측 [Visual Capture] + 우측 [Analysis Report]를 Horizontal Auto Layout 세션 컨테이너로 구성
- **시각적 어노테이션** — 스크린샷 위에 의미 그룹별 색상(heading=파랑, body=초록, interactive=보라 등) 반투명 오버레이 + 셀렉터 라벨 표시
- **postMessage 분리 전략** — 스크린샷 데이터를 메인 결과와 분리하여 개별 전송 (Figma iframe 크기 제한 대응)

## v2.1 풀페이지 캡처 + 속성 오버레이 (Phase 22)

### 풀페이지 청크 캡처
- **청크 분할 캡처** — 서버에서 페이지를 1200px 단위로 분할 캡처 (JPEG 30%), `screenshotChunks: string[]`로 API 응답
- **개별 청크 전송** — UI에서 각 청크를 `screenshot-chunk` 메시지로 개별 postMessage 전송 (Figma 크기 제한 우회)
- **청크 수집 및 조립** — controller에서 모든 청크 수신 완료 후 세로로 이어붙여 풀페이지 이미지 구성
- **세션 프레임** — 캡처 + 디자인 시스템을 하나의 배경 프레임(Session)으로 묶어 시각적 그룹화

### 속성 오버레이 (클릭 → 디자인 탭 확인)
- **투명 오버레이 프레임** — 스크린샷 위 요소 위치에 투명 프레임 배치, Figma에서 클릭 시 선택 가능
- **프레임 이름에 CSS 속성** — `h1 | SUIT 32px Bold / 40px #1f2429` 형태로 폰트/사이즈/웨이트/색상 표시
- **의미 그룹별 색상** — heading=파랑, body=초록, interactive=보라 등 반투명 배경 + 테두리
- **셀렉터 라벨 태그** — 각 요소 위에 컬러 라벨로 HTML 태그명 표시

### Figma postMessage 데이터 전달 해결
- `figma.base64Decode` 미동작 → UI에서 base64 전송 시 Figma가 자동으로 바이트 배열로 변환하는 현상 발견
- 쉼표 구분 바이트 값 문자열(`"255,216,255,..."`) 또는 Uint8Array 등 다양한 수신 형태를 모두 처리하도록 controller 방어 코드 적용
- `ArrayBuffer`/`Uint8Array` 직접 전송 시 postMessage 드롭 → base64 문자열 전송 방식 유지

## 코드 품질 개선 (/simplify)

- **parser.ts** — `detectFragmentation` 이중 호출 제거, `groupBySelector` 유틸 추출, System Base 태그 O(1) Set 조회
- **tableRenderer.ts** — `createTextNode`, `createDivider`, `getScoreColor`, `createPropsGrid` 헬퍼 추출, 중복 `groupOrder` 제거

## 알려진 제약/이슈 (추가)

- `figma.base64Decode`가 대용량 base64에서 실패 → base64 문자열 전송 후 Figma 자동 변환에 의존
- `figma.createImage`에 이미지 크기 제한 있음 → 1200px 단위 청크 분할로 대응
- 스크린샷 JPEG 30% 압축으로 캡처 화질이 낮을 수 있음
- `plugin/src/types`와 `server/src/types`에 타입이 중복 정의됨 (공유 패키지 미적용)
- 풀페이지 캡처 시 청크 수가 많아지면 postMessage 전송 횟수 증가
