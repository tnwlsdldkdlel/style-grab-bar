# StyleGrabber 구현 계획 (Implementation Plan)

## 1. 프로젝트 구조

```
StyleGrabber/
├── plugin/                    # Figma 플러그인 (클라이언트)
│   ├── manifest.json          # Figma 플러그인 매니페스트
│   ├── src/
│   │   ├── ui/                # React UI (플러그인 패널)
│   │   │   ├── App.tsx        # 메인 UI 컴포넌트
│   │   │   ├── components/
│   │   │   │   ├── UrlInput.tsx       # Bulk URL 입력 Textarea
│   │   │   │   ├── ProgressBar.tsx    # 처리 진행 상태 표시
│   │   │   │   └── ResultList.tsx     # 결과/에러 로그 출력
│   │   │   └── index.html     # UI 엔트리
│   │   ├── plugin/            # Figma Plugin API (메인 스레드)
│   │   │   ├── controller.ts  # 플러그인 메인 로직
│   │   │   └── tableRenderer.ts  # 캔버스 테이블 생성
│   │   └── types/
│   │       └── index.ts       # 공통 타입 정의
│   ├── tsconfig.json
│   └── package.json
├── server/                    # Proxy Server (CORS 우회 + 파싱)
│   ├── src/
│   │   ├── index.ts           # Express 서버 엔트리
│   │   ├── routes/
│   │   │   └── extract.ts     # /api/extract 엔드포인트
│   │   ├── services/
│   │   │   ├── fetcher.ts     # HTML 페이지 fetch
│   │   │   └── parser.ts      # 타이포그래피/스타일 파싱 엔진
│   │   └── types/
│   │       └── index.ts       # 서버 타입 정의
│   ├── tsconfig.json
│   └── package.json
└── docs/
    ├── prd.md
    └── plan.md
```

## 2. 단계별 구현 계획

### Phase 0: 프로젝트 초기 세팅 ✅

- [x] 모노레포 or 멀티 패키지 구조 결정 및 초기화 (npm workspaces)
- [x] `plugin/` — Figma 플러그인 보일러플레이트 세팅 (TypeScript + React + esbuild)
- [x] `server/` — Express + TypeScript 프로젝트 세팅
- [ ] ESLint, Prettier 등 공통 개발 도구 설정 (후순위)

### Phase 1: Proxy Server 구현 ✅

**1-1. Puppeteer 기반 파서 (`server/src/services/parser.ts`)** ✅
- [x] Puppeteer headless로 페이지 로드 (SPA 대응)
- [x] User-Agent 설정, 타임아웃(15s) 처리
- [x] Computed Style 기반 타이포그래피 추출 (font-family, size, weight, line-height, letter-spacing, color)
- [x] 중복 스타일 제거 및 정규화
- [x] 표준 JSON 스키마 반환

**1-2. API 엔드포인트 (`server/src/routes/extract.ts`)** ✅
- [x] `POST /api/extract` — 단일 URL을 받아 파싱 결과 반환
- [x] URL 유효성 검증
- [x] CORS 헤더 설정
- [x] 에러 시 graceful 응답 (success: false)

### Phase 2: Figma 플러그인 UI 구현 ✅

**2-1. URL 입력 및 추출 (`App.tsx`)** ✅
- [x] Textarea에 줄바꿈으로 구분된 URL 다수 입력
- [x] "추출 시작" 버튼 (처리 중 비활성화)
- [x] UI에서 서버로 순차 요청, 완료 후 Plugin 메인 스레드에 결과 전달

**2-2. 진행 상태 표시 (`ProgressBar.tsx`)** ✅
- [x] 현재 처리 중인 URL 표시
- [x] 전체 진행률 바 (n / total)

**2-3. 결과 로그 (`ResultList.tsx`)** ✅
- [x] URL별 성공/실패 상태 목록
- [x] 성공 시 추출된 스타일 개수, 실패 시 에러 표시

### Phase 3: Figma 캔버스 테이블 렌더링 ✅

**3-1. 테이블 렌더러 (`tableRenderer.ts`)** ✅
- [x] 파싱된 타이포그래피 데이터를 Figma 노드(Frame, Text)로 변환
- [x] 테이블 구조 (헤더 + 데이터 행 + URL 제목)
- [x] 사이트별 테이블을 가로 방향으로 500px 간격 배치
- [x] Color 컬럼에 실제 색상 적용

