import puppeteer from "puppeteer";
import type {
  TypographyStyle,
  SemanticGroup,
  ComponentSpec,
  AuditResult,
  StyleCluster,
  FragmentationWarning,
  HierarchyNode,
  Anomaly,
  CleanedStyle,
  CleanedData,
  ElementPosition,
  LayoutElement,
  LayoutNode,
} from "../types";

const TIMEOUT = 15_000;

const SEMANTIC_MAP: Record<string, SemanticGroup> = {
  h1: "heading", h2: "heading", h3: "heading",
  h4: "heading", h5: "heading", h6: "heading",
  p: "body", span: "body", blockquote: "body",
  figcaption: "body", caption: "body",
  a: "navigation", li: "navigation",
  td: "table", th: "table",
  button: "interactive", input: "interactive",
  textarea: "interactive", label: "interactive",
};

const HEADING_ORDER = ["h1", "h2", "h3", "h4", "h5", "h6"];

function detectScaleSystem(styles: TypographyStyle[]): string | null {
  const sizes: number[] = [];
  for (const s of styles) {
    if (sizes.indexOf(s.fontSize) === -1) sizes.push(s.fontSize);
    if (sizes.indexOf(s.lineHeight) === -1) sizes.push(s.lineHeight);
  }

  for (const base of [8, 4]) {
    let match = 0;
    for (const v of sizes) {
      if (v > 0 && Math.abs(v % base) < 0.5) match++;
    }
    const ratio = match / sizes.length;
    if (ratio >= 0.6) return base + "px";
  }
  return null;
}

// ── 공통 유틸 ──

function groupBySelector(styles: TypographyStyle[]): Record<string, TypographyStyle[]> {
  const bySelector: Record<string, TypographyStyle[]> = {};
  for (const s of styles) {
    if (!bySelector[s.selector]) bySelector[s.selector] = [];
    bySelector[s.selector].push(s);
  }
  return bySelector;
}

// ── Phase 12: 유사 스타일 클러스터링 ──

const CLUSTER_TOLERANCE = {
  fontSize: 2,
  fontWeight: 100,
  lineHeight: 3,
  letterSpacing: 0.5,
};

function clusterStyles(styles: TypographyStyle[]): StyleCluster[] {
  const used = new Set<number>();
  const clusters: StyleCluster[] = [];

  // 빈도순 정렬 (가장 많이 사용된 스타일이 base)
  const sorted = [...styles].sort((a, b) => b.count - a.count);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const base = sorted[i];
    const variants: TypographyStyle[] = [];

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const candidate = sorted[j];

      // 같은 의미 그룹이고, 폰트 패밀리가 같고, 수치가 유사한 경우
      if (
        candidate.semanticGroup === base.semanticGroup &&
        candidate.fontFamily === base.fontFamily &&
        Math.abs(candidate.fontSize - base.fontSize) <= CLUSTER_TOLERANCE.fontSize &&
        Math.abs(candidate.fontWeight - base.fontWeight) <= CLUSTER_TOLERANCE.fontWeight &&
        Math.abs(candidate.lineHeight - base.lineHeight) <= CLUSTER_TOLERANCE.lineHeight &&
        Math.abs(candidate.letterSpacing - base.letterSpacing) <= CLUSTER_TOLERANCE.letterSpacing
      ) {
        variants.push(candidate);
        used.add(j);
      }
    }

    if (variants.length > 0) {
      clusters.push({ baseStyle: base, variants });
      used.add(i);
    }
  }

  return clusters;
}

// ── Phase 12-2: 파편화 경고 ──

function detectFragmentation(styles: TypographyStyle[]): FragmentationWarning[] {
  const bySelector = groupBySelector(styles);

  const warnings: FragmentationWarning[] = [];
  for (const [selector, selectorStyles] of Object.entries(bySelector)) {
    // 같은 셀렉터에서 3개 이상 다른 스타일이 있으면 파편화
    if (selectorStyles.length >= 3) {
      warnings.push({
        selector,
        variantCount: selectorStyles.length,
        styles: selectorStyles,
      });
    }
  }

  return warnings.sort((a, b) => b.variantCount - a.variantCount);
}

// ── Phase 13: 의미론적 위계 재구성 ──

function buildHierarchy(styles: TypographyStyle[]): Record<string, HierarchyNode[]> {
  const groups: Record<string, TypographyStyle[]> = {};
  for (const s of styles) {
    const group = s.semanticGroup || "other";
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  }

  const hierarchy: Record<string, HierarchyNode[]> = {};

  for (const [group, groupStyles] of Object.entries(groups)) {
    // 셀렉터별로 분류
    const byRole: Record<string, TypographyStyle[]> = {};
    for (const s of groupStyles) {
      if (!byRole[s.selector]) byRole[s.selector] = [];
      byRole[s.selector].push(s);
    }

    const nodes: HierarchyNode[] = [];
    for (const [role, roleStyles] of Object.entries(byRole)) {
      // 빈도순으로 정렬, 가장 많이 쓰인 것이 base
      const sorted = [...roleStyles].sort((a, b) => b.count - a.count);
      nodes.push({
        role,
        baseStyle: sorted[0],
        variants: sorted.slice(1),
      });
    }

    // heading인 경우 h1 → h2 → h3 순으로 정렬
    if (group === "heading") {
      nodes.sort((a, b) => {
        const ai = HEADING_ORDER.indexOf(a.role);
        const bi = HEADING_ORDER.indexOf(b.role);
        return ai - bi;
      });
    }

    hierarchy[group] = nodes;
  }

  return hierarchy;
}

// ── Phase 14-1: 일관성 계산 ──

function calculateConsistency(styles: TypographyStyle[]): Record<string, number> {
  const bySelector = groupBySelector(styles);

  const consistencyMap: Record<string, number> = {};
  for (const [selector, selectorStyles] of Object.entries(bySelector)) {
    const totalCount = selectorStyles.reduce((sum, s) => sum + s.count, 0);
    // base style = most frequent
    const maxCount = Math.max(...selectorStyles.map((s) => s.count));
    consistencyMap[selector] = totalCount > 0 ? Math.round((maxCount / totalCount) * 100) : 0;
  }

  return consistencyMap;
}

// ── Phase 14-2: 위계 오류 탐지 ──

