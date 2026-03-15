export type SemanticGroup = "heading" | "body" | "interactive" | "navigation" | "table" | "other";

export interface TypographyStyle {
  selector: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  count: number;
  semanticGroup: SemanticGroup;
}

// Phase 11-2: 컴포넌트 규격
export interface ComponentSpec {
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
}

// Phase 12: 유사 스타일 클러스터
export interface StyleCluster {
  baseStyle: TypographyStyle;
  variants: TypographyStyle[];
}

// Phase 12-2: 파편화 경고
export interface FragmentationWarning {
  selector: string;
  variantCount: number;
  styles: TypographyStyle[];
}

// Phase 13: 위계 노드
export interface HierarchyNode {
  role: string;
  baseStyle: TypographyStyle;
  variants: TypographyStyle[];
}

// Phase 14: 이상 탐지
export interface Anomaly {
  type: "hierarchy_inversion" | "font_mixing" | "fragmentation";
  message: string;
  severity: "warning" | "error";
  selectors: string[];
}

// Phase 14: 디자인 감사 결과
export interface AuditResult {
  systemScore: number;
  typeScaleRatio: number | null;
  anomalies: Anomaly[];
  clusters: StyleCluster[];
  fragmentations: FragmentationWarning[];
  hierarchy: Record<string, HierarchyNode[]>;
  consistencyMap: Record<string, number>;
}

// Phase 15: 정제된 스타일 (인사이트 태그 포함)
export interface CleanedStyle extends TypographyStyle {
  insightTags: string[];
  mergedFrom?: number;
}

// Phase 15: 정제된 데이터
export interface CleanedData {
  styles: CleanedStyle[];
  removedCount: number;
  mergedCount: number;
}

// Phase 21: 요소 위치 정보
export interface ElementPosition {
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Layout Reconstruction: 개별 요소 레이아웃 정보
export interface LayoutElement {
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
  isContainer: boolean;
  imageData?: string;
}

export interface ExtractResult {
  url: string;
  success: boolean;
  error?: string;
  data?: TypographyStyle[];
  scaleSystem?: string | null;
  componentSpecs?: ComponentSpec[];
  audit?: AuditResult;
  cleanedData?: CleanedData;
  screenshot?: string;
  screenshotChunks?: string[];
  elementPositions?: ElementPosition[];
  layoutElements?: LayoutElement[];
}

export type PluginMessage =
  | { type: "extract"; urls: string[]; layoutMode?: boolean }
  | { type: "progress"; current: number; total: number; url: string }
  | { type: "result"; result: ExtractResult }
  | { type: "done"; results: ExtractResult[]; cleanedOnly?: boolean; layoutMode?: boolean }
  | { type: "screenshot-chunk"; url: string; data: string; chunkIndex: number; totalChunks: number };