**3-2. 플러그인 컨트롤러 (`controller.ts`)** ✅
- [x] UI → Plugin "done" 메시지 수신
- [x] 성공 결과만 필터하여 캔버스에 테이블 렌더링
- [x] 완료 알림 (성공/실패 카운트)

### Phase 4: 통합 테스트 및 마무리

- [x] 서버 API 단독 테스트 — example.com (3개 스타일 추출)
- [x] 복잡한 사이트 — github.com (63개 스타일), apple.com (33개 스타일)
- [x] 에러 케이스 — 잘못된 URL (400 응답), URL 미입력 (400 응답)
- [x] 타임아웃 — 접속 불가 IP (15s 후 graceful 에러)
- [x] 404 페이지 — 에러로 처리됨
- [ ] Figma에서 플러그인 로드 후 E2E 테스트 (수동)

## 3. 데이터 스키마

### 추출 결과 (서버 → 플러그인)

```typescript
interface ExtractResult {
  url: string;
  success: boolean;
  error?: string;
  data?: TypographyStyle[];
}

interface TypographyStyle {
  selector: string;        // e.g., "h1", ".title-lg"
  fontFamily: string;      // e.g., "Inter, sans-serif"
  fontSize: number;        // px 단위
  fontWeight: number;      // e.g., 400, 700
  lineHeight: number;      // px 단위
  letterSpacing: number;   // px 단위
  color: string;           // HEX
}
```

## 4. 핵심 기술 결정 사항

| 항목 | 선택 | 근거 |
|------|------|------|
| 서버 프레임워크 | Express | 가벼운 프록시 서버에 적합, 빠른 세팅 |
| HTML 파싱 | Puppeteer (headless) | Computed Style 접근 필요, SPA 대응 |
| 빌드 도구 | esbuild | Figma 플러그인 빌드 속도 최적화 |
| UI 상태관리 | React useState | 단순 UI로 별도 상태관리 라이브러리 불필요 |

## 5. 구현 우선순위

```
Phase 0 (세팅) → Phase 1 (서버) → Phase 2 (UI) → Phase 3 (렌더링) → Phase 4 (통합) → Phase 5~8 (고도화)
```

서버 파싱이 핵심 기능이므로 서버를 먼저 구현하고, 파싱 결과가 안정화되면 플러그인 UI와 캔버스 렌더링을 순차적으로 연결한다.

---

## 6. 고도화 계획 (Visual Enhancement)

기존 텍스트 테이블을 넘어, 피그마 내에서 바로 디자인 가이드로 활용 가능한 시각적 결과물을 생성한다.

### Phase 5: 시각적 요소 추가 (Visual Sampling) ✅

**5-1. 타이포그래피 카드** ✅
- [x] "Aa Bb Cc 123" 샘플 텍스트를 해당 스타일(size, color)로 렌더링
- [x] 속성 정보 그리드 (Font, Size, Weight, LH, LS) 표시
- [x] 셀렉터 태그 + 컬러 스와치를 카드 하단에 배치

**5-2. 컬러 스와치(Swatch)** ✅
- [x] 타이포 카드: 원형 스와치 + HEX 코드 표시
- [x] 컬러 팔레트 섹션: 40x40 사각 스와치 + 사용 횟수 + 적용 셀렉터

### Phase 6: Auto Layout 도입 ✅

- [x] 모든 프레임에 Auto Layout 적용 (`createAutoFrame` 헬퍼)
- [x] `layoutMode`, `itemSpacing`, `padding*`, `primaryAxisSizingMode: AUTO`
- [x] Wrap 레이아웃으로 카드 그리드 구성

### Phase 7: 섹션별 구조화 ✅

- [x] **Typography** / **Color Palette** 섹션 분리
- [x] 섹션 헤더 + 구분선 적용
- [x] 확장 가능한 섹션 구조 (향후 Spacing 추가 용이)

### Phase 8: 비교 요약 대시보드 (Dashboard) ✅

- [x] 2개 이상 사이트 추출 시 캔버스 좌측에 대시보드 자동 생성
- [x] 사이트별 요약 카드: 스타일 수, Primary Font, Font Sizes 분포, Top 3 Colors
- [x] 경쟁사 간 비교 가능한 시각적 구성

---

## 7. 전문가 분석 기능 (Expert Analysis)

디자이너가 추출 결과를 즉시 인사이트로 활용할 수 있도록, 의미론적 분석과 패턴 도출 기능을 추가한다.

### Phase 9: 의미론적 분석 (Semantic Tagging) ✅