function detectAnomalies(styles: TypographyStyle[], fragmentations: FragmentationWarning[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // 1. 위계 역전 탐지: h1 < h2, h2 < h3 등
  const headingStyles: Record<string, TypographyStyle> = {};
  for (const s of styles) {
    if (HEADING_ORDER.includes(s.selector)) {
      if (!headingStyles[s.selector] || s.count > headingStyles[s.selector].count) {
        headingStyles[s.selector] = s;
      }
    }
  }

  for (let i = 0; i < HEADING_ORDER.length - 1; i++) {
    const upper = headingStyles[HEADING_ORDER[i]];
    const lower = headingStyles[HEADING_ORDER[i + 1]];
    if (upper && lower && lower.fontSize > upper.fontSize) {
      anomalies.push({
        type: "hierarchy_inversion",
        message: `${HEADING_ORDER[i + 1]} (${lower.fontSize}px) is larger than ${HEADING_ORDER[i]} (${upper.fontSize}px)`,
        severity: "error",
        selectors: [HEADING_ORDER[i], HEADING_ORDER[i + 1]],
      });
    }
  }

  // 2. 폰트 혼용 탐지: 같은 역할에서 2개 이상의 font-family 사용
  const fontsBySelector: Record<string, Set<string>> = {};
  for (const s of styles) {
    if (!fontsBySelector[s.selector]) fontsBySelector[s.selector] = new Set();
    const primary = s.fontFamily.split(",")[0].trim().replace(/"/g, "");
    fontsBySelector[s.selector].add(primary);
  }

  for (const [selector, fonts] of Object.entries(fontsBySelector)) {
    if (fonts.size >= 2) {
      anomalies.push({
        type: "font_mixing",
        message: `${selector} uses ${fonts.size} different fonts: ${[...fonts].join(", ")}`,
        severity: "warning",
        selectors: [selector],
      });
    }
  }

  // 3. 파편화 경고
  for (const f of fragmentations) {
    if (f.variantCount >= 5) {
      anomalies.push({
        type: "fragmentation",
        message: `${f.selector}: ${f.variantCount} variants detected — high fragmentation`,
        severity: "error",
        selectors: [f.selector],
      });
    } else {
      anomalies.push({
        type: "fragmentation",
        message: `${f.selector}: ${f.variantCount} variants detected`,
        severity: "warning",
        selectors: [f.selector],
      });
    }
  }

  return anomalies;
}

// ── Phase 14-3: Type Scale 비율 감지 ──

const KNOWN_RATIOS: { name: string; value: number }[] = [
  { name: "Minor Second", value: 1.067 },
  { name: "Major Second", value: 1.125 },
  { name: "Minor Third", value: 1.2 },
  { name: "Major Third", value: 1.25 },
  { name: "Perfect Fourth", value: 1.333 },
  { name: "Augmented Fourth", value: 1.414 },
  { name: "Perfect Fifth", value: 1.5 },
  { name: "Golden Ratio", value: 1.618 },
];

function detectTypeScaleRatio(styles: TypographyStyle[]): number | null {
  const fontSizes = [...new Set(styles.map((s) => s.fontSize))].sort((a, b) => a - b);
  if (fontSizes.length < 3) return null;

  // 연속된 쌍의 비율을 계산
  const ratios: number[] = [];
  for (let i = 0; i < fontSizes.length - 1; i++) {
    if (fontSizes[i] > 0) {
      ratios.push(fontSizes[i + 1] / fontSizes[i]);
    }
  }

  // 각 알려진 비율과 비교
  for (const known of KNOWN_RATIOS) {
    let matchCount = 0;
    for (const r of ratios) {
      if (Math.abs(r - known.value) < 0.08) matchCount++;
    }
    if (matchCount / ratios.length >= 0.5) {
      return known.value;
    }
  }

  return null;
}

// ── Phase 14-3: 시스템 정합성 점수 ──

function calculateSystemScore(
  styles: TypographyStyle[],
  scaleSystem: string | null,
  typeScaleRatio: number | null,
  anomalies: Anomaly[],
  fragmentations: FragmentationWarning[],
  consistencyMap: Record<string, number>
): number {
  let score = 100;

  // 스케일 시스템 여부 (+0 or -10)
  if (!scaleSystem) score -= 10;

  // Type scale 비율 감지 (+0 or -10)
  if (!typeScaleRatio) score -= 10;

  // anomalies 감점
  for (const a of anomalies) {
    if (a.severity === "error") score -= 8;
    else score -= 4;
  }

  // 파편화 감점
  for (const f of fragmentations) {
    score -= Math.min(f.variantCount, 5) * 2;
  }

  // 일관성 보너스/감점
  const consistencies = Object.values(consistencyMap);
  if (consistencies.length > 0) {
    const avgConsistency = consistencies.reduce((a, b) => a + b, 0) / consistencies.length;
    if (avgConsistency < 50) score -= 15;
    else if (avgConsistency < 70) score -= 8;
  }

  return Math.max(0, Math.min(100, score));
}

// ── Phase 14: 전체 감사 ──

function auditStyles(styles: TypographyStyle[], scaleSystem: string | null): AuditResult {
  const clusters = clusterStyles(styles);
  const fragmentations = detectFragmentation(styles);
  const hierarchy = buildHierarchy(styles);
  const consistencyMap = calculateConsistency(styles);
  const anomalies = detectAnomalies(styles, fragmentations);
  const typeScaleRatio = detectTypeScaleRatio(styles);
  const systemScore = calculateSystemScore(
    styles,
    scaleSystem,
    typeScaleRatio,
    anomalies,
    fragmentations,
    consistencyMap
  );

  return {
    systemScore,
    typeScaleRatio,
    anomalies,
    clusters,
    fragmentations,
    hierarchy,
    consistencyMap,
  };
}

// ── Phase 15: 데이터 정제 엔진 ──

const MERGE_TOLERANCE = {
  fontSize: 1,
  fontWeight: 0,
  lineHeight: 2,
  letterSpacing: 0.3,
};

function cleanStyles(
  styles: TypographyStyle[],
  consistencyMap: Record<string, number>,
  hierarchy: Record<string, HierarchyNode[]>
): CleanedData {
  let removedCount = 0;
  let mergedCount = 0;

  // 15-1: Consistency 50% 미만인 스타일을 비표준으로 필터링
  const standardStyles: TypographyStyle[] = [];
  for (const s of styles) {
    const consistency = consistencyMap[s.selector];
    if (consistency !== undefined && consistency < 50) {
      removedCount++;
    } else {
      standardStyles.push(s);
    }
  }

  // Pre-build System Base lookup set for O(1) checks
  const baseStyleKeys = new Set<string>();
  for (const group of Object.values(hierarchy)) {
    for (const node of group) {
      const bs = node.baseStyle;
      baseStyleKeys.add(`${bs.selector}|${bs.fontSize}|${bs.fontWeight}|${bs.fontFamily}`);
    }
  }

  // 15-2: 유사 값 병합 (FontSize ±1px 내 동일 fontFamily+selector를 빈도 기반으로 병합)
  const merged: CleanedStyle[] = [];
  const used = new Set<number>();

  // 빈도순 정렬
  const sorted = [...standardStyles].sort((a, b) => b.count - a.count);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;
    const base = sorted[i];
    let totalCount = base.count;
    let absorbed = 0;

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const candidate = sorted[j];

      if (
        candidate.selector === base.selector &&
        candidate.fontFamily === base.fontFamily &&
        Math.abs(candidate.fontSize - base.fontSize) <= MERGE_TOLERANCE.fontSize &&
        Math.abs(candidate.fontWeight - base.fontWeight) <= MERGE_TOLERANCE.fontWeight &&
        Math.abs(candidate.lineHeight - base.lineHeight) <= MERGE_TOLERANCE.lineHeight &&
        Math.abs(candidate.letterSpacing - base.letterSpacing) <= MERGE_TOLERANCE.letterSpacing
      ) {
        totalCount += candidate.count;
        absorbed++;
        used.add(j);
      }
    }

    used.add(i);

    // 인사이트 태그 생성
    const insightTags: string[] = [];

    // System Base: O(1) lookup
    if (baseStyleKeys.has(`${base.selector}|${base.fontSize}|${base.fontWeight}|${base.fontFamily}`)) {
      insightTags.push("System Base");
    }

    // Most Consistent
    const cons = consistencyMap[base.selector];
    if (cons !== undefined && cons >= 90) {
      insightTags.push("Most Consistent");
    } else if (cons !== undefined && cons >= 80) {
      insightTags.push("Consistent");
    }

    // High Usage
    if (totalCount >= 10) {
      insightTags.push("High Usage");
    }

    if (absorbed > 0) {
      mergedCount += absorbed;
    }

    merged.push({
      ...base,
      count: totalCount,
      insightTags,
      mergedFrom: absorbed > 0 ? absorbed + 1 : undefined,
    });
  }

  // 15-3: 빈도수 높은 순서대로 정렬
  merged.sort((a, b) => b.count - a.count);

  return { styles: merged, removedCount, mergedCount };
}