- [x] 서버: 셀렉터별 의미 그룹 자동 태깅 (heading, body, interactive, navigation, table, other)
- [x] 플러그인: Typography 섹션을 의미 그룹별 서브 섹션으로 분리 렌더링
- [x] 각 서브 섹션에 그룹명 + 스타일 수 표시

### Phase 10: 사용 빈도 및 규칙 분석 (Pattern Analysis) ✅

**10-1. 사용 빈도 분석** ✅
- [x] 서버: 동일 스타일의 사용 빈도(count) 계산, 빈도순 정렬
- [x] 플러그인: 카드에 빈도 배지 표시 (색상: 10x+ 빨강, 3x+ 초록, 기본 회색)
- [x] 대시보드: "Most Used Styles Top 5" 요약 추가

**10-2. 그리드/스케일 규칙 탐지** ✅
- [x] 서버: font-size, line-height 값의 60% 이상이 8px 또는 4px 배수인지 판별
- [x] 플러그인: 사이트 프레임 상단에 "✓ 8px grid system detected" 배지 표시
- [x] 대시보드 카드에 스케일 시스템 배지 표시

### Phase 11: 비교 분석 모드 (Comparison Mode) ✅

**11-1. 공통/차별 분석** ✅
- [x] 각 사이트별 폰트/컬러/사이즈 세트 수집 후 교집합(공통) / 차집합(고유) 계산
- [x] 대시보드에 "Shared Across All Sites" 섹션 — 공통 폰트, 컬러 스와치, 사이즈 표시
- [x] 사이트별 "Unique to ..." 카드 — 고유 폰트, 컬러 스와치, 사이즈 표시

**11-2. 컴포넌트 규격 추출** ✅
- [x] button, input 등 인터랙티브 요소의 규격(높이, padding, border-radius) 추출
- [x] '인터랙션 시스템 가이드' 섹션으로 캔버스에 렌더링

---

## 8. 디자인 분석 솔루션 고도화 (Design Audit)

단순 추출을 넘어, 디자인 시스템의 일관성과 파편화를 진단하여 의사결정 근거를 제공한다.

### Phase 12: 유사 스타일 그룹핑 — Fragmentation Analysis ✅

**12-1. 유사값 클러스터링 (Clustering)** ✅
- [x] 미세한 차이의 값(예: 17px / 18px)을 설정 가능한 오차 범위 내에서 하나의 '시스템 스타일'로 그룹핑
- [x] 그룹핑 결과를 캔버스에서 시각적으로 묶어 표시 (Base + Variants 구조)

**12-2. 파편화 경고 (Fragmentation Alert)** ✅
- [x] 동일 역할(예: `h3`)인데 스타일이 3개 이상 분산된 경우 '파편화 위험' 배지 표시
- [x] 파편화 수준을 수치화 (예: "h3: 5 variants detected")
- [x] 대시보드 요약에 파편화 경고 카운트 포함

### Phase 13: 의미론적 위계 재구성 — Semantic Hierarchy ✅

**13-1. 역할 기반 그룹핑 강화** ✅
- [x] 기존 Heading / Body / Interactive 분류를 위계(Hierarchy) 중심으로 재구성
- [x] 각 그룹 내에서 사용 빈도 최다 스타일을 'Base Style'로 자동 지정
- [x] 변형 스타일은 Base 하위에 서브 요소로 배치하여 위계 시각화

**13-2. 시스템 뷰 (System View)** ✅
- [x] Heading 그룹: H1 → H2 → H3 → ... 순서로 위계 트리 렌더링
- [x] Body 그룹: Base Body → Small / Large / Caption 등 변형 표시
- [x] Action 그룹: Primary Button → Secondary → Tertiary 위계 표현

### Phase 14: 디자인 진단 리포트 — Design Audit Insights ✅

**14-1. 일관성 배지 (Consistency Badge)** ✅
- [x] 해당 스타일이 사이트 전체에서 80% 이상 일관되게 사용되면 "Consistent" 배지 부여
- [x] 일관성 수치(%) 계산 및 카드에 표시

**14-2. 위계 오류 탐지 (Anomaly Detection)** ✅
- [x] 상위 헤더(h1)보다 하위 헤더(h2, h3)가 더 큰 경우 경고
- [x] 의미 없는 폰트 변형(동일 역할에서 불필요한 font-family 혼용) 탐지
- [x] '시스템 점검 필요' 경고 메시지를 해당 카드에 표시

**14-3. 그리드/스케일 정합성 진단** ✅
- [x] 기존 스케일 탐지(Phase 10)를 확장하여 Type Scale 비율(1.125, 1.25, 1.333 등) 감지
- [x] '시스템적 정합성' 점수를 사이트 프레임 상단에 표시 (예: "System Score: 85%")
- [x] 대시보드에 사이트별 정합성 점수 비교

---

## 9. 리포트 기반 스마트 렌더링 (Smart Rendering)

기존 감사 결과를 기반으로 데이터를 정제하고, 정제된 시스템 뷰와 원본 뷰를 전환할 수 있는 기능을 제공한다.

### Phase 15: 데이터 정제 엔진 — Data Cleaning Engine ✅

**15-1. Threshold 적용** ✅
- [x] Consistency 50% 미만인 스타일은 '비표준'으로 분류
- [x] 비표준 스타일 숨김 처리 옵션 제공

**15-2. Clustering 정제** ✅
- [x] 유사한 값(FontSize ±1px, FontWeight 등)을 빈도수 기반으로 단일 토큰으로 병합
- [x] 병합된 토큰에 대표값 지정

**15-3. Priority Sorting** ✅
- [x] 빈도수(Count)가 높은 순서대로 테이블 상단 배치

### Phase 16: System View 자동 생성 ✅

**16-1. Semantic Mapping** ✅
- [x] 리포트 진단 결과를 바탕으로 h1~h6, body, caption 등의 위계를 가진 '정제된 테이블' 렌더링

**16-2. Insight Tagging** ✅
- [x] 각 스타일 옆에 리포트 결과(예: "Most Consistent", "System Base")를 작은 라벨로 표시

### Phase 17: UI 인터랙션 추가 ✅

**17-1. Cleaned Version 토글** ✅
- [x] "Cleaned Version만 보기" 토글: 전체 추출 데이터와 정제된 시스템 데이터를 전환

---

## 10. 멀티 페이지 통합 렌더링 (Multi-Page Integration)

여러 핵심 페이지(메인, 상세, 폼 등)를 분석하여 서비스 전체의 '진짜 디자인 표준'을 피그마에 시각화한다.

### Phase 18: 멀티 페이지 통합 — Cross-Page Aggregation ✅

**18-1. 데이터 통합 (Data Aggregation)** ✅
- [x] 복수 URL에서 동일한 CSS 속성(selector+fontFamily+fontSize+fontWeight+lineHeight+letterSpacing+color)을 가진 스타일을 병합
- [x] 각 스타일에 어느 페이지(URL)에서 발견되었는지 sourceUrls 추적
- [x] 80% 이상의 페이지에서 발견된 스타일을 'Primary System Token'으로 태깅

**18-2. Global Standard 프레임 렌더링** ✅
- [x] 2개 이상 URL 입력 시 "Global Standard" 프레임 자동 생성
- [x] 교차 페이지 공통 타이포그래피를 의미 그룹별로 카드 렌더링
- [x] 각 카드에 sourceUrls 배지 + Primary System Token 배지 표시
- [x] 교차 페이지 공통 컬러 팔레트 렌더링

**18-3. 교차 페이지 컴포넌트 규격 프레임** ✅
- [x] 여러 페이지에서 공통 발견된 button/input/textarea 규격을 별도 프레임으로 렌더링
- [x] 각 규격에 sourceUrls 태그 표시

---

## 11. v2.0 — Analysis & Insight Suite (Side-by-Side View)

원본 웹 캡처와 분석 리포트를 나란히 배치하여, 디자이너가 시각적 실체와 수치 데이터를 동시에 비교할 수 있도록 한다. (참조: `docs/prd-v2.md`)

> **기존 완료 기능 (v2 PRD 기준)**
> - 2.2 컨텍스트 기반 진단 리포트 → Phase 12~14 (System Score, Font Mix, Fragmentation, Consistency)
> - 2.3 스마트 데이터 정제 → Phase 15~17 (Cleaned Token, System View, 토글)

### Phase 19: 웹사이트 스크린샷 캡처 ✅

**19-1. 서버 — 스크린샷 촬영** ✅
- [x] Puppeteer `page.screenshot({ clip })` 로 전체 페이지 스크린샷 촬영
- [x] viewport 1440×900 고정 (데스크탑 기준)
- [x] 스크린샷을 base64(PNG)로 인코딩하여 API 응답에 포함
- [x] 높이 제한(최대 4096px)으로 과도한 이미지 크기 방지