// ── 공용 브라우저 헬퍼 ──

const VIEWPORT = { width: 1920, height: 1080 };
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function openPage(url: string): Promise<{ browser: Awaited<ReturnType<typeof puppeteer.launch>>; page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>> }> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT });
  return { browser, page };
}

// ── 메인 파서 ──

const MAX_SCREENSHOT_HEIGHT = 2048;

export async function parseTypography(url: string): Promise<{
  styles: TypographyStyle[];
  scaleSystem: string | null;
  componentSpecs: ComponentSpec[];
  audit: AuditResult;
  cleanedData: CleanedData;
  screenshot: string;
  screenshotChunks: string[];
  elementPositions: ElementPosition[];
}> {
  const { browser, page } = await openPage(url);

  try {

    const { rawStyles, rawComponentSpecs } = await page.evaluate(() => {
      const TEXT_SELECTORS = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "span", "a", "li", "td", "th",
        "label", "button", "input", "textarea",
        "blockquote", "figcaption", "caption",
      ];

      const COMPONENT_SELECTORS = ["button", "input", "textarea"];

      const countMap = new Map<string, number>();
      const results: {
        selector: string;
        fontFamily: string;
        fontSize: number;
        fontWeight: number;
        lineHeight: number;
        letterSpacing: number;
        color: string;
        count: number;
      }[] = [];

      const rgbToHex = (rgb: string): string => {
        const match = rgb.match(/\d+/g);
        if (!match || match.length < 3) return rgb;
        return (
          "#" +
          match
            .slice(0, 3)
            .map((v) => parseInt(v).toString(16).padStart(2, "0"))
            .join("")
        );
      };

      for (const selector of TEXT_SELECTORS) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (!el.textContent?.trim()) continue;

          const style = window.getComputedStyle(el);
          const fontFamily = style.fontFamily;
          const fontSize = parseFloat(style.fontSize);
          const fontWeight = parseInt(style.fontWeight, 10);
          const lineHeightRaw = style.lineHeight;
          const lineHeight = lineHeightRaw === "normal"
            ? Math.round(fontSize * 1.2 * 10) / 10
            : parseFloat(lineHeightRaw);
          const letterSpacingRaw = style.letterSpacing;
          const letterSpacing = letterSpacingRaw === "normal"
            ? 0
            : parseFloat(letterSpacingRaw);
          const color = rgbToHex(style.color);

          const key = `${selector}|${fontFamily}|${fontSize}|${fontWeight}|${lineHeight}|${letterSpacing}|${color}`;
          countMap.set(key, (countMap.get(key) || 0) + 1);
        }
      }

      for (const [key, count] of countMap.entries()) {
        const [selector, fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, color] = key.split("|");
        results.push({
          selector,
          fontFamily,
          fontSize: parseFloat(fontSize),
          fontWeight: parseInt(fontWeight, 10),
          lineHeight: parseFloat(lineHeight),
          letterSpacing: parseFloat(letterSpacing),
          color,
          count,
        });
      }

      results.sort((a, b) => b.count - a.count);

      // ── Phase 11-2: 컴포넌트 규격 추출 ──
      const compCountMap = new Map<string, number>();
      const compResults: {
        selector: string;
        height: number;
        paddingTop: number;
        paddingRight: number;
        paddingBottom: number;
        paddingLeft: number;
        borderRadius: number;
        fontSize: number;
        fontWeight: number;
        backgroundColor: string;
        borderColor: string;
        borderWidth: number;
        count: number;
      }[] = [];

      for (const selector of COMPONENT_SELECTORS) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const style = window.getComputedStyle(el);
          const height = parseFloat(style.height) || 0;
          const paddingTop = parseFloat(style.paddingTop) || 0;
          const paddingRight = parseFloat(style.paddingRight) || 0;
          const paddingBottom = parseFloat(style.paddingBottom) || 0;
          const paddingLeft = parseFloat(style.paddingLeft) || 0;
          const borderRadius = parseFloat(style.borderRadius) || 0;
          const fontSize = parseFloat(style.fontSize);
          const fontWeight = parseInt(style.fontWeight, 10);
          const backgroundColor = rgbToHex(style.backgroundColor);
          const borderColor = rgbToHex(style.borderColor);
          const borderWidth = parseFloat(style.borderWidth) || 0;

          const key = `${selector}|${height}|${paddingTop}|${paddingRight}|${paddingBottom}|${paddingLeft}|${borderRadius}|${fontSize}|${fontWeight}|${backgroundColor}|${borderColor}|${borderWidth}`;
          compCountMap.set(key, (compCountMap.get(key) || 0) + 1);
        }
      }

      for (const [key, count] of compCountMap.entries()) {
        const parts = key.split("|");
        compResults.push({
          selector: parts[0],
          height: parseFloat(parts[1]),
          paddingTop: parseFloat(parts[2]),
          paddingRight: parseFloat(parts[3]),
          paddingBottom: parseFloat(parts[4]),
          paddingLeft: parseFloat(parts[5]),
          borderRadius: parseFloat(parts[6]),
          fontSize: parseFloat(parts[7]),
          fontWeight: parseInt(parts[8], 10),
          backgroundColor: parts[9],
          borderColor: parts[10],
          borderWidth: parseFloat(parts[11]),
          count,
        });
      }

      compResults.sort((a, b) => b.count - a.count);

      return { rawStyles: results, rawComponentSpecs: compResults };
    });

    // ── Phase 19: 스크린샷 촬영 (청크 분할) ──
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const CHUNK_HEIGHT = 1200;
    const screenshotChunks: string[] = [];
    for (let y = 0; y < bodyHeight; y += CHUNK_HEIGHT) {
      const h = Math.min(CHUNK_HEIGHT, bodyHeight - y);
      const chunkBuffer = await page.screenshot({
        type: "jpeg",
        quality: 30,
        clip: { x: 0, y, width: VIEWPORT.width, height: h },
      }) as Buffer;
      screenshotChunks.push(chunkBuffer.toString("base64"));
    }
    const screenshot = screenshotChunks[0] || "";

    // ── Phase 21: 요소 바운딩 박스 추출 ──
    const elementPositions: ElementPosition[] = await page.evaluate(() => {
      const SELECTORS = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "a", "button", "input", "textarea",
      ];
      const seen = new Set<string>();
      const positions: { selector: string; x: number; y: number; width: number; height: number }[] = [];

      for (const selector of SELECTORS) {
        if (seen.has(selector)) continue;
        const el = document.querySelector(selector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        seen.add(selector);
        positions.push({
          selector,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }

      return positions;
    });

    // 서버측에서 semanticGroup 태깅
    const styles: TypographyStyle[] = rawStyles.map((s) => ({
      ...s,
      semanticGroup: (SEMANTIC_MAP[s.selector] || "other") as SemanticGroup,
    }));

    const scaleSystem = detectScaleSystem(styles);
    const componentSpecs: ComponentSpec[] = rawComponentSpecs;
    const audit = auditStyles(styles, scaleSystem);
    const cleanedData = cleanStyles(styles, audit.consistencyMap, audit.hierarchy);

    return { styles, scaleSystem, componentSpecs, audit, cleanedData, screenshot, screenshotChunks, elementPositions };
  } finally {
    await browser.close();
  }
}