**19-2. 타입 확장** ✅
- [x] `ExtractResult`에 `screenshot?: string` (base64 데이터) 필드 추가
- [x] `ExtractResult`에 `elementPositions?: ElementPosition[]` 필드 추가
- [x] plugin/server 양쪽 타입 동기화

### Phase 20: Side-by-Side 통합 세션 프레임 ✅

**20-1. 스크린샷 이미지 렌더링** ✅
- [x] base64 이미지를 Figma Image로 변환 (`figma.createImage`)
- [x] 스크린샷을 Frame의 fills(IMAGE)로 적용
- [x] 원본 비율 유지하며 너비 고정(720px) 리사이즈

**20-2. 통합 레이아웃 구성** ✅
- [x] 사이트별 최상위 컨테이너를 Horizontal Auto Layout으로 변경 (Session Frame)
- [x] 좌측: [Visual Capture] 원본 스크린샷 프레임
- [x] 우측: [Analysis Report] 기존 분석 리포트 프레임
- [x] 캡처 프레임 상단에 URL 라벨 + "VISUAL CAPTURE" 배지 표시

### Phase 21: 요소 위치 매핑 및 시각적 어노테이션 ✅

**21-1. 서버 — 요소 바운딩 박스 추출** ✅
- [x] Puppeteer `element.getBoundingClientRect()`로 각 스타일 요소의 위치/크기 추출
- [x] 셀렉터별 대표 요소(가장 상단에 위치한 요소)의 좌표를 수집
- [x] `ElementPosition` 타입 정의 및 API 응답에 포함

**21-2. 플러그인 — 하이라이트 오버레이 렌더링** ✅
- [x] 스크린샷 위에 반투명 색상 오버레이 사각형으로 요소 위치 표시
- [x] 각 오버레이에 셀렉터 라벨(예: "h1", "button") 표기
- [x] 의미 그룹별 색상 구분 (heading=파랑, body=초록, interactive=보라 등)
- [x] 범례(Legend) 행으로 색상-그룹 매핑 표시

---

## 12. 레이아웃 재구성 정확도 개선 (Layout Fidelity)

캡처 이미지와 레이아웃 재구성 결과의 시각적 차이를 줄이기 위한 개선 작업.

### Phase 22: 레이아웃 렌더링 기반 개선 ✅

- [x] 플랫 렌더링: 모든 요소를 rootFrame에 절대좌표로 직접 배치 (중첩 좌표 오차 제거)
- [x] CSS `overflow` 속성 추출 및 Figma `clipsContent` 반영
- [x] z-index 기반 Figma 레이어 순서 정렬
- [x] 뷰포트(1280px) 밖 요소 필터링 + rootFrame 폭 고정

### Phase 23: 누락 시각 요소 복원

CSS background-image, SVG, box-shadow 등 현재 추출하지 못하는 시각 요소를 복원하여 캡처 이미지와의 차이를 최소화한다.

**P0 — CSS `background-image` 캡처** ✅
- [x] 서버: `backgroundImage` 값이 있는 요소 식별 (URL 또는 gradient)
- [x] `LayoutElement`에 `hasBackgroundImage` 플래그 추가
- [x] background-image가 있는 요소를 `<img>`와 동일하게 Puppeteer `element.screenshot()`으로 캡처
- [x] 플러그인: 캡처된 이미지를 Figma IMAGE fill로 적용

**P1 — SVG 요소 캡처** ✅
- [x] 서버: `<svg>` 태그 요소를 식별하고 Puppeteer screenshot으로 캡처
- [x] 플러그인: SVG 캡처 이미지를 Figma IMAGE fill로 적용 (컨테이너 imageData 처리와 통합)

**P2 — `box-shadow` 추출** ✅
- [x] 서버: `boxShadow` computed style 추출
- [x] `LayoutElement`에 `boxShadow` 필드 추가
- [x] 플러그인: CSS box-shadow 파싱 → Figma `effects` (DROP_SHADOW) 변환 적용
- [x] 여러 그림자 지원 (쉼표 분리), inset 그림자 건너뜀, spread 값 반영

**P3 — CSS gradient → Figma gradient** ✅
- [x] 서버: `backgroundImage`에서 gradient 문자열 추출, `gradient` 필드로 전달
- [x] 플러그인: `parseLinearGradient()` — CSS linear-gradient를 Figma GradientPaint로 변환
- [x] 각도 → gradientTransform 매트릭스 변환, 색상 stop 파싱 (hex + rgba 지원)
- [x] imageData 캡처가 없는 경우 fallback으로 Figma 네이티브 gradient 적용