// ── Layout Reconstruction 파서 ──

const MAX_LAYOUT_ELEMENTS = 500;
const MIN_ELEMENT_SIZE = 4;
const MAX_DEPTH = 12;

export async function parseLayout(url: string): Promise<{ layoutElements: LayoutElement[] }> {
  const { browser, page } = await openPage(url);

  try {

    // 1) 페이지 전체를 스크롤하여 lazy loading 콘텐츠 트리거
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      let scrolled = 0;
      while (scrolled < scrollHeight) {
        scrolled += viewportHeight;
        window.scrollTo(0, scrolled);
        await delay(300);
      }
      // 추가 대기 (애니메이션 완료)
      await delay(1000);
    });

    // 스크롤 후 추가 네트워크 요청 완료 대기
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // 2) data-src → src 변환 (lazy image 패턴 강제 로드)
    await page.evaluate(() => {
      document.querySelectorAll("img[data-src]").forEach((img) => {
        const dataSrc = img.getAttribute("data-src");
        if (dataSrc) img.setAttribute("src", dataSrc);
      });
      // data-lazy, data-original 등 다른 lazy 패턴도 처리
      document.querySelectorAll("img[data-lazy]").forEach((img) => {
        const dataSrc = img.getAttribute("data-lazy");
        if (dataSrc) img.setAttribute("src", dataSrc);
      });
      document.querySelectorAll("img[data-original]").forEach((img) => {
        const dataSrc = img.getAttribute("data-original");
        if (dataSrc) img.setAttribute("src", dataSrc);
      });
    });

    // 3) CSS 강제 주입: 모든 요소를 보이게 (scroll animation 리셋 방지)
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          opacity: 1 !important;
          visibility: visible !important;
          transition: none !important;
          animation: none !important;
          transform: none !important;
        }
      `
    });

    // 맨 위로 복귀 (CSS 주입 후이므로 opacity 리셋 안 됨)
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 300));

    const layoutElements: LayoutElement[] = await page.evaluate(
      (maxElements: number, minSize: number, maxDepth: number) => {
        const rgbToHex = (rgb: string): string | null => {
          if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
          const match = rgb.match(/\d+/g);
          if (!match || match.length < 3) return null;
          // 알파값 0이면 투명
          if (match.length >= 4 && parseFloat(match[3]) === 0) return null;
          return "#" + match.slice(0, 3).map((v) => parseInt(v).toString(16).padStart(2, "0")).join("");
        };

        // 요소에 직접 텍스트 노드가 있는지 확인
        const getOwnText = (el: Element): string | null => {
          let text = "";
          for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) {
              text += (node.textContent || "").trim();
            }
          }
          return text.length > 0 ? text.slice(0, 200) : null;
        };

        const elements: {
          id: number;
          parentId: number | null;
          tag: string;
          zIndex: number;
          x: number;
          y: number;
          width: number;
          height: number;
          textContent: string | null;
          fontFamily: string | null;
          fontSize: number | null;
          fontWeight: number | null;
          lineHeight: number | null;
          letterSpacing: number | null;
          color: string | null;
          backgroundColor: string | null;
          borderColor: string | null;
          borderWidth: number;
          borderRadius: number;
          paddingTop: number;
          paddingRight: number;
          paddingBottom: number;
          paddingLeft: number;
          display: string;
          overflow: string;
          isContainer: boolean;
          hasBackgroundImage: boolean;
          boxShadow: string | null;
          gradient: string | null;
        }[] = [];

        let idCounter = 0;
        const elementIdMap = new Map<Element, number>();

        // BFS 탐색
        const queue: { el: Element; depth: number }[] = [{ el: document.body, depth: 0 }];

        while (queue.length > 0 && elements.length < maxElements) {
          const item = queue.shift()!;
          const el = item.el;
          const depth = item.depth;

          const rect = el.getBoundingClientRect();
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;

          // 너무 작은 요소 건너뛰기
          if (rect.width < minSize || rect.height < minSize) continue;

          const style = window.getComputedStyle(el);
          if (style.display === "none") continue;

          // 뷰포트 범위 밖 건너뛰기
          const absY = rect.top + scrollY;
          const absX = rect.left + scrollX;
          if (absY > document.body.scrollHeight * 3 || absY + rect.height < -100) continue;
          // 가로 방향: 뷰포트 밖으로 완전히 벗어난 요소 건너뛰기
          if (absX + rect.width < 0 || absX >= 1920) continue;

          const tag = el.tagName.toLowerCase();
          const id = idCounter++;
          elementIdMap.set(el, id);

          const parentEl = el.parentElement;
          const parentId = parentEl ? (elementIdMap.get(parentEl) ?? null) : null;

          const textContent = getOwnText(el);
          const hasText = textContent !== null;

          const bgColor = rgbToHex(style.backgroundColor);
          const brColor = rgbToHex(style.borderColor);
          const brWidth = parseFloat(style.borderWidth) || 0;
          const brRadius = parseFloat(style.borderRadius) || 0;

          const lhRaw = style.lineHeight;
          const fsRaw = parseFloat(style.fontSize);

          const zIndexRaw = parseInt(style.zIndex, 10);
          const zIndex = isNaN(zIndexRaw) ? 0 : zIndexRaw;

          const hasChildren = el.children.length > 0;
          const overflow = style.overflow;
          const bgImage = style.backgroundImage;
          const hasBgImage = bgImage !== "none" && bgImage !== "";
          const isGradient = hasBgImage && (bgImage.indexOf("gradient") !== -1);
          const gradient = isGradient ? bgImage : null;
          const rawShadow = style.boxShadow;
          const boxShadow = (rawShadow && rawShadow !== "none") ? rawShadow : null;

          // 뷰포트 내로 좌표/크기 클리핑
          const clippedX = Math.max(0, Math.round(rect.left + scrollX));
          const clippedW = Math.min(Math.round(rect.width), 1920 - clippedX);

          elements.push({
            id,
            parentId,
            tag,
            zIndex,
            x: clippedX,
            y: Math.round(rect.top + scrollY),
            width: clippedW > 0 ? clippedW : Math.round(rect.width),
            height: Math.round(rect.height),
            textContent: hasText ? textContent : null,
            fontFamily: hasText ? style.fontFamily : null,
            fontSize: hasText ? fsRaw : null,
            fontWeight: hasText ? parseInt(style.fontWeight, 10) : null,
            lineHeight: hasText ? (lhRaw === "normal" ? Math.round(fsRaw * 1.2) : parseFloat(lhRaw)) : null,
            letterSpacing: hasText ? (style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing)) : null,
            color: hasText ? rgbToHex(style.color) : null,
            backgroundColor: bgColor,
            borderColor: brWidth > 0 ? brColor : null,
            borderWidth: brWidth,
            borderRadius: brRadius,
            paddingTop: parseFloat(style.paddingTop) || 0,
            paddingRight: parseFloat(style.paddingRight) || 0,
            paddingBottom: parseFloat(style.paddingBottom) || 0,
            paddingLeft: parseFloat(style.paddingLeft) || 0,
            display: style.display,
            overflow: overflow,
            isContainer: hasChildren,
            hasBackgroundImage: hasBgImage,
            boxShadow: boxShadow,
            gradient: gradient,
          });

          // 자식 요소 큐에 추가
          if (depth < maxDepth) {
            for (let ci = 0; ci < el.children.length; ci++) {
              queue.push({ el: el.children[ci], depth: depth + 1 });
            }
          }
        }

        return elements;
      },
      MAX_LAYOUT_ELEMENTS,
      MIN_ELEMENT_SIZE,
      MAX_DEPTH
    );

    // 시각 요소 캡쳐 (img + background-image, 최대 50개)
    const MAX_CAPTURES = 50;
    const captureTargets = layoutElements
      .filter(el => el.tag === "img" || el.tag === "svg" || el.hasBackgroundImage)
      .slice(0, MAX_CAPTURES);

    if (captureTargets.length > 0) {
      // 모든 요소를 CSS selector로 찾을 수 없으므로 위치 기반 매칭 사용
      // body 내 모든 요소 핸들을 가져와서 위치로 매칭
      const allHandles = await page.$$("body *");
      let remaining = [...captureTargets];

      for (const handle of allHandles) {
        if (remaining.length === 0) break;
        try {
          const box = await handle.boundingBox();
          if (!box || box.width < 4 || box.height < 4) continue;

          // 위치로 매칭
          const matchIdx = remaining.findIndex(el =>
            Math.abs(el.x - Math.round(box.x)) < 3 &&
            Math.abs(el.y - Math.round(box.y)) < 3 &&
            Math.abs(el.width - Math.round(box.width)) < 5 &&
            Math.abs(el.height - Math.round(box.height)) < 5
          );
          if (matchIdx === -1) continue;

          const buf = await handle.screenshot({ type: "jpeg", quality: 60, encoding: "base64" }) as string;
          const target = remaining[matchIdx];
          const origIdx = layoutElements.findIndex(el => el.id === target.id);
          if (origIdx !== -1) {
            layoutElements[origIdx].imageData = buf;
          }
          remaining.splice(matchIdx, 1);
        } catch (_) { /* 개별 캡처 실패 무시 */ }
      }
    }

    return { layoutElements };
  } finally {
    await browser.close();
  }
}

// ── Semantic Layout 추출 ──

const MAX_SEMANTIC_NODES = 800;
const MAX_SEMANTIC_DEPTH = 15;

const SKIP_TAGS = new Set(["script", "style", "noscript", "link", "meta", "head", "br", "hr"]);
const SEMANTIC_ROLES = new Set(["header", "nav", "main", "footer", "section", "article", "aside", "form"]);

export async function parseSemanticLayout(url: string): Promise<{ layoutTree: LayoutNode }> {
  const { browser, page } = await openPage(url);

  try {
    // 1) lazy loading 트리거
    await page.evaluate(async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      const scrollHeight = document.body.scrollHeight;
      const viewportHeight = window.innerHeight;
      let scrolled = 0;
      while (scrolled < scrollHeight) {
        scrolled += viewportHeight;
        window.scrollTo(0, scrolled);
        await delay(300);
      }
      await delay(1000);
    });

    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // 2) lazy image 강제 로드
    await page.evaluate(() => {
      const attrs = ["data-src", "data-lazy", "data-original"];
      for (const attr of attrs) {
        document.querySelectorAll(`img[${attr}]`).forEach((img) => {
          const val = img.getAttribute(attr);
          if (val) img.setAttribute("src", val);
        });
      }
    });

    // 3) CSS 강제 주입
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          opacity: 1 !important;
          visibility: visible !important;
          transition: none !important;
          animation: none !important;
        }
      `
    });

    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 300));

    // 4) DOM 순회하여 시맨틱 트리 구축
    const rawTree = await page.evaluate(
      (maxNodes: number, maxDepth: number) => {
        let nodeCount = 0;

        const rgbToHex = (rgb: string): string | null => {
          if (!rgb || rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)") return null;
          const match = rgb.match(/\d+(\.\d+)?/g);
          if (!match || match.length < 3) return null;
          if (match.length >= 4 && parseFloat(match[3]) === 0) return null;
          return "#" + match.slice(0, 3).map((v) => Math.round(parseFloat(v)).toString(16).padStart(2, "0")).join("");
        };

        const getOwnText = (el: Element): string | null => {
          let text = "";
          for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE) {
              text += (node.textContent || "").trim();
            }
          }
          return text.length > 0 ? text.slice(0, 300) : null;
        };

        const skipTags = new Set(["script", "style", "noscript", "link", "meta", "head", "br", "hr"]);
        const semanticRoles = new Set(["header", "nav", "main", "footer", "section", "article", "aside", "form"]);

        const mapJustify = (v: string): "start" | "center" | "end" | "space-between" => {
          if (v === "center") return "center";
          if (v === "flex-end" || v === "end") return "end";
          if (v === "space-between") return "space-between";
          return "start";
        };

        const mapAlign = (v: string): "start" | "center" | "end" | "stretch" => {
          if (v === "center") return "center";
          if (v === "flex-end" || v === "end") return "end";
          if (v === "stretch" || v === "normal") return "stretch";
          return "start";
        };

        const mapTextAlign = (v: string): "left" | "center" | "right" => {
          if (v === "center") return "center";
          if (v === "right" || v === "end") return "right";
          return "left";
        };

        function traverse(el: Element, depth: number): LayoutNode | null {
          if (nodeCount >= maxNodes || depth > maxDepth) return null;

          const tag = el.tagName.toLowerCase();
          if (skipTags.has(tag)) return null;

          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);

          if (style.display === "none" || style.visibility === "hidden") return null;
          if (rect.width < 1 || rect.height < 1) return null;

          // position: fixed/sticky 처리
          // 전체 너비의 80% 이상이면 고정 헤더/네비로 간주하여 유지
          // 그 외 작은 위젯(채팅, 쿠키 배너 등)은 제거
          const position = style.position;
          if (position === "fixed" || position === "sticky") {
            if (rect.width < window.innerWidth * 0.8) return null;
          }

          // 뷰포트 밖 요소 건너뛰기
          const scrollY = window.scrollY;
          const absY = rect.top + scrollY;
          if (absY + rect.height < -100 || absY > document.body.scrollHeight * 2) return null;

          const id = nodeCount++;

          // data-sg-id 태그 (이미지 캡처용)
          el.setAttribute("data-sg-id", String(id));

          // 레이아웃 모델 감지
          const display = style.display;
          const flexDir = style.flexDirection;

          let layoutModel: string;
          const hasVisibleChildren = el.children.length > 0;
          const ownText = getOwnText(el);

          if (display.includes("flex")) {
            layoutModel = (flexDir === "column" || flexDir === "column-reverse") ? "flex-col" : "flex-row";
          } else if (display.includes("grid")) {
            layoutModel = "grid";
          } else if (display === "inline" || display === "inline-block" || display === "initial" || display === "contents") {
            layoutModel = hasVisibleChildren ? "inline" : "leaf";
          } else {
            // block/list-item 등
            // 인라인 계열 태그인데 display가 명시적 inline이 아닌 경우도 인라인으로 처리
            const inlineTags = new Set(["span", "a", "em", "strong", "b", "i", "u", "s", "small", "sub", "sup", "abbr", "code", "mark", "label"]);
            if (inlineTags.has(tag) && !display.includes("block") && !display.includes("flex") && !display.includes("grid")) {
              layoutModel = hasVisibleChildren ? "inline" : "leaf";
            } else {
              layoutModel = hasVisibleChildren ? "block" : "leaf";
            }
          }

          // 텍스트만 있고 자식 요소가 없으면 leaf
          if (!hasVisibleChildren && ownText) {
            layoutModel = "leaf";
          }

          // gap 추출
          const gap = parseFloat(style.gap) || parseFloat(style.rowGap) || 0;
          const crossGap = parseFloat(style.columnGap) || 0;

          // 크기 모드 추론
          // getComputedStyle().width는 항상 px값을 반환하므로 신뢰할 수 없음
          // 대신 부모 대비 요소 너비 비율과 레이아웃 모델로 판단
          let widthMode: "fixed" | "fill" | "hug" = "hug";
          let heightMode: "fixed" | "fill" | "hug" = "hug";

          const flexGrow = parseFloat(style.flexGrow) || 0;
          const parentEl = el.parentElement;
          const parentRect = parentEl ? parentEl.getBoundingClientRect() : null;
          const parentStyle = parentEl ? window.getComputedStyle(parentEl) : null;
          const parentContentWidth = parentRect && parentStyle
            ? parentRect.width - (parseFloat(parentStyle.paddingLeft) || 0) - (parseFloat(parentStyle.paddingRight) || 0)
            : 0;

          // 부모 콘텐츠 영역의 90% 이상을 차지하면 fill로 간주
          const fillsParent = parentContentWidth > 0 && rect.width >= parentContentWidth * 0.9;

          if (flexGrow >= 1) {
            widthMode = "fill";
          } else if (fillsParent) {
            // 부모 너비를 거의 채우고 있음 → fill
            widthMode = "fill";
          } else if (display === "inline" || display === "inline-block") {
            widthMode = "hug";
          } else {
            // block/flex/grid 레벨 요소: 부모를 못 채우면 고정 너비(max-width 등)
            if (display === "block" || display === "list-item" || display === "flex" || display === "grid") {
              if (parentContentWidth > 0 && rect.width < parentContentWidth * 0.9) {
                // 부모보다 명확히 작음 → max-width 등으로 제한된 고정 너비
                widthMode = "fixed";
              } else {
                widthMode = "fill";
              }
            }
          }

          // 높이 모드 추론
          const parentContentHeight = parentRect && parentStyle
            ? parentRect.height - (parseFloat(parentStyle.paddingTop) || 0) - (parseFloat(parentStyle.paddingBottom) || 0)
            : 0;
          const fillsParentHeight = parentContentHeight > 0 && rect.height >= parentContentHeight * 0.9;

          if (style.height === "100%" || style.height === "-webkit-fill-available") {
            heightMode = "fill";
          } else if (fillsParentHeight) {
            heightMode = "fill";
          } else if (rect.height > 0 && !fillsParentHeight && parentContentHeight > 0 && rect.height < parentContentHeight * 0.9) {
            // 부모보다 명확히 작고 높이가 있음 → 고정 높이
            heightMode = "fixed";
          }

          // margin: auto 감지 (가운데 정렬)
          // getComputedStyle()은 margin:auto를 px로 resolve하므로 여러 방법으로 감지
          const marginLeft = style.marginLeft;
          const marginRight = style.marginRight;
          // 1) 인라인 스타일에서 auto 확인
          const htmlEl = el as HTMLElement;
          const inlineML = htmlEl.style?.marginLeft || "";
          const inlineMR = htmlEl.style?.marginRight || "";
          const inlineMargin = htmlEl.style?.margin || "";
          const marginLeftAuto = inlineML === "auto" || style.marginLeft === "auto";
          const marginRightAuto = inlineMR === "auto" || style.marginRight === "auto";
          // 2) margin shorthand에 auto가 포함 (e.g., "0 auto", "0px auto")
          const shorthandAuto = inlineMargin.includes("auto");
          // 3) 위치 기반 감지: block 요소가 부모보다 좁고, 양쪽 여백이 거의 같으면 margin:auto
          const mlPx = parseFloat(marginLeft) || 0;
          const mrPx = parseFloat(marginRight) || 0;
          const positionCentered = widthMode === "fixed" && mlPx > 4 && mrPx > 4 && Math.abs(mlPx - mrPx) < 4;
          const isCentered = (marginLeftAuto && marginRightAuto) || shorthandAuto || positionCentered;

          // 시각 스타일
          const bgColor = rgbToHex(style.backgroundColor);
          const brColor = rgbToHex(style.borderColor);
          const brWidth = parseFloat(style.borderWidth) || 0;
          const brRadius = parseFloat(style.borderRadius) || 0;
          const bgImage = style.backgroundImage;
          const hasBgImage = bgImage !== "none" && bgImage !== "";
          const isGradient = hasBgImage && bgImage.includes("gradient");
          const rawShadow = style.boxShadow;
          const boxShadow = (rawShadow && rawShadow !== "none") ? rawShadow : null;
          const opacity = parseFloat(style.opacity) || 1;
          const overflow = style.overflow;

          // 이미지 여부
          const isImage = tag === "img" || tag === "svg" || (hasBgImage && !isGradient);
          const imageSrc = tag === "img" ? el.getAttribute("src") : null;

          // 텍스트 스타일
          const hasText = ownText !== null && layoutModel === "leaf";
          const fsRaw = parseFloat(style.fontSize);
          const lhRaw = style.lineHeight;

          // 자식 순회 (텍스트 노드도 포함)
          const children: any[] = [];
          if (hasVisibleChildren && layoutModel !== "leaf") {
            // 혼합 콘텐츠 감지: 요소 자식과 텍스트 노드가 공존하는 경우
            // el.childNodes를 순회하여 텍스트 노드도 synthetic leaf로 생성
            const hasMixedContent = ownText !== null && el.children.length > 0;

            if (hasMixedContent) {
              // childNodes 순회: 텍스트 노드 + 요소 노드 모두 처리
              for (let i = 0; i < el.childNodes.length; i++) {
                const childNode = el.childNodes[i];
                if (childNode.nodeType === Node.TEXT_NODE) {
                  const txt = (childNode.textContent || "").trim();
                  if (txt.length === 0) continue;
                  // synthetic text leaf 노드 생성
                  const syntheticId = nodeCount++;
                  const fsRawSynthetic = parseFloat(style.fontSize);
                  const lhRawSynthetic = style.lineHeight;
                  children.push({
                    id: syntheticId,
                    tag: "#text",
                    role: null,
                    layoutModel: "leaf",
                    gap: 0, crossGap: 0, flexWrap: false,
                    mainAxisAlign: "start", crossAxisAlign: "stretch",
                    width: 0, // Auto Layout에서 HUG으로 처리됨
                    height: 0,
                    widthMode: "hug", heightMode: "hug",
                    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
                    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
                    backgroundColor: null, borderColor: null, borderWidth: 0, borderRadius: 0,
                    boxShadow: null, gradient: null, opacity: 1, overflow: "visible",
                    textContent: txt.slice(0, 300),
                    fontFamily: style.fontFamily,
                    fontSize: fsRawSynthetic,
                    fontWeight: parseInt(style.fontWeight, 10),
                    lineHeight: lhRawSynthetic === "normal" ? Math.round(fsRawSynthetic * 1.2) : parseFloat(lhRawSynthetic),
                    letterSpacing: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing),
                    textColor: rgbToHex(style.color),
                    textAlign: mapTextAlign(style.textAlign),
                    isImage: false, imageSrc: null, isCentered: false, children: [],
                  });
                } else if (childNode.nodeType === Node.ELEMENT_NODE) {
                  const child = traverse(childNode as Element, depth + 1);
                  if (child) children.push(child);
                }
              }
            } else {
              // 기존 방식: 요소 자식만 순회
              for (let i = 0; i < el.children.length; i++) {
                const child = traverse(el.children[i], depth + 1);
                if (child) children.push(child);
              }
            }
          }

          // 자식이 모두 필터링된 경우 leaf로 변경
          if (children.length === 0 && layoutModel !== "leaf") {
            if (ownText) {
              layoutModel = "leaf";
            } else if (!isImage && !bgColor && !brWidth && !hasBgImage && !boxShadow) {
              return null; // 시각적으로 의미 없는 빈 노드 제거
            }
          }

          return {
            id,
            tag,
            role: semanticRoles.has(tag) ? tag : (el.getAttribute("role") || null),
            layoutModel: layoutModel as any,
            gap: layoutModel === "flex-row" ? (parseFloat(style.columnGap) || gap) : gap,
            crossGap: layoutModel === "flex-row" ? (parseFloat(style.rowGap) || 0) : crossGap,
            flexWrap: style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse",
            mainAxisAlign: mapJustify(style.justifyContent),
            crossAxisAlign: mapAlign(style.alignItems),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            widthMode,
            heightMode,
            paddingTop: parseFloat(style.paddingTop) || 0,
            paddingRight: parseFloat(style.paddingRight) || 0,
            paddingBottom: parseFloat(style.paddingBottom) || 0,
            paddingLeft: parseFloat(style.paddingLeft) || 0,
            marginTop: parseFloat(style.marginTop) || 0,
            marginRight: parseFloat(style.marginRight) || 0,
            marginBottom: parseFloat(style.marginBottom) || 0,
            marginLeft: parseFloat(style.marginLeft) || 0,
            backgroundColor: bgColor,
            borderColor: brWidth > 0 ? brColor : null,
            borderWidth: brWidth,
            borderRadius: brRadius,
            boxShadow,
            gradient: isGradient ? bgImage : null,
            opacity,
            overflow,
            textContent: hasText ? ownText : null,
            fontFamily: hasText ? style.fontFamily : null,
            fontSize: hasText ? fsRaw : null,
            fontWeight: hasText ? parseInt(style.fontWeight, 10) : null,
            lineHeight: hasText ? (lhRaw === "normal" ? Math.round(fsRaw * 1.2) : parseFloat(lhRaw)) : null,
            letterSpacing: hasText ? (style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing)) : null,
            textColor: hasText ? rgbToHex(style.color) : null,
            textAlign: mapTextAlign(style.textAlign),
            isImage,
            imageSrc,
            isCentered,
            children,
          };
        }

        const body = document.body;
        const tree = traverse(body, 0);

        if (!tree) {
          return {
            id: 0, tag: "body", role: null, layoutModel: "flex-col",
            gap: 0, crossGap: 0, flexWrap: false,
            mainAxisAlign: "start", crossAxisAlign: "stretch",
            width: 1920, height: 1080,
            widthMode: "fixed", heightMode: "hug",
            paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
            marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
            backgroundColor: "#ffffff", borderColor: null, borderWidth: 0, borderRadius: 0,
            boxShadow: null, gradient: null, opacity: 1, overflow: "visible",
            textContent: null, fontFamily: null, fontSize: null, fontWeight: null,
            lineHeight: null, letterSpacing: null, textColor: null, textAlign: "left",
            isImage: false, imageSrc: null, isCentered: false, children: [],
          };
        }

        return tree;
      },
      MAX_SEMANTIC_NODES,
      MAX_SEMANTIC_DEPTH
    );

    // 5) 트리 후처리: wrapper 제거 + block→flex-col 변환
    function simplifyTree(node: LayoutNode): LayoutNode {
      // 먼저 자식들을 재귀적으로 정리
      node.children = node.children.map(simplifyTree);

      // 의미 없는 wrapper 제거: 자식이 1개이고 시각 스타일이 없는 non-semantic 노드
      // 보존 조건: 정렬 속성, margin:auto, gap 등 레이아웃에 영향을 주는 속성이 있으면 제거하지 않음
      while (
        node.children.length === 1 &&
        !node.role &&
        !node.backgroundColor &&
        !node.borderWidth &&
        !node.boxShadow &&
        !node.gradient &&
        !node.textContent &&
        !node.isImage &&
        !node.children[0].isCentered &&
        node.crossAxisAlign === "stretch" &&
        node.mainAxisAlign === "start" &&
        node.gap === 0 &&
        node.paddingTop === 0 && node.paddingRight === 0 &&
        node.paddingBottom === 0 && node.paddingLeft === 0
      ) {
        const child = node.children[0];
        // 자식의 크기 모드 보존: fixed인 자식을 fill로 덮어쓰지 않음
        if (node.widthMode === "fill" && child.widthMode === "hug") child.widthMode = "fill";
        if (node.heightMode === "fill" && child.heightMode === "hug") child.heightMode = "fill";
        node = child;
      }

      // block 컨테이너를 flex-col로 변환 (자식 간 gap 추론)
      if (node.layoutModel === "block" && node.children.length > 1) {
        node.layoutModel = "flex-col";

        // gap은 이미 page.evaluate에서 계산 불가 → 0 유지
        // (향후 개선: 자식 간 실제 간격 측정)
      }

      // grid를 flex-row wrap으로 단순화 (v1)
      if (node.layoutModel === "grid") {
        node.layoutModel = "flex-row";
        node.flexWrap = true;
      }

      // inline 컨테이너를 flex-row로 변환
      if (node.layoutModel === "inline" && node.children.length > 0) {
        node.layoutModel = "flex-row";
      }

      return node;
    }

    const tree = simplifyTree(rawTree as LayoutNode);

    // 6) 이미지 캡처: data-sg-id 기반
    const imageNodes: LayoutNode[] = [];
    function collectImageNodes(node: LayoutNode) {
      if (node.isImage) imageNodes.push(node);
      for (const child of node.children) collectImageNodes(child);
    }
    collectImageNodes(tree);

    const MAX_IMG_CAPTURES = 50;
    const toCapture = imageNodes.slice(0, MAX_IMG_CAPTURES);

    for (const imgNode of toCapture) {
      try {
        const handle = await page.$(`[data-sg-id="${imgNode.id}"]`);
        if (handle) {
          const box = await handle.boundingBox();
          if (box && box.width > 2 && box.height > 2) {
            const buf = await handle.screenshot({ type: "jpeg", quality: 60, encoding: "base64" }) as string;
            imgNode.imageData = buf;
          }
        }
      } catch (_) { /* 개별 캡처 실패 무시 */ }
    }

    return { layoutTree: tree };
  } finally {
    await browser.close();
  }
}
