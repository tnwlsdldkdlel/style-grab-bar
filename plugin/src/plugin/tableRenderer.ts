import type { ExtractResult, TypographyStyle, SemanticGroup, ComponentSpec, AuditResult, StyleCluster, FragmentationWarning, HierarchyNode, Anomaly, CleanedStyle, CleanedData, ElementPosition, LayoutElement, LayoutNode } from "../types";

// ── 상수 ──
var SITE_GAP = 600;
var SECTION_GAP = 40;
var CARD_GAP = 12;
var PADDING = 24;
var SWATCH_SIZE = 24;
var SAMPLE_TEXT = "Aa Bb Cc 123";
var CARD_WIDTH = 320;
var GRID_WIDTH = CARD_WIDTH * 2 + CARD_GAP;

// ── B단계: 폰트 Weight → Figma Style 매핑 ──

var WEIGHT_STYLE_MAP: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

function weightToStyle(weight: number): string {
  // 가장 가까운 weight 찾기
  var keys = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  var closest = 400;
  var minDiff = 999;
  for (var i = 0; i < keys.length; i++) {
    var diff = Math.abs(keys[i] - weight);
    if (diff < minDiff) {
      minDiff = diff;
      closest = keys[i];
    }
  }
  return WEIGHT_STYLE_MAP[closest] || "Regular";
}

// 로드 성공한 폰트 캐시: "fontFamily::styleName" → true
var loadedFontCache: Record<string, boolean> = {};

async function tryLoadFont(family: string, weight: number): Promise<FontName> {
  var fontFamily = shortFontName(family);
  var styleName = weightToStyle(weight);
  var cacheKey = fontFamily + "::" + styleName;

  // 이미 로드 성공한 폰트
  if (loadedFontCache[cacheKey]) {
    return { family: fontFamily, style: styleName };
  }

  // 폰트 로드 시도
  try {
    await figma.loadFontAsync({ family: fontFamily, style: styleName });
    loadedFontCache[cacheKey] = true;
    return { family: fontFamily, style: styleName };
  } catch (_) {
    // styleName 변형 시도 (예: "SemiBold" → "Semibold", "ExtraBold" → "Extra Bold")
    var altNames = getAlternativeStyleNames(styleName);
    for (var i = 0; i < altNames.length; i++) {
      var altKey = fontFamily + "::" + altNames[i];
      if (loadedFontCache[altKey]) {
        return { family: fontFamily, style: altNames[i] };
      }
      try {
        await figma.loadFontAsync({ family: fontFamily, style: altNames[i] });
        loadedFontCache[altKey] = true;
        return { family: fontFamily, style: altNames[i] };
      } catch (_) { /* continue */ }
    }

    // Inter fallback
    var interStyle = weight >= 600 ? "Bold" : "Regular";
    return { family: "Inter", style: interStyle };
  }
}

function getAlternativeStyleNames(styleName: string): string[] {
  var alts: string[] = [];
  // 일반적인 변형들
  if (styleName === "SemiBold") alts.push("Semibold", "DemiBold", "Semi Bold");
  if (styleName === "ExtraBold") alts.push("Extra Bold", "UltraBold", "Ultra Bold");
  if (styleName === "ExtraLight") alts.push("Extra Light", "UltraLight", "Ultra Light");
  if (styleName === "Regular") alts.push("Normal", "Book", "Roman");
  if (styleName === "Bold") alts.push("bold");
  if (styleName === "Medium") alts.push("medium");
  return alts;
}

// 추출된 스타일들에서 필요한 폰트를 사전 로드
async function preloadFonts(styles: TypographyStyle[]): Promise<void> {
  var seen: Record<string, boolean> = {};
  for (var i = 0; i < styles.length; i++) {
    var s = styles[i];
    var key = shortFontName(s.fontFamily) + "::" + s.fontWeight;
    if (!seen[key]) {
      seen[key] = true;
      await tryLoadFont(s.fontFamily, s.fontWeight);
    }
  }
}

// ── C단계: Figma 스타일 등록 ──

function buildExistingStyleMaps(): { textMap: Record<string, TextStyle>; paintMap: Record<string, PaintStyle> } {
  var existingTextStyles = figma.getLocalTextStyles();
  var existingPaintStyles = figma.getLocalPaintStyles();
  var textMap: Record<string, TextStyle> = {};
  var paintMap: Record<string, PaintStyle> = {};
  for (var i = 0; i < existingTextStyles.length; i++) {
    textMap[existingTextStyles[i].name] = existingTextStyles[i];
  }
  for (var i = 0; i < existingPaintStyles.length; i++) {
    paintMap[existingPaintStyles[i].name] = existingPaintStyles[i];
  }
  return { textMap: textMap, paintMap: paintMap };
}

async function registerFigmaStyles(
  styles: TypographyStyle[],
  siteName: string,
  existingMaps?: { textMap: Record<string, TextStyle>; paintMap: Record<string, PaintStyle> }
): Promise<{ textStyles: Record<string, TextStyle>; paintStyles: Record<string, PaintStyle> }> {
  var textStyles: Record<string, TextStyle> = {};
  var paintStyles: Record<string, PaintStyle> = {};

  var maps = existingMaps || buildExistingStyleMaps();
  var existingTextMap = maps.textMap;
  var existingPaintMap = maps.paintMap;

  // 텍스트 스타일 등록
  for (var i = 0; i < styles.length; i++) {
    var s = styles[i];
    var groupLabel = SEMANTIC_LABELS[s.semanticGroup] || "Other";
    var fontName = shortFontName(s.fontFamily);
    var styleName = siteName + "/" + groupLabel + "/" + fontName + " " + s.fontSize + "/" + s.fontWeight;

    if (existingTextMap[styleName]) {
      textStyles[styleKey(s)] = existingTextMap[styleName];
      continue;
    }

    try {
      var ts = figma.createTextStyle();
      ts.name = styleName;
      var loadedFont = await tryLoadFont(s.fontFamily, s.fontWeight);
      ts.fontName = loadedFont;
      ts.fontSize = s.fontSize;
      if (s.lineHeight > 0) {
        ts.lineHeight = { value: s.lineHeight, unit: "PIXELS" };
      }
      if (s.letterSpacing !== 0) {
        ts.letterSpacing = { value: s.letterSpacing, unit: "PIXELS" };
      }
      textStyles[styleKey(s)] = ts;
    } catch (_) { /* 스타일 생성 실패 시 무시 */ }
  }

  // 컬러 스타일 등록 (고유 색상)
  var colorSet: Record<string, boolean> = {};
  for (var i = 0; i < styles.length; i++) {
    var hex = styles[i].color.toLowerCase();
    if (!hex.startsWith("#") || hex.length !== 7 || colorSet[hex]) continue;
    colorSet[hex] = true;

    var paintName = siteName + "/Colors/" + hex.toUpperCase();
    if (existingPaintMap[paintName]) {
      paintStyles[hex] = existingPaintMap[paintName];
      continue;
    }

    try {
      var ps = figma.createPaintStyle();
      ps.name = paintName;
      ps.paints = [{ type: "SOLID", color: hexToRgb(hex) }];
      paintStyles[hex] = ps;
    } catch (_) { /* 스타일 생성 실패 시 무시 */ }
  }

  return { textStyles: textStyles, paintStyles: paintStyles };
}

function styleKey(s: TypographyStyle): string {
  return s.fontFamily + "|" + s.fontSize + "|" + s.fontWeight + "|" + s.lineHeight + "|" + s.letterSpacing;
}

var SEMANTIC_LABELS: Record<string, string> = {
  heading: "Heading",
  body: "Body Text",
  interactive: "Interactive",
  navigation: "Navigation",
  table: "Table",
  other: "Other",
};

var SEMANTIC_ORDER: string[] = ["heading", "body", "navigation", "interactive", "table", "other"];

// ── 유틸 ──

function hexToRgb(hex: string): RGB {
  var h = hex.replace("#", "");
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function extractHostname(url: string): string {
  try {
    var match = url.match(/^https?:\/\/(?:www\.)?([^\/\?#]+)/);
    return match ? match[1] : url;
  } catch (_) {
    return url;
  }
}

function shortFontName(family: string): string {
  var first = family.split(",")[0].trim();
  return first.replace(/"/g, "");
}

// ── 텍스트 노드 헬퍼 ──

function createTextNode(
  characters: string,
  fontSize: number,
  color: RGB,
  style?: "Bold" | "Regular"
): TextNode {
  var node = figma.createText();
  node.fontName = { family: "Inter", style: style || "Regular" };
  node.characters = characters;
  node.fontSize = fontSize;
  node.fills = [{ type: "SOLID", color: color }];
  return node;
}

// ── 구분선 헬퍼 ──

function createDivider(color?: RGB): RectangleNode {
  var div = figma.createRectangle();
  div.resize(100, 1);
  div.fills = [{ type: "SOLID", color: color || { r: 0.9, g: 0.9, b: 0.9 } }];
  div.layoutAlign = "STRETCH";
  return div;
}

// ── 점수 색상 헬퍼 ──

function getScoreColor(score: number): RGB {
  if (score >= 80) return { r: 0.09, g: 0.6, b: 0.35 };
  if (score >= 50) return { r: 0.85, g: 0.6, b: 0.05 };
  return { r: 0.85, g: 0.2, b: 0.15 };
}

// ── 속성 그리드 헬퍼 ──

function createPropsGrid(
  name: string,
  props: { label: string; value: string }[],
  valueFontSize?: number
): FrameNode {
  var row = createAutoFrame(name, "HORIZONTAL", 16, 0);
  for (var i = 0; i < props.length; i++) {
    var prop = props[i];
    var col = createAutoFrame(prop.label, "VERTICAL", 2, 0);
    col.appendChild(createTextNode(prop.label, 9, { r: 0.5, g: 0.5, b: 0.55 }, "Bold"));
    col.appendChild(createTextNode(prop.value, valueFontSize || 11, { r: 0.2, g: 0.2, b: 0.2 }));
    row.appendChild(col);
  }
  return row;
}

// ── Auto Layout 헬퍼 ──

function createAutoFrame(
  name: string,
  direction: "VERTICAL" | "HORIZONTAL",
  spacing: number,
  padding: number
): FrameNode {
  var frame = figma.createFrame();
  frame.name = name;
  frame.layoutMode = direction;
  frame.itemSpacing = spacing;
  frame.paddingLeft = padding;
  frame.paddingRight = padding;
  frame.paddingTop = padding;
  frame.paddingBottom = padding;
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.fills = [];
  return frame;
}

// ── 섹션 헤더 ──

function createSectionHeader(text: string, subtitle?: string): FrameNode {
  var wrapper = createAutoFrame("Section Header", "VERTICAL", 6, 0);

  var label = figma.createText();
  label.fontName = { family: "Inter", style: "Bold" };
  label.characters = text;
  label.fontSize = 18;
  label.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
  wrapper.appendChild(label);

  if (subtitle) {
    var sub = figma.createText();
    sub.fontName = { family: "Inter", style: "Regular" };
    sub.characters = subtitle;
    sub.fontSize = 11;
    sub.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
    wrapper.appendChild(sub);
  }

  var line = figma.createRectangle();
  line.resize(500, 1);
  line.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
  line.layoutAlign = "STRETCH";
  wrapper.appendChild(line);

  return wrapper;
}

// ── 서브 섹션 헤더 (의미 그룹용) ──

function createSubHeader(text: string): FrameNode {
  var wrapper = createAutoFrame("Sub Header", "HORIZONTAL", 8, 0);
  wrapper.counterAxisAlignItems = "CENTER";

  var label = figma.createText();
  label.fontName = { family: "Inter", style: "Bold" };
  label.characters = text;
  label.fontSize = 13;
  label.fills = [{ type: "SOLID", color: { r: 0.25, g: 0.25, b: 0.3 } }];
  wrapper.appendChild(label);

  var line = figma.createRectangle();
  line.resize(200, 1);
  line.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
  line.layoutGrow = 1;
  wrapper.appendChild(line);

  return wrapper;
}

// ── 배지 헬퍼 ──

function createBadge(text: string, bgColor: RGB, textColor: RGB): FrameNode {
  var badge = createAutoFrame("Badge", "HORIZONTAL", 0, 0);
  badge.paddingLeft = 6;
  badge.paddingRight = 6;
  badge.paddingTop = 2;
  badge.paddingBottom = 2;
  badge.cornerRadius = 8;
  badge.fills = [{ type: "SOLID", color: bgColor }];

  var badgeText = figma.createText();
  badgeText.fontName = { family: "Inter", style: "Bold" };
  badgeText.characters = text;
  badgeText.fontSize = 9;
  badgeText.fills = [{ type: "SOLID", color: textColor }];
  badge.appendChild(badgeText);

  return badge;
}

// ── 공유 헬퍼: 샘플 텍스트, 속성 그리드, 컬러 행 ──

function createSampleText(
  style: TypographyStyle,
  registeredTextStyle?: TextStyle,
  registeredPaintStyle?: PaintStyle
): { sample: TextNode; isOriginalFont: boolean } {
  var sample = figma.createText();
  var fontFamily = shortFontName(style.fontFamily);
  var cacheKey = fontFamily + "::" + weightToStyle(style.fontWeight);
  var isOriginalFont = !!loadedFontCache[cacheKey];

  if (isOriginalFont) {
    sample.fontName = { family: fontFamily, style: weightToStyle(style.fontWeight) };
  } else {
    sample.fontName = { family: "Inter", style: style.fontWeight >= 600 ? "Bold" : "Regular" };
  }
  sample.characters = SAMPLE_TEXT;
  sample.fontSize = Math.min(Math.max(style.fontSize, 12), 48);
  if (style.lineHeight > 0) {
    sample.lineHeight = { value: style.lineHeight, unit: "PIXELS" };
  }
  if (style.letterSpacing !== 0) {
    sample.letterSpacing = { value: style.letterSpacing, unit: "PIXELS" };
  }
  if (style.color.startsWith("#") && style.color.length === 7) {
    sample.fills = [{ type: "SOLID", color: hexToRgb(style.color) }];
  }
  if (registeredTextStyle) {
    sample.textStyleId = registeredTextStyle.id;
  }
  if (registeredPaintStyle && style.color.startsWith("#") && style.color.length === 7) {
    sample.fillStyleId = registeredPaintStyle.id;
  }
  sample.name = "Sample: " + fontFamily + " " + style.fontSize + "px";
  return { sample: sample, isOriginalFont: isOriginalFont };
}

function createStylePropsGrid(style: TypographyStyle, isOriginalFont: boolean): FrameNode {
  var fontLabel = shortFontName(style.fontFamily);
  if (!isOriginalFont) fontLabel += " (fallback)";
  return createPropsGrid("Info", [
    { label: "Font", value: fontLabel },
    { label: "Size", value: style.fontSize + "px" },
    { label: "Weight", value: String(style.fontWeight) },
    { label: "LH", value: Math.round(style.lineHeight * 10) / 10 + "px" },
    { label: "LS", value: Math.round(style.letterSpacing * 100) / 100 + "px" },
  ]);
}

function createColorSwatchRow(style: TypographyStyle, registeredPaintStyle?: PaintStyle): FrameNode {
  var bottomRow = createAutoFrame("Bottom", "HORIZONTAL", 8, 0);
  bottomRow.counterAxisAlignItems = "CENTER";
  if (style.color.startsWith("#") && style.color.length === 7) {
    var swatch = figma.createEllipse();
    swatch.resize(SWATCH_SIZE, SWATCH_SIZE);
    swatch.fills = [{ type: "SOLID", color: hexToRgb(style.color) }];
    swatch.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    swatch.strokeWeight = 1;
    bottomRow.appendChild(swatch);
  }
  var colorLabel = figma.createText();
  colorLabel.fontName = { family: "Inter", style: "Regular" };
  colorLabel.characters = style.color;
  colorLabel.fontSize = 11;
  colorLabel.fills = [{ type: "SOLID", color: { r: 0.35, g: 0.35, b: 0.35 } }];
  bottomRow.appendChild(colorLabel);
  if (registeredPaintStyle) {
    bottomRow.appendChild(createBadge("Style", { r: 0.45, g: 0.3, b: 0.75 }, { r: 1, g: 1, b: 1 }));
  }
  return bottomRow;
}

// ── Layout 렌더러 공유 헬퍼 ──

// CSS var() fallback에서 실제 색상 추출
function resolveVarColor(str: string): string | null {
  // var(--name, #hex) or var(--name, rgba(...))
  var fallback = str.match(/var\([^,]+,\s*([^)]+)\)/);
  if (fallback) return fallback[1].trim();
  return null;
}

// CSS 색상 문자열 → { r, g, b, a }
function parseCssColor(colorStr: string): { r: number; g: number; b: number; a: number } | null {
  // var() 처리 — fallback 값 추출
  if (colorStr.startsWith("var(")) {
    var resolved = resolveVarColor(colorStr);
    if (!resolved) return null;
    return parseCssColor(resolved);
  }

  // hex
  if (colorStr.charAt(0) === "#") {
    var rgb = hexToRgb(colorStr);
    return { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 };
  }

  // rgba(r, g, b, a) or rgb(r, g, b)
  var rgbaM = colorStr.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaM) {
    return {
      r: parseInt(rgbaM[1]) / 255,
      g: parseInt(rgbaM[2]) / 255,
      b: parseInt(rgbaM[3]) / 255,
      a: rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1,
    };
  }

  return null;
}

// CSS linear-gradient를 Figma GradientPaint로 파싱
function parseLinearGradient(css: string): GradientPaint | null {
  // linear-gradient 내부 추출 (중첩 괄호 지원)
  var startIdx = css.indexOf("linear-gradient(");
  if (startIdx === -1) return null;
  var depth = 0;
  var endIdx = -1;
  for (var ci = startIdx; ci < css.length; ci++) {
    if (css[ci] === "(") depth++;
    else if (css[ci] === ")") {
      depth--;
      if (depth === 0) { endIdx = ci; break; }
    }
  }
  if (endIdx === -1) return null;

  var parts = css.substring(startIdx + "linear-gradient(".length, endIdx);

  // 각도 파싱
  var angleMatch = parts.match(/^([\d.]+)deg/);
  var angle = angleMatch ? parseFloat(angleMatch[1]) : 180;

  // 색상 stop 파싱 — 최상위 콤마로 분리 (중첩 괄호 내 콤마 무시)
  var tokens: string[] = [];
  var tokenStart = 0;
  var parenDepth = 0;
  for (var ti = 0; ti < parts.length; ti++) {
    if (parts[ti] === "(") parenDepth++;
    else if (parts[ti] === ")") parenDepth--;
    else if (parts[ti] === "," && parenDepth === 0) {
      tokens.push(parts.substring(tokenStart, ti).trim());
      tokenStart = ti + 1;
    }
  }
  tokens.push(parts.substring(tokenStart).trim());

  // 첫 번째 토큰이 각도면 건너뛰기
  var startToken = 0;
  if (/^[\d.]+deg/.test(tokens[0]) || /^to\s/.test(tokens[0])) {
    startToken = 1;
  }

  var stops: ColorStop[] = [];
  for (var si = startToken; si < tokens.length; si++) {
    var token = tokens[si];

    // 위치값(%) 추출
    var posMatch = token.match(/([\d.]+)\s*%\s*$/);
    var pos = posMatch ? parseFloat(posMatch[1]) / 100 : -1;

    // 위치값 제거 후 색상 부분 추출
    var colorPart = posMatch ? token.substring(0, posMatch.index).trim() : token.trim();
    // "0" 같은 단위 없는 위치값 처리 (0% 의미)
    if (!posMatch) {
      var zeroMatch = colorPart.match(/\s+0$/);
      if (zeroMatch) {
        pos = 0;
        colorPart = colorPart.substring(0, zeroMatch.index).trim();
      }
    }

    var parsed = parseCssColor(colorPart);
    if (!parsed) continue;

    stops.push({
      position: pos,
      color: { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a },
    });
  }

  if (stops.length < 2) return null;

  // 위치가 지정 안 된 stop에 균등 분배
  for (var i = 0; i < stops.length; i++) {
    if (stops[i].position < 0) {
      stops[i].position = i / (stops.length - 1);
    }
  }

  // 각도 → Figma gradient transform (시작점/끝점)
  var rad = (angle - 90) * Math.PI / 180;
  var cos = Math.cos(rad);
  var sin = Math.sin(rad);

  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: [
      [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
      [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5]
    ],
    gradientStops: stops,
  } as GradientPaint;
}

// CSS box-shadow 문자열을 Figma DropShadowEffect로 파싱
function parseBoxShadow(shadow: string): DropShadowEffect | null {
  // "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px" 또는 "0px 4px 6px -1px rgba(0,0,0,0.1)" 등
  var rgbaMatch = shadow.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  var numsStr = shadow.replace(/rgba?\([^)]+\)/g, "").trim();
  var nums = numsStr.match(/-?[\d.]+/g);
  if (!nums || nums.length < 2) return null;

  var offsetX = parseFloat(nums[0]) || 0;
  var offsetY = parseFloat(nums[1]) || 0;
  var blur = parseFloat(nums[2]) || 0;
  // nums[3]은 spread — Figma에서 spread 지원

  var r = rgbaMatch ? parseInt(rgbaMatch[1]) / 255 : 0;
  var g = rgbaMatch ? parseInt(rgbaMatch[2]) / 255 : 0;
  var b = rgbaMatch ? parseInt(rgbaMatch[3]) / 255 : 0;
  var a = rgbaMatch && rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;

  return {
    type: "DROP_SHADOW",
    color: { r: r, g: g, b: b, a: a },
    offset: { x: offsetX, y: offsetY },
    radius: blur,
    spread: nums[3] ? parseFloat(nums[3]) : 0,
    visible: true,
    blendMode: "NORMAL",
  } as DropShadowEffect;
}

function applyBoxStyle(frame: FrameNode, el: LayoutElement): void {
  if (el.gradient && !el.imageData) {
    // gradient가 있고 스크린샷 캡처가 없는 경우 Figma gradient로 변환
    var grad = parseLinearGradient(el.gradient);
    if (grad) {
      frame.fills = [grad];
    } else if (el.backgroundColor) {
      frame.fills = [{ type: "SOLID", color: hexToRgb(el.backgroundColor) }];
    } else {
      frame.fills = [];
    }
  } else if (el.backgroundColor) {
    frame.fills = [{ type: "SOLID", color: hexToRgb(el.backgroundColor) }];
  } else {
    frame.fills = [];
  }
  if (el.borderWidth > 0 && el.borderColor) {
    frame.strokes = [{ type: "SOLID", color: hexToRgb(el.borderColor) }];
    frame.strokeWeight = Math.min(el.borderWidth, 4);
  }
  if (el.borderRadius > 0) {
    frame.cornerRadius = el.borderRadius;
  }
  // box-shadow → Figma DROP_SHADOW
  if (el.boxShadow) {
    // 여러 그림자 분리 (쉼표로 구분되지만 rgba 내부 쉼표 제외)
    var shadows = el.boxShadow.split(/,(?![^(]*\))/);
    var effects: Effect[] = [];
    for (var si = 0; si < shadows.length; si++) {
      var trimmed = shadows[si].trim();
      if (trimmed.indexOf("inset") !== -1) continue; // inset 그림자 건너뜀
      var effect = parseBoxShadow(trimmed);
      if (effect) effects.push(effect);
    }
    if (effects.length > 0) frame.effects = effects;
  }
  // overflow: hidden/clip/scroll/auto인 경우만 클리핑, 나머지는 visible
  var ov = el.overflow || "visible";
  frame.clipsContent = (ov === "hidden" || ov === "clip" || ov === "scroll" || ov === "auto");
}

function placeInParent(
  node: FrameNode,
  el: LayoutElement,
  elementMap: Record<number, LayoutElement>,
  nodeMap: Record<number, FrameNode>,
  rootFrame: FrameNode
): void {
  // 플랫 렌더링: 모든 요소를 rootFrame에 절대좌표로 배치
  // 웹의 getBoundingClientRect() 좌표를 그대로 사용하여 캡처 이미지와 일치시킴
  node.x = el.x;
  node.y = el.y;
  rootFrame.appendChild(node);
  nodeMap[el.id] = node;
}

// ── 타이포그래피 카드 (Phase 14: 일관성 배지 추가, B단계: 실제 스타일 적용) ──

function createTypographyCard(
  style: TypographyStyle,
  consistency?: number,
  registeredTextStyle?: TextStyle,
  registeredPaintStyle?: PaintStyle
): FrameNode {
  var card = createAutoFrame("Type Card", "VERTICAL", 8, 16);
  card.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.92 } }];
  card.strokeWeight = 1;

  // 상단: 셀렉터 + 빈도 배지 + 일관성 배지
  var topRow = createAutoFrame("Top", "HORIZONTAL", 6, 0);
  topRow.counterAxisAlignItems = "CENTER";

  var selectorTag = figma.createText();
  selectorTag.fontName = { family: "Inter", style: "Bold" };
  selectorTag.characters = "<" + style.selector + ">";
  selectorTag.fontSize = 10;
  selectorTag.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.55 } }];
  topRow.appendChild(selectorTag);

  // 빈도 배지
  var count = style.count || 1;
  var countColor = count >= 10 ? { r: 0.94, g: 0.35, b: 0.13 } : count >= 3 ? { r: 0.09, g: 0.63, b: 0.49 } : { r: 0.6, g: 0.6, b: 0.65 };
  topRow.appendChild(createBadge(count + "x", countColor, { r: 1, g: 1, b: 1 }));

  // Phase 14-1: 일관성 배지
  if (consistency !== undefined && consistency >= 80) {
    topRow.appendChild(createBadge("Consistent " + consistency + "%", { r: 0.09, g: 0.55, b: 0.35 }, { r: 1, g: 1, b: 1 }));
  }

  card.appendChild(topRow);

  var result = createSampleText(style, registeredTextStyle, registeredPaintStyle);
  card.appendChild(result.sample);
  card.appendChild(createDivider());
  card.appendChild(createStylePropsGrid(style, result.isOriginalFont));
  card.appendChild(createColorSwatchRow(style, registeredPaintStyle));

  return card;
}

// ── 컬러 팔레트 카드 ──

interface ColorInfo {
  hex: string;
  count: number;
  selectors: string[];
}

function extractColors(styles: TypographyStyle[]): ColorInfo[] {
  var colorMap: Record<string, ColorInfo> = {};
  for (var i = 0; i < styles.length; i++) {
    var s = styles[i];
    var hex = s.color.toLowerCase();
    if (!hex.startsWith("#") || hex.length !== 7) continue;
    if (!colorMap[hex]) {
      colorMap[hex] = { hex: hex, count: 0, selectors: [] };
    }
    colorMap[hex].count++;
    if (colorMap[hex].selectors.indexOf(s.selector) === -1) {
      colorMap[hex].selectors.push(s.selector);
    }
  }
  var result: ColorInfo[] = [];
  for (var key in colorMap) {
    result.push(colorMap[key]);
  }
  result.sort(function (a, b) { return b.count - a.count; });
  return result;
}

function createColorCard(info: ColorInfo): FrameNode {
  var card = createAutoFrame("Color Card", "HORIZONTAL", 10, 12);
  card.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.92 } }];
  card.strokeWeight = 1;
  card.counterAxisAlignItems = "CENTER";

  var swatch = figma.createRectangle();
  swatch.resize(40, 40);
  swatch.cornerRadius = 6;
  swatch.fills = [{ type: "SOLID", color: hexToRgb(info.hex) }];
  swatch.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.88 } }];
  swatch.strokeWeight = 1;
  card.appendChild(swatch);

  var textCol = createAutoFrame("Color Info", "VERTICAL", 2, 0);

  var hexLabel = figma.createText();
  hexLabel.fontName = { family: "Inter", style: "Bold" };
  hexLabel.characters = info.hex.toUpperCase();
  hexLabel.fontSize = 12;
  hexLabel.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
  textCol.appendChild(hexLabel);

  var usageLabel = figma.createText();
  usageLabel.fontName = { family: "Inter", style: "Regular" };
  usageLabel.characters = "Used " + info.count + "x \u00B7 " + info.selectors.join(", ");
  usageLabel.fontSize = 10;
  usageLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
  textCol.appendChild(usageLabel);

  card.appendChild(textCol);
  return card;
}

// ── 의미 그룹별 스타일 분류 (Phase 9) ──

function groupBySemanticGroup(styles: TypographyStyle[]): Record<string, TypographyStyle[]> {
  var groups: Record<string, TypographyStyle[]> = {};
  for (var i = 0; i < styles.length; i++) {
    var group = styles[i].semanticGroup || "other";
    if (!groups[group]) groups[group] = [];
    groups[group].push(styles[i]);
  }
  return groups;
}

// ── Phase 11-2: 컴포넌트 규격 카드 ──

function createComponentSpecCard(spec: ComponentSpec): FrameNode {
  var card = createAutoFrame("Component Card", "VERTICAL", 8, 16);
  card.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.98, b: 1 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.9, b: 0.96 } }];
  card.strokeWeight = 1;

  // 상단: 셀렉터 + 빈도
  var topRow = createAutoFrame("Top", "HORIZONTAL", 6, 0);
  topRow.counterAxisAlignItems = "CENTER";

  var selectorTag = figma.createText();
  selectorTag.fontName = { family: "Inter", style: "Bold" };
  selectorTag.characters = "<" + spec.selector + ">";
  selectorTag.fontSize = 11;
  selectorTag.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.35, b: 0.6 } }];
  topRow.appendChild(selectorTag);

  topRow.appendChild(createBadge(spec.count + "x", { r: 0.2, g: 0.45, b: 0.8 }, { r: 1, g: 1, b: 1 }));
  card.appendChild(topRow);

  // 규격 미리보기 (간략한 박스)
  var previewHeight = Math.min(Math.max(spec.height, 24), 56);
  var previewBR = Math.min(spec.borderRadius, previewHeight / 2);
  var preview = figma.createRectangle();
  preview.resize(CARD_WIDTH - 64, previewHeight);
  preview.cornerRadius = previewBR;
  if (spec.backgroundColor.startsWith("#") && spec.backgroundColor.length === 7) {
    preview.fills = [{ type: "SOLID", color: hexToRgb(spec.backgroundColor) }];
  } else {
    preview.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.93, b: 0.96 } }];
  }
  if (spec.borderWidth > 0 && spec.borderColor.startsWith("#") && spec.borderColor.length === 7) {
    preview.strokes = [{ type: "SOLID", color: hexToRgb(spec.borderColor) }];
    preview.strokeWeight = Math.min(spec.borderWidth, 3);
  }
  card.appendChild(preview);

  card.appendChild(createDivider());

  // 속성 그리드
  card.appendChild(createPropsGrid("Spec Info", [
    { label: "Height", value: Math.round(spec.height) + "px" },
    { label: "Padding", value: spec.paddingTop + " " + spec.paddingRight + " " + spec.paddingBottom + " " + spec.paddingLeft },
    { label: "Radius", value: Math.round(spec.borderRadius) + "px" },
    { label: "Font", value: spec.fontSize + "px / " + spec.fontWeight },
    { label: "Border", value: spec.borderWidth > 0 ? spec.borderWidth + "px" : "none" },
  ], 10));

  // 컬러 행
  var colorRow = createAutoFrame("Colors", "HORIZONTAL", 12, 0);
  colorRow.counterAxisAlignItems = "CENTER";

  if (spec.backgroundColor.startsWith("#") && spec.backgroundColor.length === 7) {
    var bgCol = createAutoFrame("BG", "HORIZONTAL", 4, 0);
    bgCol.counterAxisAlignItems = "CENTER";
    var bgSw = figma.createRectangle();
    bgSw.resize(16, 16);
    bgSw.cornerRadius = 3;
    bgSw.fills = [{ type: "SOLID", color: hexToRgb(spec.backgroundColor) }];
    bgSw.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    bgSw.strokeWeight = 1;
    bgCol.appendChild(bgSw);
    var bgLbl = figma.createText();
    bgLbl.fontName = { family: "Inter", style: "Regular" };
    bgLbl.characters = "bg " + spec.backgroundColor;
    bgLbl.fontSize = 9;
    bgLbl.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    bgCol.appendChild(bgLbl);
    colorRow.appendChild(bgCol);
  }

  if (spec.borderColor.startsWith("#") && spec.borderColor.length === 7 && spec.borderWidth > 0) {
    var brCol = createAutoFrame("BR", "HORIZONTAL", 4, 0);
    brCol.counterAxisAlignItems = "CENTER";
    var brSw = figma.createRectangle();
    brSw.resize(16, 16);
    brSw.cornerRadius = 3;
    brSw.fills = [{ type: "SOLID", color: hexToRgb(spec.borderColor) }];
    brSw.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    brSw.strokeWeight = 1;
    brCol.appendChild(brSw);
    var brLbl = figma.createText();
    brLbl.fontName = { family: "Inter", style: "Regular" };
    brLbl.characters = "border " + spec.borderColor;
    brLbl.fontSize = 9;
    brLbl.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    brCol.appendChild(brLbl);
    colorRow.appendChild(brCol);
  }

  card.appendChild(colorRow);

  return card;
}

function renderComponentSpecsSection(specs: ComponentSpec[]): FrameNode {
  var section = createAutoFrame("Component Specs", "VERTICAL", CARD_GAP + 8, 0);
  section.appendChild(createSectionHeader("Interactive Components", specs.length + " component specs"));

  var grid = createAutoFrame("Comp Grid", "HORIZONTAL", CARD_GAP, 0);
  grid.layoutWrap = "WRAP" as any;
  grid.counterAxisSpacing = CARD_GAP;
  grid.layoutSizingHorizontal = "FIXED";
  grid.resize(GRID_WIDTH, grid.height);

  for (var i = 0; i < specs.length; i++) {
    var card = createComponentSpecCard(specs[i]);
    card.layoutSizingHorizontal = "FIXED";
    card.resize(CARD_WIDTH, card.height);
    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

// ── Phase 12: 클러스터 시각화 ──

function renderClusterSection(clusters: StyleCluster[]): FrameNode {
  var section = createAutoFrame("Style Clusters", "VERTICAL", CARD_GAP + 8, 0);
  section.appendChild(createSectionHeader("Style Clusters", clusters.length + " groups of similar styles"));

  for (var i = 0; i < clusters.length; i++) {
    var cluster = clusters[i];
    var clusterFrame = createAutoFrame("Cluster " + (i + 1), "VERTICAL", 8, 16);
    clusterFrame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.97, b: 1 } }];
    clusterFrame.cornerRadius = 10;
    clusterFrame.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.9, b: 0.96 } }];
    clusterFrame.strokeWeight = 1;
    clusterFrame.layoutSizingHorizontal = "FIXED";
    clusterFrame.resize(GRID_WIDTH, clusterFrame.height);

    // Base Style 라벨
    var baseRow = createAutoFrame("Base", "HORIZONTAL", 6, 0);
    baseRow.counterAxisAlignItems = "CENTER";

    baseRow.appendChild(createBadge("BASE", { r: 0.35, g: 0.2, b: 0.7 }, { r: 1, g: 1, b: 1 }));

    var baseDesc = figma.createText();
    baseDesc.fontName = { family: "Inter", style: "Bold" };
    baseDesc.characters = "<" + cluster.baseStyle.selector + "> " + shortFontName(cluster.baseStyle.fontFamily) + " " + cluster.baseStyle.fontSize + "px / " + cluster.baseStyle.fontWeight + " (" + cluster.baseStyle.count + "x)";
    baseDesc.fontSize = 11;
    baseDesc.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.2 } }];
    baseRow.appendChild(baseDesc);

    clusterFrame.appendChild(baseRow);

    // Variant 목록
    for (var vi = 0; vi < cluster.variants.length; vi++) {
      var variant = cluster.variants[vi];
      var varRow = createAutoFrame("Variant", "HORIZONTAL", 6, 0);
      varRow.counterAxisAlignItems = "CENTER";
      varRow.paddingLeft = 16;

      varRow.appendChild(createBadge("VARIANT", { r: 0.6, g: 0.55, b: 0.7 }, { r: 1, g: 1, b: 1 }));

      var varDesc = figma.createText();
      varDesc.fontName = { family: "Inter", style: "Regular" };
      varDesc.characters = "<" + variant.selector + "> " + shortFontName(variant.fontFamily) + " " + variant.fontSize + "px / " + variant.fontWeight + " (" + variant.count + "x)";
      varDesc.fontSize = 10;
      varDesc.fills = [{ type: "SOLID", color: { r: 0.35, g: 0.35, b: 0.4 } }];
      varRow.appendChild(varDesc);

      // 차이 표시
      var diffParts: string[] = [];
      if (variant.fontSize !== cluster.baseStyle.fontSize) {
        diffParts.push("size " + (variant.fontSize > cluster.baseStyle.fontSize ? "+" : "") + Math.round((variant.fontSize - cluster.baseStyle.fontSize) * 10) / 10 + "px");
      }
      if (variant.fontWeight !== cluster.baseStyle.fontWeight) {
        diffParts.push("weight " + (variant.fontWeight > cluster.baseStyle.fontWeight ? "+" : "") + (variant.fontWeight - cluster.baseStyle.fontWeight));
      }
      if (diffParts.length > 0) {
        var diffLabel = figma.createText();
        diffLabel.fontName = { family: "Inter", style: "Regular" };
        diffLabel.characters = "(" + diffParts.join(", ") + ")";
        diffLabel.fontSize = 9;
        diffLabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.45, b: 0.6 } }];
        varRow.appendChild(diffLabel);
      }

      clusterFrame.appendChild(varRow);
    }

    section.appendChild(clusterFrame);
  }

  return section;
}

// ── Phase 12-2: 파편화 경고 섹션 ──

function renderFragmentationSection(fragmentations: FragmentationWarning[]): FrameNode {
  var section = createAutoFrame("Fragmentation Alerts", "VERTICAL", CARD_GAP, 0);
  section.appendChild(createSectionHeader("Fragmentation Alerts", fragmentations.length + " selectors with high variance"));

  for (var i = 0; i < fragmentations.length; i++) {
    var frag = fragmentations[i];
    var fragCard = createAutoFrame("Frag " + frag.selector, "VERTICAL", 6, 12);
    var isSevere = frag.variantCount >= 5;
    fragCard.fills = [{ type: "SOLID", color: isSevere ? { r: 1, g: 0.95, b: 0.94 } : { r: 1, g: 0.98, b: 0.94 } }];
    fragCard.cornerRadius = 8;
    fragCard.strokes = [{ type: "SOLID", color: isSevere ? { r: 0.95, g: 0.82, b: 0.8 } : { r: 0.95, g: 0.9, b: 0.82 } }];
    fragCard.strokeWeight = 1;
    fragCard.layoutSizingHorizontal = "FIXED";
    fragCard.resize(GRID_WIDTH, fragCard.height);

    var fragRow = createAutoFrame("Frag Row", "HORIZONTAL", 8, 0);
    fragRow.counterAxisAlignItems = "CENTER";

    fragRow.appendChild(createBadge(
      isSevere ? "HIGH RISK" : "WARNING",
      isSevere ? { r: 0.9, g: 0.2, b: 0.15 } : { r: 0.9, g: 0.6, b: 0.1 },
      { r: 1, g: 1, b: 1 }
    ));

    var fragLabel = figma.createText();
    fragLabel.fontName = { family: "Inter", style: "Bold" };
    fragLabel.characters = "<" + frag.selector + ">: " + frag.variantCount + " variants detected";
    fragLabel.fontSize = 11;
    fragLabel.fills = [{ type: "SOLID", color: isSevere ? { r: 0.7, g: 0.15, b: 0.1 } : { r: 0.6, g: 0.4, b: 0.05 } }];
    fragRow.appendChild(fragLabel);
    fragCard.appendChild(fragRow);

    // 변형 스타일 요약
    for (var fi = 0; fi < Math.min(frag.styles.length, 6); fi++) {
      var fs = frag.styles[fi];
      var fsLabel = figma.createText();
      fsLabel.fontName = { family: "Inter", style: "Regular" };
      fsLabel.characters = "  " + shortFontName(fs.fontFamily) + " " + fs.fontSize + "px / " + fs.fontWeight + " " + fs.color + " (" + fs.count + "x)";
      fsLabel.fontSize = 9;
      fsLabel.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
      fragCard.appendChild(fsLabel);
    }
    if (frag.styles.length > 6) {
      var moreLabel = figma.createText();
      moreLabel.fontName = { family: "Inter", style: "Regular" };
      moreLabel.characters = "  +" + (frag.styles.length - 6) + " more variants";
      moreLabel.fontSize = 9;
      moreLabel.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.55 } }];
      fragCard.appendChild(moreLabel);
    }

    section.appendChild(fragCard);
  }

  return section;
}

// ── Phase 13: 시스템 뷰 (위계 트리) ──

var HIERARCHY_LABELS: Record<string, string> = {
  heading: "Heading Hierarchy",
  body: "Body Text System",
  interactive: "Action System",
  navigation: "Navigation System",
  table: "Table System",
  other: "Other",
};

function renderHierarchySection(hierarchy: Record<string, HierarchyNode[]>): FrameNode {
  var section = createAutoFrame("System View", "VERTICAL", SECTION_GAP, 0);
  section.appendChild(createSectionHeader("System View", "Semantic hierarchy with Base / Variant structure"));

  for (var gi = 0; gi < SEMANTIC_ORDER.length; gi++) {
    var groupKey = SEMANTIC_ORDER[gi];
    var nodes = hierarchy[groupKey];
    if (!nodes || nodes.length === 0) continue;

    var groupFrame = createAutoFrame(HIERARCHY_LABELS[groupKey] || groupKey, "VERTICAL", 10, 16);
    groupFrame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
    groupFrame.cornerRadius = 10;
    groupFrame.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.94 } }];
    groupFrame.strokeWeight = 1;
    groupFrame.layoutSizingHorizontal = "FIXED";
    groupFrame.resize(GRID_WIDTH, groupFrame.height);

    // 그룹 타이틀
    var groupTitle = figma.createText();
    groupTitle.fontName = { family: "Inter", style: "Bold" };
    groupTitle.characters = HIERARCHY_LABELS[groupKey] || groupKey;
    groupTitle.fontSize = 14;
    groupTitle.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.2 } }];
    groupFrame.appendChild(groupTitle);

    groupFrame.appendChild(createDivider({ r: 0.88, g: 0.88, b: 0.9 }));

    for (var ni = 0; ni < nodes.length; ni++) {
      var node = nodes[ni];

      // Base style row
      var baseRow = createAutoFrame("Base " + node.role, "HORIZONTAL", 8, 0);
      baseRow.counterAxisAlignItems = "CENTER";

      // 위계 커넥터 바
      var connector = figma.createRectangle();
      connector.resize(3, 18);
      connector.cornerRadius = 2;
      connector.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.4, b: 0.8 } }];
      baseRow.appendChild(connector);

      baseRow.appendChild(createBadge("BASE", { r: 0.25, g: 0.35, b: 0.75 }, { r: 1, g: 1, b: 1 }));

      var baseLabel = figma.createText();
      baseLabel.fontName = { family: "Inter", style: "Bold" };
      baseLabel.characters = node.role.toUpperCase();
      baseLabel.fontSize = 12;
      baseLabel.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.2 } }];
      baseRow.appendChild(baseLabel);

      var baseSpec = figma.createText();
      baseSpec.fontName = { family: "Inter", style: "Regular" };
      baseSpec.characters = shortFontName(node.baseStyle.fontFamily) + " " + node.baseStyle.fontSize + "px / " + node.baseStyle.fontWeight + " \u00B7 LH " + Math.round(node.baseStyle.lineHeight) + "px \u00B7 " + node.baseStyle.count + "x";
      baseSpec.fontSize = 10;
      baseSpec.fills = [{ type: "SOLID", color: { r: 0.35, g: 0.35, b: 0.4 } }];
      baseRow.appendChild(baseSpec);

      groupFrame.appendChild(baseRow);

      // Variant rows
      for (var vi = 0; vi < node.variants.length; vi++) {
        var variant = node.variants[vi];
        var varRow = createAutoFrame("Variant " + vi, "HORIZONTAL", 8, 0);
        varRow.counterAxisAlignItems = "CENTER";
        varRow.paddingLeft = 20;

        // 인덴트 커넥터
        var varConn = figma.createRectangle();
        varConn.resize(2, 14);
        varConn.cornerRadius = 1;
        varConn.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.8 } }];
        varRow.appendChild(varConn);

        var varLabel = figma.createText();
        varLabel.fontName = { family: "Inter", style: "Regular" };
        varLabel.characters = shortFontName(variant.fontFamily) + " " + variant.fontSize + "px / " + variant.fontWeight + " \u00B7 " + variant.color + " (" + variant.count + "x)";
        varLabel.fontSize = 9;
        varLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
        varRow.appendChild(varLabel);

        groupFrame.appendChild(varRow);
      }
    }

    section.appendChild(groupFrame);
  }

  return section;
}

// ── Phase 14: 디자인 감사 리포트 섹션 ──

function renderAuditSection(audit: AuditResult, scaleSystem: string | null): FrameNode {
  var section = createAutoFrame("Design Audit", "VERTICAL", 20, 0);
  section.appendChild(createSectionHeader("Design Audit Report"));

  // ── 시스템 점수 카드 ──
  var scoreCard = createAutoFrame("System Score", "VERTICAL", 12, 20);
  scoreCard.layoutSizingHorizontal = "FIXED";
  scoreCard.resize(GRID_WIDTH, scoreCard.height);
  var scoreColor = getScoreColor(audit.systemScore);
  scoreCard.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  scoreCard.cornerRadius = 12;
  scoreCard.strokes = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.92 } }];
  scoreCard.strokeWeight = 1;

  // 점수 표시
  var scoreRow = createAutoFrame("Score Row", "HORIZONTAL", 12, 0);
  scoreRow.counterAxisAlignItems = "CENTER";

  var scoreNum = figma.createText();
  scoreNum.fontName = { family: "Inter", style: "Bold" };
  scoreNum.characters = String(audit.systemScore);
  scoreNum.fontSize = 36;
  scoreNum.fills = [{ type: "SOLID", color: scoreColor }];
  scoreRow.appendChild(scoreNum);

  var scoreInfo = createAutoFrame("Score Info", "VERTICAL", 2, 0);
  var scoreTitle = figma.createText();
  scoreTitle.fontName = { family: "Inter", style: "Bold" };
  scoreTitle.characters = "System Score";
  scoreTitle.fontSize = 12;
  scoreTitle.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
  scoreInfo.appendChild(scoreTitle);

  var scoreDesc = figma.createText();
  scoreDesc.fontName = { family: "Inter", style: "Regular" };
  var scoreLevel = audit.systemScore >= 80 ? "Well-structured design system" : audit.systemScore >= 50 ? "Moderate consistency, room for improvement" : "Low consistency, significant fragmentation";
  scoreDesc.characters = scoreLevel;
  scoreDesc.fontSize = 10;
  scoreDesc.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  scoreInfo.appendChild(scoreDesc);
  scoreRow.appendChild(scoreInfo);

  scoreCard.appendChild(scoreRow);

  // 요약 배지 행
  var badgeRow = createAutoFrame("Badges", "HORIZONTAL", 8, 0);
  badgeRow.counterAxisAlignItems = "CENTER";

  if (scaleSystem) {
    badgeRow.appendChild(createBadge(scaleSystem + " grid", { r: 0.13, g: 0.52, b: 0.96 }, { r: 1, g: 1, b: 1 }));
  }
  if (audit.typeScaleRatio) {
    badgeRow.appendChild(createBadge("Scale " + audit.typeScaleRatio + "x", { r: 0.45, g: 0.3, b: 0.75 }, { r: 1, g: 1, b: 1 }));
  }
  var errorCount = 0;
  var warnCount = 0;
  for (var ai = 0; ai < audit.anomalies.length; ai++) {
    if (audit.anomalies[ai].severity === "error") errorCount++;
    else warnCount++;
  }
  if (errorCount > 0) {
    badgeRow.appendChild(createBadge(errorCount + " errors", { r: 0.85, g: 0.2, b: 0.15 }, { r: 1, g: 1, b: 1 }));
  }
  if (warnCount > 0) {
    badgeRow.appendChild(createBadge(warnCount + " warnings", { r: 0.9, g: 0.6, b: 0.1 }, { r: 1, g: 1, b: 1 }));
  }

  scoreCard.appendChild(badgeRow);
  section.appendChild(scoreCard);

  // ── 이상 탐지 목록 ──
  if (audit.anomalies.length > 0) {
    var anomalySection = createAutoFrame("Anomalies", "VERTICAL", 8, 0);

    var anomalyTitle = figma.createText();
    anomalyTitle.fontName = { family: "Inter", style: "Bold" };
    anomalyTitle.characters = "Issues Detected";
    anomalyTitle.fontSize = 13;
    anomalyTitle.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
    anomalySection.appendChild(anomalyTitle);

    for (var ani = 0; ani < audit.anomalies.length; ani++) {
      var anomaly = audit.anomalies[ani];
      var isError = anomaly.severity === "error";

      var anomalyRow = createAutoFrame("Anomaly", "HORIZONTAL", 8, 8);
      anomalyRow.counterAxisAlignItems = "CENTER";
      anomalyRow.fills = [{ type: "SOLID", color: isError ? { r: 1, g: 0.96, b: 0.95 } : { r: 1, g: 0.98, b: 0.95 } }];
      anomalyRow.cornerRadius = 6;
      anomalyRow.layoutSizingHorizontal = "FIXED";
      anomalyRow.resize(GRID_WIDTH, anomalyRow.height);

      // 아이콘 배지
      var iconLabel = "";
      if (anomaly.type === "hierarchy_inversion") iconLabel = "HIERARCHY";
      else if (anomaly.type === "font_mixing") iconLabel = "FONT MIX";
      else iconLabel = "FRAGMENT";

      anomalyRow.appendChild(createBadge(
        iconLabel,
        isError ? { r: 0.85, g: 0.2, b: 0.15 } : { r: 0.9, g: 0.6, b: 0.1 },
        { r: 1, g: 1, b: 1 }
      ));

      var anomalyText = figma.createText();
      anomalyText.fontName = { family: "Inter", style: "Regular" };
      anomalyText.characters = anomaly.message;
      anomalyText.fontSize = 10;
      anomalyText.fills = [{ type: "SOLID", color: isError ? { r: 0.6, g: 0.15, b: 0.1 } : { r: 0.55, g: 0.35, b: 0.05 } }];
      anomalyRow.appendChild(anomalyText);

      anomalySection.appendChild(anomalyRow);
    }

    section.appendChild(anomalySection);
  }

  // ── 일관성 요약 ──
  var consistencyKeys = Object.keys(audit.consistencyMap);
  if (consistencyKeys.length > 0) {
    var consSection = createAutoFrame("Consistency", "VERTICAL", 6, 0);

    var consTitle = figma.createText();
    consTitle.fontName = { family: "Inter", style: "Bold" };
    consTitle.characters = "Selector Consistency";
    consTitle.fontSize = 13;
    consTitle.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
    consSection.appendChild(consTitle);

    var consGrid = createAutoFrame("Cons Grid", "HORIZONTAL", 8, 0);
    consGrid.layoutWrap = "WRAP" as any;
    consGrid.counterAxisSpacing = 6;
    consGrid.layoutSizingHorizontal = "FIXED";
    consGrid.resize(GRID_WIDTH, consGrid.height);

    for (var ci = 0; ci < consistencyKeys.length; ci++) {
      var sel = consistencyKeys[ci];
      var pct = audit.consistencyMap[sel];
      var pctColor = getScoreColor(pct);
      consGrid.appendChild(createBadge("<" + sel + "> " + pct + "%", pctColor, { r: 1, g: 1, b: 1 }));
    }

    consSection.appendChild(consGrid);
    section.appendChild(consSection);
  }

  return section;
}

// ── 대시보드 (Phase 8 + 10 + 14) ──

interface SiteSummary {
  url: string;
  topColors: ColorInfo[];
  primaryFont: string;
  fontSizes: number[];
  styleCount: number;
  scaleSystem: string | null;
  topStyles: TypographyStyle[];
  systemScore: number | null;
}

function buildSummary(result: ExtractResult): SiteSummary {
  var styles = result.data || [];
  var colors = extractColors(styles);

  var fontCount: Record<string, number> = {};
  for (var i = 0; i < styles.length; i++) {
    var name = shortFontName(styles[i].fontFamily);
    fontCount[name] = (fontCount[name] || 0) + 1;
  }
  var primaryFont = "";
  var maxCount = 0;
  for (var key in fontCount) {
    if (fontCount[key] > maxCount) {
      maxCount = fontCount[key];
      primaryFont = key;
    }
  }

  var sizeSet: Record<number, boolean> = {};
  for (var j = 0; j < styles.length; j++) {
    sizeSet[styles[j].fontSize] = true;
  }
  var fontSizes: number[] = [];
  for (var s in sizeSet) {
    fontSizes.push(Number(s));
  }
  fontSizes.sort(function (a, b) { return a - b; });

  // 빈도순 Top 5
  var sorted = styles.slice().sort(function (a, b) { return (b.count || 1) - (a.count || 1); });

  return {
    url: result.url,
    topColors: colors.slice(0, 3),
    primaryFont: primaryFont,
    fontSizes: fontSizes,
    styleCount: styles.length,
    scaleSystem: result.scaleSystem || null,
    topStyles: sorted.slice(0, 5),
    systemScore: result.audit ? result.audit.systemScore : null,
  };
}

function createDashboardCard(summary: SiteSummary): FrameNode {
  var card = createAutoFrame(summary.url, "VERTICAL", 10, 16);
  card.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 1 } }];
  card.cornerRadius = 10;
  card.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.92 } }];
  card.strokeWeight = 1;
  card.layoutSizingHorizontal = "FIXED";
  card.resize(280, card.height);

  var urlLabel = figma.createText();
  urlLabel.fontName = { family: "Inter", style: "Bold" };
  urlLabel.characters = summary.url;
  urlLabel.fontSize = 11;
  urlLabel.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.25 } }];
  card.appendChild(urlLabel);

  // 스타일 수 + 시스템 점수
  var summaryRow = createAutoFrame("Summary", "HORIZONTAL", 8, 0);
  summaryRow.counterAxisAlignItems = "CENTER";

  var countLabel = figma.createText();
  countLabel.fontName = { family: "Inter", style: "Regular" };
  countLabel.characters = summary.styleCount + " styles extracted";
  countLabel.fontSize = 10;
  countLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  summaryRow.appendChild(countLabel);

  // Phase 14: 시스템 점수 배지
  if (summary.systemScore !== null) {
    summaryRow.appendChild(createBadge("Score: " + summary.systemScore, getScoreColor(summary.systemScore), { r: 1, g: 1, b: 1 }));
  }

  card.appendChild(summaryRow);

  // 스케일 시스템 (Phase 10)
  if (summary.scaleSystem) {
    var scaleBadge = createAutoFrame("Scale", "HORIZONTAL", 4, 0);
    scaleBadge.paddingLeft = 8;
    scaleBadge.paddingRight = 8;
    scaleBadge.paddingTop = 3;
    scaleBadge.paddingBottom = 3;
    scaleBadge.cornerRadius = 6;
    scaleBadge.fills = [{ type: "SOLID", color: { r: 0.13, g: 0.52, b: 0.96 } }];

    var scaleText = figma.createText();
    scaleText.fontName = { family: "Inter", style: "Bold" };
    scaleText.characters = summary.scaleSystem + " grid detected";
    scaleText.fontSize = 9;
    scaleText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    scaleBadge.appendChild(scaleText);
    card.appendChild(scaleBadge);
  }

  card.appendChild(createDivider({ r: 0.88, g: 0.88, b: 0.92 }));

  // Primary Font
  var fontRow = createAutoFrame("Font", "VERTICAL", 2, 0);
  var fontLabel = figma.createText();
  fontLabel.fontName = { family: "Inter", style: "Bold" };
  fontLabel.characters = "Primary Font";
  fontLabel.fontSize = 9;
  fontLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  fontRow.appendChild(fontLabel);
  var fontValue = figma.createText();
  fontValue.fontName = { family: "Inter", style: "Regular" };
  fontValue.characters = summary.primaryFont || "N/A";
  fontValue.fontSize = 12;
  fontValue.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
  fontRow.appendChild(fontValue);
  card.appendChild(fontRow);

  // Most Used Styles Top 5 (Phase 10)
  var topLabel = figma.createText();
  topLabel.fontName = { family: "Inter", style: "Bold" };
  topLabel.characters = "Most Used Styles";
  topLabel.fontSize = 9;
  topLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  card.appendChild(topLabel);

  for (var ti = 0; ti < summary.topStyles.length; ti++) {
    var ts = summary.topStyles[ti];
    var tsRow = createAutoFrame("TS", "HORIZONTAL", 6, 0);
    tsRow.counterAxisAlignItems = "CENTER";

    var tsCount = figma.createText();
    tsCount.fontName = { family: "Inter", style: "Bold" };
    tsCount.characters = (ts.count || 1) + "x";
    tsCount.fontSize = 9;
    tsCount.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.35, b: 0.13 } }];
    tsRow.appendChild(tsCount);

    var tsDesc = figma.createText();
    tsDesc.fontName = { family: "Inter", style: "Regular" };
    tsDesc.characters = "<" + ts.selector + "> " + shortFontName(ts.fontFamily) + " " + ts.fontSize + "px";
    tsDesc.fontSize = 9;
    tsDesc.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    tsRow.appendChild(tsDesc);

    card.appendChild(tsRow);
  }

  // Font Sizes
  var sizesRow = createAutoFrame("Sizes", "VERTICAL", 2, 0);
  var sizesLabel = figma.createText();
  sizesLabel.fontName = { family: "Inter", style: "Bold" };
  sizesLabel.characters = "Font Sizes";
  sizesLabel.fontSize = 9;
  sizesLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  sizesRow.appendChild(sizesLabel);
  var sizesValue = figma.createText();
  sizesValue.fontName = { family: "Inter", style: "Regular" };
  sizesValue.characters = summary.fontSizes.join(", ") + " px";
  sizesValue.fontSize = 10;
  sizesValue.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
  sizesRow.appendChild(sizesValue);
  card.appendChild(sizesRow);

  // Top Colors
  var colorsLabel = figma.createText();
  colorsLabel.fontName = { family: "Inter", style: "Bold" };
  colorsLabel.characters = "Top Colors";
  colorsLabel.fontSize = 9;
  colorsLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.55 } }];
  card.appendChild(colorsLabel);

  var swatchRow = createAutoFrame("Swatches", "HORIZONTAL", 8, 0);
  for (var ci = 0; ci < summary.topColors.length; ci++) {
    var c = summary.topColors[ci];
    var swatchCol = createAutoFrame("SC", "VERTICAL", 2, 0);
    swatchCol.counterAxisAlignItems = "CENTER";
    var sw = figma.createRectangle();
    sw.resize(28, 28);
    sw.cornerRadius = 4;
    sw.fills = [{ type: "SOLID", color: hexToRgb(c.hex) }];
    sw.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    sw.strokeWeight = 1;
    swatchCol.appendChild(sw);
    var swLabel = figma.createText();
    swLabel.fontName = { family: "Inter", style: "Regular" };
    swLabel.characters = c.hex.toUpperCase();
    swLabel.fontSize = 8;
    swLabel.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    swatchCol.appendChild(swLabel);
    swatchRow.appendChild(swatchCol);
  }
  card.appendChild(swatchRow);

  return card;
}

// ── 비교 분석 (Phase 11) ──

interface ComparisonData {
  commonFonts: string[];
  commonColors: string[];
  commonSizes: number[];
  siteUniques: { url: string; fonts: string[]; colors: string[]; sizes: number[] }[];
}

function analyzeComparison(results: ExtractResult[]): ComparisonData {
  var successResults = results.filter(function (r) { return r.success && r.data && r.data.length > 0; });
  if (successResults.length < 2) return { commonFonts: [], commonColors: [], commonSizes: [], siteUniques: [] };

  var siteFonts: string[][] = [];
  var siteColors: string[][] = [];
  var siteSizes: number[][] = [];
  var siteUrls: string[] = [];

  for (var i = 0; i < successResults.length; i++) {
    var styles = successResults[i].data!;
    var fonts: Record<string, boolean> = {};
    var colors: Record<string, boolean> = {};
    var sizes: Record<number, boolean> = {};

    for (var j = 0; j < styles.length; j++) {
      fonts[shortFontName(styles[j].fontFamily)] = true;
      if (styles[j].color.startsWith("#") && styles[j].color.length === 7) {
        colors[styles[j].color.toLowerCase()] = true;
      }
      sizes[styles[j].fontSize] = true;
    }

    siteFonts.push(Object.keys(fonts));
    siteColors.push(Object.keys(colors));
    var sizeArr: number[] = [];
    for (var k in sizes) sizeArr.push(Number(k));
    siteSizes.push(sizeArr);
    siteUrls.push(successResults[i].url);
  }

  function intersectStrings(arrays: string[][]): string[] {
    if (arrays.length === 0) return [];
    var result = arrays[0].slice();
    for (var a = 1; a < arrays.length; a++) {
      result = result.filter(function (item) { return arrays[a].indexOf(item) !== -1; });
    }
    return result;
  }

  function intersectNumbers(arrays: number[][]): number[] {
    if (arrays.length === 0) return [];
    var result = arrays[0].slice();
    for (var a = 1; a < arrays.length; a++) {
      result = result.filter(function (item) { return arrays[a].indexOf(item) !== -1; });
    }
    return result.sort(function (a, b) { return a - b; });
  }

  var commonFonts = intersectStrings(siteFonts);
  var commonColors = intersectStrings(siteColors);
  var commonSizes = intersectNumbers(siteSizes);

  var siteUniques: ComparisonData["siteUniques"] = [];
  for (var si = 0; si < successResults.length; si++) {
    var uniqueFonts = siteFonts[si].filter(function (f) { return commonFonts.indexOf(f) === -1; });
    var uniqueColors = siteColors[si].filter(function (c) { return commonColors.indexOf(c) === -1; });
    var uniqueSizes = siteSizes[si].filter(function (s) { return commonSizes.indexOf(s) === -1; }).sort(function (a, b) { return a - b; });
    siteUniques.push({ url: siteUrls[si], fonts: uniqueFonts, colors: uniqueColors, sizes: uniqueSizes });
  }

  return { commonFonts: commonFonts, commonColors: commonColors, commonSizes: commonSizes, siteUniques: siteUniques };
}

function renderComparisonSection(comparison: ComparisonData): FrameNode {
  var section = createAutoFrame("Comparison", "VERTICAL", 16, 0);

  section.appendChild(createSectionHeader("Style Comparison", "Common & unique elements across sites"));

  // ── 공통 요소 ──
  var commonFrame = createAutoFrame("Common Styles", "VERTICAL", 10, 16);
  commonFrame.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.98, b: 0.94 } }];
  commonFrame.cornerRadius = 8;
  commonFrame.layoutSizingHorizontal = "FIXED";
  commonFrame.resize(GRID_WIDTH, commonFrame.height);

  var commonTitle = figma.createText();
  commonTitle.fontName = { family: "Inter", style: "Bold" };
  commonTitle.characters = "Shared Across All Sites";
  commonTitle.fontSize = 12;
  commonTitle.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.5, b: 0.2 } }];
  commonFrame.appendChild(commonTitle);

  if (comparison.commonFonts.length > 0) {
    var cfRow = createAutoFrame("CF", "VERTICAL", 2, 0);
    var cfLabel = figma.createText();
    cfLabel.fontName = { family: "Inter", style: "Bold" };
    cfLabel.characters = "Common Fonts";
    cfLabel.fontSize = 9;
    cfLabel.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    cfRow.appendChild(cfLabel);
    var cfValue = figma.createText();
    cfValue.fontName = { family: "Inter", style: "Regular" };
    cfValue.characters = comparison.commonFonts.join(", ");
    cfValue.fontSize = 11;
    cfValue.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
    cfRow.appendChild(cfValue);
    commonFrame.appendChild(cfRow);
  }

  if (comparison.commonColors.length > 0) {
    var ccLabel = figma.createText();
    ccLabel.fontName = { family: "Inter", style: "Bold" };
    ccLabel.characters = "Common Colors";
    ccLabel.fontSize = 9;
    ccLabel.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    commonFrame.appendChild(ccLabel);

    var ccRow = createAutoFrame("CC", "HORIZONTAL", 6, 0);
    for (var ci = 0; ci < Math.min(comparison.commonColors.length, 8); ci++) {
      var hex = comparison.commonColors[ci];
      var ccCol = createAutoFrame("CCC", "VERTICAL", 2, 0);
      ccCol.counterAxisAlignItems = "CENTER";
      var ccSw = figma.createRectangle();
      ccSw.resize(24, 24);
      ccSw.cornerRadius = 4;
      ccSw.fills = [{ type: "SOLID", color: hexToRgb(hex) }];
      ccSw.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } }];
      ccSw.strokeWeight = 1;
      ccCol.appendChild(ccSw);
      var ccHex = figma.createText();
      ccHex.fontName = { family: "Inter", style: "Regular" };
      ccHex.characters = hex.toUpperCase();
      ccHex.fontSize = 7;
      ccHex.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
      ccCol.appendChild(ccHex);
      ccRow.appendChild(ccCol);
    }
    commonFrame.appendChild(ccRow);
  }

  if (comparison.commonSizes.length > 0) {
    var csRow = createAutoFrame("CS", "VERTICAL", 2, 0);
    var csLabel = figma.createText();
    csLabel.fontName = { family: "Inter", style: "Bold" };
    csLabel.characters = "Common Sizes";
    csLabel.fontSize = 9;
    csLabel.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
    csRow.appendChild(csLabel);
    var csValue = figma.createText();
    csValue.fontName = { family: "Inter", style: "Regular" };
    csValue.characters = comparison.commonSizes.join(", ") + " px";
    csValue.fontSize = 11;
    csValue.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
    csRow.appendChild(csValue);
    commonFrame.appendChild(csRow);
  }

  if (comparison.commonFonts.length === 0 && comparison.commonColors.length === 0 && comparison.commonSizes.length === 0) {
    var noneLabel = figma.createText();
    noneLabel.fontName = { family: "Inter", style: "Regular" };
    noneLabel.characters = "No shared styles found";
    noneLabel.fontSize = 11;
    noneLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
    commonFrame.appendChild(noneLabel);
  }

  section.appendChild(commonFrame);

  // ── 사이트별 고유 요소 ──
  var uniqueGrid = createAutoFrame("Unique Grid", "HORIZONTAL", CARD_GAP, 0);
  uniqueGrid.layoutWrap = "WRAP" as any;
  uniqueGrid.counterAxisSpacing = CARD_GAP;

  for (var ui = 0; ui < comparison.siteUniques.length; ui++) {
    var unique = comparison.siteUniques[ui];
    var uCard = createAutoFrame(unique.url, "VERTICAL", 8, 12);
    uCard.fills = [{ type: "SOLID", color: { r: 1, g: 0.97, b: 0.94 } }];
    uCard.cornerRadius = 8;
    uCard.strokes = [{ type: "SOLID", color: { r: 0.95, g: 0.88, b: 0.82 } }];
    uCard.strokeWeight = 1;
    uCard.layoutSizingHorizontal = "FIXED";
    uCard.resize(280, uCard.height);

    var uTitle = figma.createText();
    uTitle.fontName = { family: "Inter", style: "Bold" };
    uTitle.characters = "Unique to " + unique.url.replace(/https?:\/\//, "").replace(/\/$/, "");
    uTitle.fontSize = 10;
    uTitle.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.35, b: 0.1 } }];
    uCard.appendChild(uTitle);

    if (unique.fonts.length > 0) {
      var ufLabel = figma.createText();
      ufLabel.fontName = { family: "Inter", style: "Bold" };
      ufLabel.characters = "Unique Fonts";
      ufLabel.fontSize = 9;
      ufLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      uCard.appendChild(ufLabel);
      var ufVal = figma.createText();
      ufVal.fontName = { family: "Inter", style: "Regular" };
      ufVal.characters = unique.fonts.slice(0, 5).join(", ");
      ufVal.fontSize = 10;
      ufVal.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
      uCard.appendChild(ufVal);
    }

    if (unique.colors.length > 0) {
      var ucLabel = figma.createText();
      ucLabel.fontName = { family: "Inter", style: "Bold" };
      ucLabel.characters = "Unique Colors";
      ucLabel.fontSize = 9;
      ucLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      uCard.appendChild(ucLabel);

      var ucRow = createAutoFrame("UC", "HORIZONTAL", 4, 0);
      for (var uci = 0; uci < Math.min(unique.colors.length, 6); uci++) {
        var ucSw = figma.createRectangle();
        ucSw.resize(18, 18);
        ucSw.cornerRadius = 3;
        ucSw.fills = [{ type: "SOLID", color: hexToRgb(unique.colors[uci]) }];
        ucSw.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
        ucSw.strokeWeight = 1;
        ucRow.appendChild(ucSw);
      }
      if (unique.colors.length > 6) {
        var moreLabel = figma.createText();
        moreLabel.fontName = { family: "Inter", style: "Regular" };
        moreLabel.characters = "+" + (unique.colors.length - 6);
        moreLabel.fontSize = 9;
        moreLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
        ucRow.appendChild(moreLabel);
      }
      uCard.appendChild(ucRow);
    }

    if (unique.sizes.length > 0) {
      var usLabel = figma.createText();
      usLabel.fontName = { family: "Inter", style: "Bold" };
      usLabel.characters = "Unique Sizes";
      usLabel.fontSize = 9;
      usLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      uCard.appendChild(usLabel);
      var usVal = figma.createText();
      usVal.fontName = { family: "Inter", style: "Regular" };
      usVal.characters = unique.sizes.join(", ") + " px";
      usVal.fontSize = 10;
      usVal.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
      uCard.appendChild(usVal);
    }

    uniqueGrid.appendChild(uCard);
  }

  section.appendChild(uniqueGrid);
  return section;
}

function renderDashboard(results: ExtractResult[]): FrameNode {
  var dashboard = createAutoFrame("StyleGrabber Dashboard", "VERTICAL", 24, PADDING);
  dashboard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  dashboard.cornerRadius = 12;
  dashboard.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.92 } }];
  dashboard.strokeWeight = 1;

  dashboard.appendChild(createSectionHeader("Comparison Dashboard"));

  // 사이트별 요약 카드
  var grid = createAutoFrame("Dashboard Grid", "HORIZONTAL", 16, 0);
  grid.layoutWrap = "WRAP" as any;
  grid.counterAxisSpacing = 16;

  for (var i = 0; i < results.length; i++) {
    if (!results[i].success || !results[i].data) continue;
    grid.appendChild(createDashboardCard(buildSummary(results[i])));
  }

  dashboard.appendChild(grid);

  // 비교 분석 섹션 (Phase 11)
  var comparison = analyzeComparison(results);
  if (comparison.siteUniques.length >= 2) {
    dashboard.appendChild(renderComparisonSection(comparison));
  }

  return dashboard;
}

// ── Phase 20-21: Side-by-Side 캡처 + 어노테이션 ──

var CAPTURE_WIDTH = 720;

var ANNOTATION_COLORS: Record<string, RGB> = {
  heading: { r: 0.2, g: 0.4, b: 0.9 },
  body: { r: 0.1, g: 0.7, b: 0.4 },
  interactive: { r: 0.6, g: 0.25, b: 0.85 },
  navigation: { r: 0.9, g: 0.5, b: 0.1 },
  table: { r: 0.15, g: 0.6, b: 0.65 },
  other: { r: 0.5, g: 0.5, b: 0.55 },
};

var ANNOTATION_SEMANTIC_MAP: Record<string, string> = {
  h1: "heading", h2: "heading", h3: "heading",
  h4: "heading", h5: "heading", h6: "heading",
  p: "body", a: "navigation",
  button: "interactive", input: "interactive", textarea: "interactive",
};

function renderCaptureFrame(result: ExtractResult): FrameNode | null {
  if (!result.screenshot) return null;

  var captureFrame = createAutoFrame("Visual Capture: " + result.url, "VERTICAL", 12, PADDING);
  captureFrame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }];
  captureFrame.cornerRadius = 12;
  captureFrame.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.9 } }];
  captureFrame.strokeWeight = 1;

  // 상단: URL + VISUAL CAPTURE 배지
  var headerRow = createAutoFrame("Capture Header", "HORIZONTAL", 8, 0);
  headerRow.counterAxisAlignItems = "CENTER";
  headerRow.appendChild(createBadge("VISUAL CAPTURE", { r: 0.13, g: 0.45, b: 0.85 }, { r: 1, g: 1, b: 1 }));
  headerRow.appendChild(createTextNode(result.url, 11, { r: 0.35, g: 0.35, b: 0.4 }));
  captureFrame.appendChild(headerRow);

  // 스크린샷 이미지 — base64 정제 후 디코딩
  var cleanBase64 = result.screenshot.replace(/[\s\r\n]/g, "");
  // padding 보정
  var pad = cleanBase64.length % 4;
  if (pad > 0) {
    cleanBase64 += "====".substring(pad);
  }
  var imageBytes = figma.base64Decode(cleanBase64);
  var image = figma.createImage(imageBytes);
  var imageSize = image.getSizeAsync ? null : null; // size will be inferred

  // 이미지를 담을 컨테이너 (위치 매핑을 위해 일반 Frame 사용)
  var imgContainer = figma.createFrame();
  imgContainer.name = "Screenshot";
  imgContainer.layoutMode = "NONE";
  imgContainer.resize(CAPTURE_WIDTH, CAPTURE_WIDTH * 1080 / 1920);
  imgContainer.fills = [{
    type: "IMAGE",
    imageHash: image.hash,
    scaleMode: "FIT",
  }];
  imgContainer.cornerRadius = 8;
  imgContainer.clipsContent = true;

  // ── Phase 21: 하이라이트 오버레이 ──
  var positions = result.elementPositions;
  if (positions && positions.length > 0) {
    var scale = CAPTURE_WIDTH / 1920;
    // 스크린샷 높이 재계산 (실제 캡처 높이 기반)
    var maxY = 0;
    for (var pi = 0; pi < positions.length; pi++) {
      var bottom = positions[pi].y + positions[pi].height;
      if (bottom > maxY) maxY = bottom;
    }
    // 캡처 높이 = min(bodyHeight, 4096), scale에 반영
    var captureHeight = Math.max(maxY + 100, 1080);
    var scaledHeight = captureHeight * scale;
    imgContainer.resize(CAPTURE_WIDTH, Math.max(scaledHeight, CAPTURE_WIDTH * 1080 / 1920));

    for (var oi = 0; oi < positions.length; oi++) {
      var pos = positions[oi];
      var group = ANNOTATION_SEMANTIC_MAP[pos.selector] || "other";
      var annoColor = ANNOTATION_COLORS[group] || ANNOTATION_COLORS["other"];

      // 반투명 오버레이 사각형
      var overlay = figma.createRectangle();
      overlay.name = "Highlight: " + pos.selector;
      overlay.x = Math.round(pos.x * scale);
      overlay.y = Math.round(pos.y * scale);
      overlay.resize(
        Math.max(Math.round(pos.width * scale), 4),
        Math.max(Math.round(pos.height * scale), 4)
      );
      overlay.fills = [{ type: "SOLID", color: annoColor, opacity: 0.15 }];
      overlay.strokes = [{ type: "SOLID", color: annoColor }];
      overlay.strokeWeight = 2;
      overlay.cornerRadius = 3;
      imgContainer.appendChild(overlay);

      // 라벨
      var markerFrame = figma.createFrame();
      markerFrame.name = "Label: " + pos.selector;
      markerFrame.layoutMode = "HORIZONTAL";
      markerFrame.primaryAxisSizingMode = "AUTO";
      markerFrame.counterAxisSizingMode = "AUTO";
      markerFrame.paddingLeft = 4;
      markerFrame.paddingRight = 4;
      markerFrame.paddingTop = 1;
      markerFrame.paddingBottom = 1;
      markerFrame.cornerRadius = 4;
      markerFrame.fills = [{ type: "SOLID", color: annoColor }];
      markerFrame.x = Math.round(pos.x * scale);
      markerFrame.y = Math.max(0, Math.round(pos.y * scale) - 14);

      var markerText = figma.createText();
      markerText.fontName = { family: "Inter", style: "Bold" };
      markerText.characters = pos.selector;
      markerText.fontSize = 8;
      markerText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      markerFrame.appendChild(markerText);

      imgContainer.appendChild(markerFrame);
    }
  }

  captureFrame.appendChild(imgContainer);

  // 범례
  var legendRow = createAutoFrame("Legend", "HORIZONTAL", 8, 0);
  legendRow.layoutWrap = "WRAP" as any;
  legendRow.counterAxisSpacing = 4;
  var legendKeys = ["heading", "body", "navigation", "interactive", "table"];
  var legendLabels: Record<string, string> = {
    heading: "Heading",
    body: "Body",
    navigation: "Navigation",
    interactive: "Interactive",
    table: "Table",
  };
  for (var li = 0; li < legendKeys.length; li++) {
    var lk = legendKeys[li];
    legendRow.appendChild(createBadge(legendLabels[lk], ANNOTATION_COLORS[lk], { r: 1, g: 1, b: 1 }));
  }
  captureFrame.appendChild(legendRow);

  return captureFrame;
}

// ── 메인 렌더 ──

export async function renderTables(results: ExtractResult[]) {
  var successResults = results.filter(function (r) { return r.success && r.data && r.data.length > 0; });
  if (successResults.length === 0) return;

  // Inter 기본 로드 (UI 라벨용)
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  // B단계: 추출된 폰트 사전 로드
  for (var pi = 0; pi < successResults.length; pi++) {
    if (successResults[pi].data) {
      await preloadFonts(successResults[pi].data!);
    }
  }

  var offsetX = 0;

  // 스타일 맵 1회 빌드
  var existingMaps = buildExistingStyleMaps();

  // 대시보드: 2개 이상 사이트일 때 좌측에 생성
  if (successResults.length >= 2) {
    var dashboard = renderDashboard(results);
    dashboard.x = 0;
    dashboard.y = 0;
    offsetX = dashboard.width + SITE_GAP;
  }

  for (var ri = 0; ri < successResults.length; ri++) {
    var result = successResults[ri];
    var styles = result.data!;
    var audit = result.audit;
    var consistencyMap = audit ? audit.consistencyMap : {};

    // C단계: Figma 스타일 등록
    var siteName = extractHostname(result.url);
    var registered = await registerFigmaStyles(styles, siteName, existingMaps);

    // ── Phase 20: Side-by-Side 컨테이너 ──
    var sessionFrame = createAutoFrame("Session: " + result.url, "HORIZONTAL", 24, PADDING);
    sessionFrame.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.97 } }];
    sessionFrame.cornerRadius = 16;
    sessionFrame.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.9 } }];
    sessionFrame.strokeWeight = 1;
    sessionFrame.x = offsetX;
    sessionFrame.y = 0;

    // 우측: Analysis Report
    var siteFrame = createAutoFrame("StyleGrabber: " + result.url, "VERTICAL", SECTION_GAP, PADDING);
    siteFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    siteFrame.cornerRadius = 12;
    siteFrame.strokes = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.92 } }];
    siteFrame.strokeWeight = 1;

    // 사이트 제목
    siteFrame.appendChild(createTextNode(result.url, 16, { r: 0.1, g: 0.1, b: 0.12 }, "Bold"));

    // 시스템 점수 + 스케일 시스템 배지 행
    var topBadges = createAutoFrame("Top Badges", "HORIZONTAL", 8, 0);
    topBadges.counterAxisAlignItems = "CENTER";

    // Phase 14: 시스템 점수 배지
    if (audit) {
      topBadges.appendChild(createBadge("System Score: " + audit.systemScore, getScoreColor(audit.systemScore), { r: 1, g: 1, b: 1 }));

      if (audit.typeScaleRatio) {
        topBadges.appendChild(createBadge("Type Scale: " + audit.typeScaleRatio + "x", { r: 0.45, g: 0.3, b: 0.75 }, { r: 1, g: 1, b: 1 }));
      }
    }

    // 스케일 시스템 표시 (Phase 10)
    if (result.scaleSystem) {
      topBadges.appendChild(createBadge("\u2713 " + result.scaleSystem + " grid", { r: 0.13, g: 0.52, b: 0.96 }, { r: 1, g: 1, b: 1 }));
    }

    siteFrame.appendChild(topBadges);

    // ── Phase 14: 디자인 감사 리포트 ──
    if (audit) {
      siteFrame.appendChild(renderAuditSection(audit, result.scaleSystem || null));
    }

    // ── Phase 13: 시스템 뷰 ──
    if (audit && audit.hierarchy) {
      siteFrame.appendChild(renderHierarchySection(audit.hierarchy));
    }

    // ── Phase 12: 클러스터 + 파편화 ──
    if (audit && audit.clusters && audit.clusters.length > 0) {
      siteFrame.appendChild(renderClusterSection(audit.clusters));
    }
    if (audit && audit.fragmentations && audit.fragmentations.length > 0) {
      siteFrame.appendChild(renderFragmentationSection(audit.fragmentations));
    }

    // ── Typography 섹션 (의미 그룹별 분리, Phase 9 + Phase 14 일관성 배지) ──
    var typoSection = createAutoFrame("Typography", "VERTICAL", CARD_GAP + 8, 0);
    typoSection.appendChild(createSectionHeader("Typography", styles.length + " unique styles"));

    var grouped = groupBySemanticGroup(styles);

    for (var gi = 0; gi < SEMANTIC_ORDER.length; gi++) {
      var groupKey = SEMANTIC_ORDER[gi];
      var groupStyles = grouped[groupKey];
      if (!groupStyles || groupStyles.length === 0) continue;

      // 서브 헤더
      typoSection.appendChild(createSubHeader(SEMANTIC_LABELS[groupKey] + " (" + groupStyles.length + ")"));

      // 카드 그리드
      var typoGrid = createAutoFrame("Grid " + groupKey, "HORIZONTAL", CARD_GAP, 0);
      typoGrid.layoutWrap = "WRAP" as any;
      typoGrid.counterAxisSpacing = CARD_GAP;
      typoGrid.layoutSizingHorizontal = "FIXED";
      typoGrid.resize(GRID_WIDTH, typoGrid.height);

      for (var si = 0; si < groupStyles.length; si++) {
        var styleItem = groupStyles[si];
        var cons = consistencyMap[styleItem.selector];
        var tKey = styleKey(styleItem);
        var pKey = styleItem.color.toLowerCase();
        var card = createTypographyCard(
          styleItem,
          cons,
          registered.textStyles[tKey],
          registered.paintStyles[pKey]
        );
        card.layoutSizingHorizontal = "FIXED";
        card.resize(CARD_WIDTH, card.height);
        typoGrid.appendChild(card);
      }

      typoSection.appendChild(typoGrid);
    }

    siteFrame.appendChild(typoSection);

    // ── Color Palette 섹션 ──
    var colors = extractColors(styles);
    if (colors.length > 0) {
      var colorSection = createAutoFrame("Color Palette", "VERTICAL", CARD_GAP, 0);
      colorSection.appendChild(createSectionHeader("Color Palette", colors.length + " unique colors"));

      var colorGrid = createAutoFrame("Color Grid", "HORIZONTAL", CARD_GAP, 0);
      colorGrid.layoutWrap = "WRAP" as any;
      colorGrid.counterAxisSpacing = CARD_GAP;
      colorGrid.layoutSizingHorizontal = "FIXED";
      colorGrid.resize(GRID_WIDTH, colorGrid.height);

      for (var ci = 0; ci < colors.length; ci++) {
        colorGrid.appendChild(createColorCard(colors[ci]));
      }

      colorSection.appendChild(colorGrid);
      siteFrame.appendChild(colorSection);
    }

    // ── Phase 11-2: 컴포넌트 규격 섹션 ──
    var specs = result.componentSpecs;
    if (specs && specs.length > 0) {
      siteFrame.appendChild(renderComponentSpecsSection(specs));
    }

    sessionFrame.appendChild(siteFrame);
    offsetX += sessionFrame.width + SITE_GAP;
  }

  // ── Phase 18: 멀티 페이지 통합 프레임 ──
  var crossPageFrameCount = 0;
  if (successResults.length >= 2) {
    var crossStyles = aggregateCrossPageStyles(results);
    if (crossStyles.length > 0) {
      var globalFrame = renderGlobalStandardFrame(crossStyles);
      globalFrame.x = offsetX;
      globalFrame.y = 0;
      offsetX += globalFrame.width + SITE_GAP;
      crossPageFrameCount++;
    }

    var crossSpecs = aggregateCrossPageSpecs(results);
    if (crossSpecs.length > 0) {
      var specsFrame = renderCrossPageSpecsFrame(crossSpecs);
      specsFrame.x = offsetX;
      specsFrame.y = 0;
      offsetX += specsFrame.width + SITE_GAP;
      crossPageFrameCount++;
    }
  }

  var totalNodes = successResults.length + (successResults.length >= 2 ? 1 : 0) + crossPageFrameCount;
  figma.viewport.scrollAndZoomIntoView(
    figma.currentPage.children.slice(-totalNodes)
  );
}

// ── Phase 18: 멀티 페이지 통합 (Cross-Page Aggregation) ──

interface CrossPageStyle {
  style: TypographyStyle;
  sourceUrls: string[];
  matchRate: number;
  isPrimary: boolean;
  totalCount: number;
}

interface CrossPageSpec {
  spec: ComponentSpec;
  sourceUrls: string[];
  totalCount: number;
}

function aggregateCrossPageStyles(results: ExtractResult[]): CrossPageStyle[] {
  var successResults = results.filter(function (r) { return r.success && r.data && r.data.length > 0; });
  if (successResults.length < 2) return [];

  var totalUrls = successResults.length;
  var styleMap: Record<string, { style: TypographyStyle; urls: string[]; totalCount: number }> = {};

  for (var ri = 0; ri < successResults.length; ri++) {
    var result = successResults[ri];
    var styles = result.data!;
    var urlShort = result.url.replace(/https?:\/\//, "").replace(/\/$/, "");

    for (var si = 0; si < styles.length; si++) {
      var s = styles[si];
      var key = s.selector + "|" + s.fontFamily + "|" + s.fontSize + "|" + s.fontWeight + "|" + Math.round(s.lineHeight) + "|" + Math.round(s.letterSpacing * 100) + "|" + s.color.toLowerCase();

      if (!styleMap[key]) {
        styleMap[key] = { style: s, urls: [], totalCount: 0 };
      }
      if (styleMap[key].urls.indexOf(urlShort) === -1) {
        styleMap[key].urls.push(urlShort);
      }
      styleMap[key].totalCount += s.count;
    }
  }

  var crossPageStyles: CrossPageStyle[] = [];
  for (var k in styleMap) {
    var entry = styleMap[k];
    if (entry.urls.length < 2) continue;
    var matchRate = entry.urls.length / totalUrls;
    crossPageStyles.push({
      style: entry.style,
      sourceUrls: entry.urls,
      matchRate: matchRate,
      isPrimary: matchRate >= 0.8,
      totalCount: entry.totalCount,
    });
  }

  crossPageStyles.sort(function (a, b) {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (a.matchRate !== b.matchRate) return b.matchRate - a.matchRate;
    return b.totalCount - a.totalCount;
  });

  return crossPageStyles;
}

function aggregateCrossPageSpecs(results: ExtractResult[]): CrossPageSpec[] {
  var successResults = results.filter(function (r) { return r.success && r.componentSpecs && r.componentSpecs.length > 0; });
  if (successResults.length < 2) return [];

  var specMap: Record<string, { spec: ComponentSpec; urls: string[]; totalCount: number }> = {};

  for (var ri = 0; ri < successResults.length; ri++) {
    var result = successResults[ri];
    var specs = result.componentSpecs!;
    var urlShort = result.url.replace(/https?:\/\//, "").replace(/\/$/, "");

    for (var si = 0; si < specs.length; si++) {
      var sp = specs[si];
      var key = sp.selector + "|" + Math.round(sp.height) + "|" + sp.paddingTop + "|" + sp.paddingRight + "|" + sp.paddingBottom + "|" + sp.paddingLeft + "|" + Math.round(sp.borderRadius) + "|" + sp.fontSize + "|" + sp.fontWeight;

      if (!specMap[key]) {
        specMap[key] = { spec: sp, urls: [], totalCount: 0 };
      }
      if (specMap[key].urls.indexOf(urlShort) === -1) {
        specMap[key].urls.push(urlShort);
      }
      specMap[key].totalCount += sp.count;
    }
  }

  var crossPageSpecs: CrossPageSpec[] = [];
  for (var k in specMap) {
    var entry = specMap[k];
    if (entry.urls.length < 2) continue;
    crossPageSpecs.push({
      spec: entry.spec,
      sourceUrls: entry.urls,
      totalCount: entry.totalCount,
    });
  }

  crossPageSpecs.sort(function (a, b) { return b.totalCount - a.totalCount; });
  return crossPageSpecs;
}

function createCrossPageStyleCard(item: CrossPageStyle): FrameNode {
  var card = createAutoFrame("Cross Card", "VERTICAL", 8, 16);
  card.fills = [{ type: "SOLID", color: item.isPrimary ? { r: 0.94, g: 0.97, b: 1 } : { r: 0.98, g: 0.98, b: 0.98 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: item.isPrimary ? { r: 0.78, g: 0.86, b: 0.98 } : { r: 0.92, g: 0.92, b: 0.92 } }];
  card.strokeWeight = 1;

  // 상단: 셀렉터 + 배지들
  var topRow = createAutoFrame("Top", "HORIZONTAL", 6, 0);
  topRow.counterAxisAlignItems = "CENTER";
  topRow.layoutWrap = "WRAP" as any;
  topRow.counterAxisSpacing = 4;

  topRow.appendChild(createTextNode("<" + item.style.selector + ">", 10, { r: 0.2, g: 0.3, b: 0.6 }, "Bold"));

  // Primary System Token 배지
  if (item.isPrimary) {
    topRow.appendChild(createBadge("PRIMARY TOKEN", { r: 0.13, g: 0.45, b: 0.85 }, { r: 1, g: 1, b: 1 }));
  }

  // 매칭률 배지
  var pctText = Math.round(item.matchRate * 100) + "% match";
  topRow.appendChild(createBadge(pctText, getScoreColor(Math.round(item.matchRate * 100)), { r: 1, g: 1, b: 1 }));

  // 총 사용 횟수
  var countColor = item.totalCount >= 10 ? { r: 0.94, g: 0.35, b: 0.13 } : item.totalCount >= 3 ? { r: 0.09, g: 0.63, b: 0.49 } : { r: 0.6, g: 0.6, b: 0.65 };
  topRow.appendChild(createBadge(item.totalCount + "x total", countColor, { r: 1, g: 1, b: 1 }));

  card.appendChild(topRow);

  // 샘플 텍스트
  var sample = figma.createText();
  sample.fontName = { family: "Inter", style: "Regular" };
  sample.characters = SAMPLE_TEXT;
  var sampleSize = Math.min(Math.max(item.style.fontSize, 12), 48);
  sample.fontSize = sampleSize;
  sample.lineHeight = { value: sampleSize * 1.4, unit: "PIXELS" };
  if (item.style.color.startsWith("#") && item.style.color.length === 7) {
    sample.fills = [{ type: "SOLID", color: hexToRgb(item.style.color) }];
  }
  card.appendChild(sample);

  card.appendChild(createDivider());

  // 속성 그리드
  card.appendChild(createPropsGrid("Info", [
    { label: "Font", value: shortFontName(item.style.fontFamily) },
    { label: "Size", value: item.style.fontSize + "px" },
    { label: "Weight", value: String(item.style.fontWeight) },
    { label: "LH", value: Math.round(item.style.lineHeight * 10) / 10 + "px" },
    { label: "LS", value: Math.round(item.style.letterSpacing * 100) / 100 + "px" },
  ]));

  // 컬러 스와치 행
  var bottomRow = createAutoFrame("Bottom", "HORIZONTAL", 8, 0);
  bottomRow.counterAxisAlignItems = "CENTER";

  if (item.style.color.startsWith("#") && item.style.color.length === 7) {
    var swatch = figma.createEllipse();
    swatch.resize(SWATCH_SIZE, SWATCH_SIZE);
    swatch.fills = [{ type: "SOLID", color: hexToRgb(item.style.color) }];
    swatch.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    swatch.strokeWeight = 1;
    bottomRow.appendChild(swatch);
  }
  bottomRow.appendChild(createTextNode(item.style.color, 11, { r: 0.35, g: 0.35, b: 0.35 }));
  card.appendChild(bottomRow);

  card.appendChild(createDivider({ r: 0.88, g: 0.9, b: 0.94 }));

  // 소스 URL 태그 행
  var urlRow = createAutoFrame("URLs", "HORIZONTAL", 4, 0);
  urlRow.layoutWrap = "WRAP" as any;
  urlRow.counterAxisSpacing = 4;

  for (var ui = 0; ui < item.sourceUrls.length; ui++) {
    urlRow.appendChild(createBadge(item.sourceUrls[ui], { r: 0.4, g: 0.4, b: 0.5 }, { r: 1, g: 1, b: 1 }));
  }
  card.appendChild(urlRow);

  return card;
}

function createCrossPageSpecCard(item: CrossPageSpec): FrameNode {
  var card = createAutoFrame("Cross Spec Card", "VERTICAL", 8, 16);
  card.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.98, b: 1 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.9, b: 0.96 } }];
  card.strokeWeight = 1;

  // 상단
  var topRow = createAutoFrame("Top", "HORIZONTAL", 6, 0);
  topRow.counterAxisAlignItems = "CENTER";
  topRow.appendChild(createTextNode("<" + item.spec.selector + ">", 11, { r: 0.2, g: 0.35, b: 0.6 }, "Bold"));
  topRow.appendChild(createBadge(item.totalCount + "x", { r: 0.2, g: 0.45, b: 0.8 }, { r: 1, g: 1, b: 1 }));
  topRow.appendChild(createBadge(item.sourceUrls.length + " pages", { r: 0.45, g: 0.3, b: 0.7 }, { r: 1, g: 1, b: 1 }));
  card.appendChild(topRow);

  // 미리보기
  var previewHeight = Math.min(Math.max(item.spec.height, 24), 56);
  var previewBR = Math.min(item.spec.borderRadius, previewHeight / 2);
  var preview = figma.createRectangle();
  preview.resize(CARD_WIDTH - 64, previewHeight);
  preview.cornerRadius = previewBR;
  if (item.spec.backgroundColor.startsWith("#") && item.spec.backgroundColor.length === 7) {
    preview.fills = [{ type: "SOLID", color: hexToRgb(item.spec.backgroundColor) }];
  } else {
    preview.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.93, b: 0.96 } }];
  }
  if (item.spec.borderWidth > 0 && item.spec.borderColor.startsWith("#") && item.spec.borderColor.length === 7) {
    preview.strokes = [{ type: "SOLID", color: hexToRgb(item.spec.borderColor) }];
    preview.strokeWeight = Math.min(item.spec.borderWidth, 3);
  }
  card.appendChild(preview);

  card.appendChild(createDivider());

  // 속성
  card.appendChild(createPropsGrid("Spec Info", [
    { label: "Height", value: Math.round(item.spec.height) + "px" },
    { label: "Padding", value: item.spec.paddingTop + " " + item.spec.paddingRight + " " + item.spec.paddingBottom + " " + item.spec.paddingLeft },
    { label: "Radius", value: Math.round(item.spec.borderRadius) + "px" },
    { label: "Font", value: item.spec.fontSize + "px / " + item.spec.fontWeight },
    { label: "Border", value: item.spec.borderWidth > 0 ? item.spec.borderWidth + "px" : "none" },
  ], 10));

  // 소스 URL 태그
  var urlRow = createAutoFrame("URLs", "HORIZONTAL", 4, 0);
  urlRow.layoutWrap = "WRAP" as any;
  urlRow.counterAxisSpacing = 4;
  for (var ui = 0; ui < item.sourceUrls.length; ui++) {
    urlRow.appendChild(createBadge(item.sourceUrls[ui], { r: 0.4, g: 0.4, b: 0.5 }, { r: 1, g: 1, b: 1 }));
  }
  card.appendChild(urlRow);

  return card;
}

function renderGlobalStandardFrame(crossStyles: CrossPageStyle[]): FrameNode {
  var frame = createAutoFrame("Global Standard", "VERTICAL", SECTION_GAP, PADDING);
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  frame.cornerRadius = 12;
  frame.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.85, b: 0.95 } }];
  frame.strokeWeight = 1;

  // 제목
  frame.appendChild(createTextNode("Global Standard", 18, { r: 0.1, g: 0.1, b: 0.12 }, "Bold"));

  var primaryCount = 0;
  for (var i = 0; i < crossStyles.length; i++) {
    if (crossStyles[i].isPrimary) primaryCount++;
  }

  // 상단 배지 행
  var topBadges = createAutoFrame("Top Badges", "HORIZONTAL", 8, 0);
  topBadges.counterAxisAlignItems = "CENTER";
  topBadges.appendChild(createBadge("CROSS-PAGE ANALYSIS", { r: 0.13, g: 0.45, b: 0.85 }, { r: 1, g: 1, b: 1 }));
  topBadges.appendChild(createBadge(crossStyles.length + " shared styles", { r: 0.35, g: 0.35, b: 0.5 }, { r: 1, g: 1, b: 1 }));
  if (primaryCount > 0) {
    topBadges.appendChild(createBadge(primaryCount + " primary tokens", { r: 0.09, g: 0.55, b: 0.35 }, { r: 1, g: 1, b: 1 }));
  }
  frame.appendChild(topBadges);

  frame.appendChild(createSectionHeader("Cross-Page Typography", "Styles found across multiple pages"));

  // 의미 그룹별 분류
  var grouped: Record<string, CrossPageStyle[]> = {};
  for (var si = 0; si < crossStyles.length; si++) {
    var group = crossStyles[si].style.semanticGroup || "other";
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(crossStyles[si]);
  }

  for (var gi = 0; gi < SEMANTIC_ORDER.length; gi++) {
    var groupKey = SEMANTIC_ORDER[gi];
    var groupItems = grouped[groupKey];
    if (!groupItems || groupItems.length === 0) continue;

    frame.appendChild(createSubHeader(SEMANTIC_LABELS[groupKey] + " (" + groupItems.length + ")"));

    var grid = createAutoFrame("Grid " + groupKey, "HORIZONTAL", CARD_GAP, 0);
    grid.layoutWrap = "WRAP" as any;
    grid.counterAxisSpacing = CARD_GAP;
    grid.layoutSizingHorizontal = "FIXED";
    grid.resize(GRID_WIDTH, grid.height);

    for (var ci = 0; ci < groupItems.length; ci++) {
      var card = createCrossPageStyleCard(groupItems[ci]);
      card.layoutSizingHorizontal = "FIXED";
      card.resize(CARD_WIDTH, card.height);
      grid.appendChild(card);
    }

    frame.appendChild(grid);
  }

  // 교차 페이지 공통 컬러 팔레트
  var allStyles: TypographyStyle[] = [];
  for (var csi = 0; csi < crossStyles.length; csi++) {
    allStyles.push(crossStyles[csi].style);
  }
  var colors = extractColors(allStyles);
  if (colors.length > 0) {
    var colorSection = createAutoFrame("Color Palette", "VERTICAL", CARD_GAP, 0);
    colorSection.appendChild(createSectionHeader("Cross-Page Color Palette", colors.length + " shared colors"));

    var colorGrid = createAutoFrame("Color Grid", "HORIZONTAL", CARD_GAP, 0);
    colorGrid.layoutWrap = "WRAP" as any;
    colorGrid.counterAxisSpacing = CARD_GAP;
    colorGrid.layoutSizingHorizontal = "FIXED";
    colorGrid.resize(GRID_WIDTH, colorGrid.height);

    for (var cli = 0; cli < colors.length; cli++) {
      colorGrid.appendChild(createColorCard(colors[cli]));
    }

    colorSection.appendChild(colorGrid);
    frame.appendChild(colorSection);
  }

  return frame;
}

function renderCrossPageSpecsFrame(crossSpecs: CrossPageSpec[]): FrameNode {
  var frame = createAutoFrame("Component Specs (Cross-Page)", "VERTICAL", SECTION_GAP, PADDING);
  frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  frame.cornerRadius = 12;
  frame.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.85, b: 0.95 } }];
  frame.strokeWeight = 1;

  frame.appendChild(createTextNode("Component Specs", 18, { r: 0.1, g: 0.1, b: 0.12 }, "Bold"));

  var topBadges = createAutoFrame("Top Badges", "HORIZONTAL", 8, 0);
  topBadges.counterAxisAlignItems = "CENTER";
  topBadges.appendChild(createBadge("CROSS-PAGE", { r: 0.45, g: 0.3, b: 0.7 }, { r: 1, g: 1, b: 1 }));
  topBadges.appendChild(createBadge(crossSpecs.length + " common specs", { r: 0.35, g: 0.35, b: 0.5 }, { r: 1, g: 1, b: 1 }));
  frame.appendChild(topBadges);

  frame.appendChild(createSectionHeader("Cross-Page Interactive Components", "Component specs found across multiple pages"));

  var grid = createAutoFrame("Spec Grid", "HORIZONTAL", CARD_GAP, 0);
  grid.layoutWrap = "WRAP" as any;
  grid.counterAxisSpacing = CARD_GAP;
  grid.layoutSizingHorizontal = "FIXED";
  grid.resize(GRID_WIDTH, grid.height);

  for (var i = 0; i < crossSpecs.length; i++) {
    var card = createCrossPageSpecCard(crossSpecs[i]);
    card.layoutSizingHorizontal = "FIXED";
    card.resize(CARD_WIDTH, card.height);
    grid.appendChild(card);
  }

  frame.appendChild(grid);
  return frame;
}

// ── Phase 15-16: Cleaned Style 카드 ──

var INSIGHT_TAG_COLORS: Record<string, RGB> = {
  "System Base": { r: 0.25, g: 0.35, b: 0.75 },
  "Most Consistent": { r: 0.09, g: 0.55, b: 0.35 },
  "Consistent": { r: 0.2, g: 0.6, b: 0.45 },
  "High Usage": { r: 0.85, g: 0.45, b: 0.1 },
};

function createCleanedStyleCard(
  style: CleanedStyle,
  registeredTextStyle?: TextStyle,
  registeredPaintStyle?: PaintStyle
): FrameNode {
  var card = createAutoFrame("Cleaned Card", "VERTICAL", 8, 16);
  card.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.98, b: 1 } }];
  card.cornerRadius = 8;
  card.strokes = [{ type: "SOLID", color: { r: 0.88, g: 0.9, b: 0.96 } }];
  card.strokeWeight = 1;

  // 상단: 셀렉터 + 빈도 + 인사이트 태그
  var topRow = createAutoFrame("Top", "HORIZONTAL", 6, 0);
  topRow.counterAxisAlignItems = "CENTER";
  topRow.layoutWrap = "WRAP" as any;
  topRow.counterAxisSpacing = 4;

  var selectorTag = figma.createText();
  selectorTag.fontName = { family: "Inter", style: "Bold" };
  selectorTag.characters = "<" + style.selector + ">";
  selectorTag.fontSize = 10;
  selectorTag.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.3, b: 0.6 } }];
  topRow.appendChild(selectorTag);

  // 빈도 배지
  var count = style.count || 1;
  var countColor = count >= 10 ? { r: 0.94, g: 0.35, b: 0.13 } : count >= 3 ? { r: 0.09, g: 0.63, b: 0.49 } : { r: 0.6, g: 0.6, b: 0.65 };
  topRow.appendChild(createBadge(count + "x", countColor, { r: 1, g: 1, b: 1 }));

  // Phase 15-2: 병합 배지
  if (style.mergedFrom && style.mergedFrom > 1) {
    topRow.appendChild(createBadge("Merged " + style.mergedFrom + " tokens", { r: 0.5, g: 0.4, b: 0.7 }, { r: 1, g: 1, b: 1 }));
  }

  // Phase 16-2: 인사이트 태그
  for (var ti = 0; ti < style.insightTags.length; ti++) {
    var tag = style.insightTags[ti];
    var tagColor = INSIGHT_TAG_COLORS[tag] || { r: 0.5, g: 0.5, b: 0.5 };
    topRow.appendChild(createBadge(tag, tagColor, { r: 1, g: 1, b: 1 }));
  }

  card.appendChild(topRow);

  var result = createSampleText(style, registeredTextStyle, registeredPaintStyle);
  card.appendChild(result.sample);
  card.appendChild(createDivider({ r: 0.88, g: 0.9, b: 0.94 }));
  card.appendChild(createStylePropsGrid(style, result.isOriginalFont));
  card.appendChild(createColorSwatchRow(style, registeredPaintStyle));

  return card;
}

// ── Phase 15-17: Cleaned 렌더러 ──

export async function renderCleanedTables(results: ExtractResult[]) {
  var successResults = results.filter(function (r) { return r.success && r.cleanedData && r.cleanedData.styles.length > 0; });
  if (successResults.length === 0) return;

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  // B단계: 추출된 폰트 사전 로드
  for (var pi = 0; pi < successResults.length; pi++) {
    if (successResults[pi].cleanedData) {
      await preloadFonts(successResults[pi].cleanedData!.styles);
    }
  }

  var offsetX = 0;
  var existingMaps = buildExistingStyleMaps();

  for (var ri = 0; ri < successResults.length; ri++) {
    var result = successResults[ri];
    var cleaned = result.cleanedData!;
    var cleanedStyles = cleaned.styles;

    // C단계: Figma 스타일 등록
    var siteName = extractHostname(result.url);
    var registered = await registerFigmaStyles(cleanedStyles, siteName, existingMaps);

    var siteFrame = createAutoFrame("StyleGrabber (Cleaned): " + result.url, "VERTICAL", SECTION_GAP, PADDING);
    siteFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    siteFrame.cornerRadius = 12;
    siteFrame.strokes = [{ type: "SOLID", color: { r: 0.85, g: 0.88, b: 0.95 } }];
    siteFrame.strokeWeight = 1;
    siteFrame.x = offsetX;
    siteFrame.y = 0;

    // 사이트 제목
    var titleNode = figma.createText();
    titleNode.fontName = { family: "Inter", style: "Bold" };
    titleNode.characters = result.url;
    titleNode.fontSize = 16;
    titleNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.12 } }];
    siteFrame.appendChild(titleNode);

    // Cleaned 모드 표시 + 통계
    var topBadges = createAutoFrame("Top Badges", "HORIZONTAL", 8, 0);
    topBadges.counterAxisAlignItems = "CENTER";

    topBadges.appendChild(createBadge("CLEANED VIEW", { r: 0.45, g: 0.3, b: 0.75 }, { r: 1, g: 1, b: 1 }));
    topBadges.appendChild(createBadge(cleanedStyles.length + " system tokens", { r: 0.25, g: 0.35, b: 0.75 }, { r: 1, g: 1, b: 1 }));

    if (cleaned.removedCount > 0) {
      topBadges.appendChild(createBadge(cleaned.removedCount + " non-standard removed", { r: 0.6, g: 0.55, b: 0.65 }, { r: 1, g: 1, b: 1 }));
    }
    if (cleaned.mergedCount > 0) {
      topBadges.appendChild(createBadge(cleaned.mergedCount + " similar merged", { r: 0.5, g: 0.4, b: 0.7 }, { r: 1, g: 1, b: 1 }));
    }

    // 시스템 점수
    if (result.audit) {
      topBadges.appendChild(createBadge("Score: " + result.audit.systemScore, getScoreColor(result.audit.systemScore), { r: 1, g: 1, b: 1 }));
    }

    if (result.scaleSystem) {
      topBadges.appendChild(createBadge("\u2713 " + result.scaleSystem + " grid", { r: 0.13, g: 0.52, b: 0.96 }, { r: 1, g: 1, b: 1 }));
    }

    siteFrame.appendChild(topBadges);

    // ── Phase 16-1: Semantic Mapping — 정제된 위계 테이블 ──
    var semanticSection = createAutoFrame("Cleaned Typography", "VERTICAL", CARD_GAP + 8, 0);
    semanticSection.appendChild(createSectionHeader("Design System Tokens", cleanedStyles.length + " cleaned styles (sorted by usage)"));

    // 의미 그룹별 분류
    var cleanedGroups: Record<string, CleanedStyle[]> = {};
    for (var ci = 0; ci < cleanedStyles.length; ci++) {
      var group = cleanedStyles[ci].semanticGroup || "other";
      if (!cleanedGroups[group]) cleanedGroups[group] = [];
      cleanedGroups[group].push(cleanedStyles[ci]);
    }

    for (var gi = 0; gi < SEMANTIC_ORDER.length; gi++) {
      var groupKey = SEMANTIC_ORDER[gi];
      var groupStyles = cleanedGroups[groupKey];
      if (!groupStyles || groupStyles.length === 0) continue;

      semanticSection.appendChild(createSubHeader(SEMANTIC_LABELS[groupKey] + " (" + groupStyles.length + ")"));

      var typoGrid = createAutoFrame("Grid " + groupKey, "HORIZONTAL", CARD_GAP, 0);
      typoGrid.layoutWrap = "WRAP" as any;
      typoGrid.counterAxisSpacing = CARD_GAP;
      typoGrid.layoutSizingHorizontal = "FIXED";
      typoGrid.resize(GRID_WIDTH, typoGrid.height);

      for (var si = 0; si < groupStyles.length; si++) {
        var tKey = styleKey(groupStyles[si]);
        var pKey = groupStyles[si].color.toLowerCase();
        var card = createCleanedStyleCard(
          groupStyles[si],
          registered.textStyles[tKey],
          registered.paintStyles[pKey]
        );
        card.layoutSizingHorizontal = "FIXED";
        card.resize(CARD_WIDTH, card.height);
        typoGrid.appendChild(card);
      }

      semanticSection.appendChild(typoGrid);
    }

    siteFrame.appendChild(semanticSection);

    // ── Color Palette (정제 데이터 기반) ──
    var colors = extractColors(cleanedStyles);
    if (colors.length > 0) {
      var colorSection = createAutoFrame("Color Palette", "VERTICAL", CARD_GAP, 0);
      colorSection.appendChild(createSectionHeader("Color Palette", colors.length + " unique colors"));

      var colorGrid = createAutoFrame("Color Grid", "HORIZONTAL", CARD_GAP, 0);
      colorGrid.layoutWrap = "WRAP" as any;
      colorGrid.counterAxisSpacing = CARD_GAP;
      colorGrid.layoutSizingHorizontal = "FIXED";
      colorGrid.resize(GRID_WIDTH, colorGrid.height);

      for (var cli = 0; cli < colors.length; cli++) {
        colorGrid.appendChild(createColorCard(colors[cli]));
      }

      colorSection.appendChild(colorGrid);
      siteFrame.appendChild(colorSection);
    }

    offsetX += siteFrame.width + SITE_GAP;
  }

  figma.viewport.scrollAndZoomIntoView(
    figma.currentPage.children.slice(-successResults.length)
  );
}

// ── 스크린샷 후속 삽입 ──

export function renderCaptureForSession(url: string, chunks: Uint8Array[], result: ExtractResult | null): void {
  var sessionFrame: FrameNode | null = null;
  var children = figma.currentPage.children;
  for (var i = children.length - 1; i >= 0; i--) {
    var child = children[i];
    if (child.type === "FRAME" && child.name === "Session: " + url) {
      sessionFrame = child as FrameNode;
      break;
    }
  }

  if (!sessionFrame) {
    sessionFrame = createAutoFrame("Session: " + url, "HORIZONTAL", 24, 0);
    sessionFrame.x = 0;
    sessionFrame.y = 0;
  }

  var captureFrame = renderCaptureFrameFromChunks(url, chunks, result);
  if (captureFrame) {
    if (sessionFrame.children.length > 0) {
      sessionFrame.insertChild(0, captureFrame);
    } else {
      sessionFrame.appendChild(captureFrame);
    }
  }
}

function renderCaptureFrameFromChunks(url: string, chunks: Uint8Array[], result: ExtractResult | null): FrameNode | null {
  if (chunks.length === 0) return null;

  var CHUNK_HEIGHT = 1200;
  var scale = CAPTURE_WIDTH / 1920;

  var captureFrame = createAutoFrame("Visual Capture: " + url, "VERTICAL", 8, 0);
  captureFrame.fills = [];

  // 상단: URL + VISUAL CAPTURE 배지
  var headerRow = createAutoFrame("Capture Header", "HORIZONTAL", 8, 0);
  headerRow.counterAxisAlignItems = "CENTER";
  headerRow.appendChild(createBadge("VISUAL CAPTURE", { r: 0.13, g: 0.45, b: 0.85 }, { r: 1, g: 1, b: 1 }));
  headerRow.appendChild(createTextNode(url, 11, { r: 0.35, g: 0.35, b: 0.4 }));
  captureFrame.appendChild(headerRow);

  // 스타일 매핑 (selector → 속성 문자열)
  var styleMap: Record<string, string> = {};
  if (result && result.data) {
    for (var si = 0; si < result.data.length; si++) {
      var s = result.data[si];
      if (!styleMap[s.selector]) {
        styleMap[s.selector] = shortFontName(s.fontFamily) + " " + s.fontSize + "px " +
          (s.fontWeight >= 700 ? "Bold" : s.fontWeight >= 500 ? "Medium" : "Regular") +
          " / " + Math.round(s.lineHeight) + "px " + s.color;
      }
    }
  }

  // elementPositions
  var positions = (result && result.elementPositions) ? result.elementPositions : [];

  // 청크 이미지들을 세로로 쌓기
  var imgStack = figma.createFrame();
  imgStack.name = "Screenshot Stack";
  imgStack.layoutMode = "NONE";
  var totalHeight = Math.round(chunks.length * CHUNK_HEIGHT * scale);
  imgStack.resize(CAPTURE_WIDTH, totalHeight);
  imgStack.fills = [];
  imgStack.clipsContent = true;

  for (var ci = 0; ci < chunks.length; ci++) {
    var image = figma.createImage(chunks[ci]);
    var imgHeight = Math.round(CHUNK_HEIGHT * scale);
    var imgY = Math.round(ci * CHUNK_HEIGHT * scale);

    var imgFrame = figma.createFrame();
    imgFrame.name = "Chunk " + (ci + 1);
    imgFrame.layoutMode = "NONE";
    imgFrame.resize(CAPTURE_WIDTH, imgHeight);
    imgFrame.x = 0;
    imgFrame.y = imgY;
    imgFrame.fills = [{
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: "FILL",
    }];
    imgStack.appendChild(imgFrame);
  }

  // 요소 위치별 속성 오버레이
  for (var oi = 0; oi < positions.length; oi++) {
    var pos = positions[oi];
    var group = ANNOTATION_SEMANTIC_MAP[pos.selector] || "other";
    var annoColor = ANNOTATION_COLORS[group] || ANNOTATION_COLORS["other"];
    var propText = styleMap[pos.selector] || pos.selector;

    var ox = Math.round(pos.x * scale);
    var oy = Math.round(pos.y * scale);
    var ow = Math.max(Math.round(pos.width * scale), 8);
    var oh = Math.max(Math.round(pos.height * scale), 8);

    // 투명 오버레이 프레임 (클릭 가능)
    var overlay = figma.createFrame();
    overlay.name = pos.selector + " | " + propText;
    overlay.x = ox;
    overlay.y = oy;
    overlay.resize(ow, oh);
    overlay.fills = [{ type: "SOLID", color: annoColor, opacity: 0.08 }];
    overlay.strokes = [{ type: "SOLID", color: annoColor }];
    overlay.strokeWeight = 1;
    overlay.layoutMode = "NONE";
    imgStack.appendChild(overlay);

    // 라벨 태그
    var label = figma.createFrame();
    label.name = "Label: " + pos.selector;
    label.layoutMode = "HORIZONTAL";
    label.primaryAxisSizingMode = "AUTO";
    label.counterAxisSizingMode = "AUTO";
    label.paddingLeft = 4;
    label.paddingRight = 4;
    label.paddingTop = 2;
    label.paddingBottom = 2;
    label.cornerRadius = 3;
    label.fills = [{ type: "SOLID", color: annoColor }];
    label.x = ox;
    label.y = Math.max(0, oy - 16);

    var labelText = figma.createText();
    labelText.fontName = { family: "Inter", style: "Bold" };
    labelText.characters = pos.selector;
    labelText.fontSize = 8;
    labelText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    label.appendChild(labelText);
    imgStack.appendChild(label);
  }

  captureFrame.appendChild(imgStack);
  return captureFrame;
}

// ── Layout Reconstruction 렌더러 ──

export async function renderLayout(results: ExtractResult[]) {
  var layoutResults = results.filter(function (r) {
    return r.success && r.layoutElements && r.layoutElements.length > 0;
  });
  if (layoutResults.length === 0) return;

  // Inter 기본 로드
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  // 텍스트 요소의 폰트 사전 로드
  for (var ri = 0; ri < layoutResults.length; ri++) {
    var elems = layoutResults[ri].layoutElements!;
    var fontSeen: Record<string, boolean> = {};
    for (var i = 0; i < elems.length; i++) {
      var elem = elems[i];
      if (elem.textContent && elem.fontFamily && elem.fontWeight !== null) {
        var fKey = shortFontName(elem.fontFamily) + "::" + elem.fontWeight;
        if (!fontSeen[fKey]) {
          fontSeen[fKey] = true;
          await tryLoadFont(elem.fontFamily, elem.fontWeight);
        }
      }
    }
  }

  var offsetX = 0;

  for (var ri = 0; ri < layoutResults.length; ri++) {
    var result = layoutResults[ri];
    var elements = result.layoutElements!;

    // 루트 프레임 생성 (절대 위치 모드)
    var rootFrame = figma.createFrame();
    rootFrame.name = "Layout: " + result.url;
    rootFrame.layoutMode = "NONE" as any;
    rootFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];

    // 전체 페이지 크기 계산 (폭은 뷰포트 1920px 고정)
    var maxY = 1080;
    for (var i = 0; i < elements.length; i++) {
      var bottom = elements[i].y + elements[i].height;
      if (bottom > maxY) maxY = bottom;
    }
    rootFrame.resize(1920, maxY);
    rootFrame.clipsContent = true;
    rootFrame.x = offsetX;
    rootFrame.y = 0;

    // id → 요소/노드 매핑 (O(1) lookup)
    var nodeMap: Record<number, FrameNode> = {};
    var elementMap: Record<number, LayoutElement> = {};
    for (var i = 0; i < elements.length; i++) {
      elementMap[elements[i].id] = elements[i];
    }

    // 요소 렌더링 (부모 → 자식 순서 보장됨: BFS로 추출)
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];

      if (el.textContent && el.textContent.length > 0) {
        // 텍스트 요소: 프레임 + 텍스트 노드
        var textFrame = figma.createFrame();
        textFrame.name = el.tag + " (text)";
        textFrame.layoutMode = "NONE" as any;
        textFrame.resize(Math.max(el.width, 1), Math.max(el.height, 1));
        textFrame.clipsContent = false;
        applyBoxStyle(textFrame, el);

        // 텍스트 노드 생성
        var textNode = figma.createText();
        var fontFamily = el.fontFamily ? shortFontName(el.fontFamily) : "Inter";
        var fontWeight = el.fontWeight || 400;
        var cKey = fontFamily + "::" + weightToStyle(fontWeight);

        if (loadedFontCache[cKey]) {
          textNode.fontName = { family: fontFamily, style: weightToStyle(fontWeight) };
        } else {
          textNode.fontName = { family: "Inter", style: fontWeight >= 600 ? "Bold" : "Regular" };
        }

        textNode.characters = el.textContent;
        textNode.fontSize = el.fontSize || 16;
        if (el.lineHeight && el.lineHeight > 0) {
          textNode.lineHeight = { value: el.lineHeight, unit: "PIXELS" };
        }
        if (el.letterSpacing && el.letterSpacing !== 0) {
          textNode.letterSpacing = { value: el.letterSpacing, unit: "PIXELS" };
        }
        if (el.color) {
          textNode.fills = [{ type: "SOLID", color: hexToRgb(el.color) }];
        }

        textNode.x = el.paddingLeft;
        textNode.y = el.paddingTop;
        var textWidth = el.width - el.paddingLeft - el.paddingRight;
        if (textWidth > 0) {
          textNode.resize(textWidth, textNode.height);
          textNode.textAutoResize = "HEIGHT";
        }

        textFrame.appendChild(textNode);
        placeInParent(textFrame, el, elementMap, nodeMap, rootFrame);

      } else if (el.backgroundColor || (el.borderWidth > 0 && el.borderColor) || el.hasBackgroundImage || el.imageData || el.boxShadow || el.gradient) {
        // 시각적 요소만 렌더링 (배경색, 테두리, 배경이미지, 캡처 이미지, 그림자, 그라데이션이 있는 경우)
        var frame = figma.createFrame();
        frame.name = el.tag;
        frame.layoutMode = "NONE" as any;
        frame.resize(Math.max(el.width, 1), Math.max(el.height, 1));
        applyBoxStyle(frame, el);

        // background-image 캡처 데이터가 있으면 IMAGE fill 적용
        if (el.imageData) {
          try {
            var bgImgBytes = figma.base64Decode(el.imageData);
            var bgFigmaImage = figma.createImage(bgImgBytes);
            frame.fills = [{
              type: "IMAGE",
              imageHash: bgFigmaImage.hash,
              scaleMode: "FILL",
            } as ImagePaint];
          } catch (_) { /* 디코딩 실패 시 기존 스타일 유지 */ }
        }

        placeInParent(frame, el, elementMap, nodeMap, rootFrame);

      } else if (el.tag === "img") {
        var imgFrame = figma.createFrame();
        imgFrame.name = "img";
        imgFrame.layoutMode = "NONE" as any;
        imgFrame.resize(Math.max(el.width, 1), Math.max(el.height, 1));
        imgFrame.clipsContent = true;
        if (el.borderRadius > 0) imgFrame.cornerRadius = el.borderRadius;

        if (el.imageData) {
          // 실제 이미지 삽입
          try {
            var imgBytes = figma.base64Decode(el.imageData);
            var figmaImage = figma.createImage(imgBytes);
            imgFrame.fills = [{
              type: "IMAGE",
              imageHash: figmaImage.hash,
              scaleMode: "FILL",
            } as ImagePaint];
          } catch (_) {
            // 디코딩 실패 시 플레이스홀더
            imgFrame.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
          }
        } else {
          // 이미지 데이터 없으면 플레이스홀더
          imgFrame.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
          var imgLabel = figma.createText();
          imgLabel.fontName = { family: "Inter", style: "Regular" };
          imgLabel.characters = "Image";
          imgLabel.fontSize = 11;
          imgLabel.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.65 } }];
          imgLabel.x = Math.max((el.width - 40) / 2, 0);
          imgLabel.y = Math.max((el.height - 14) / 2, 0);
          imgFrame.appendChild(imgLabel);
        }

        placeInParent(imgFrame, el, elementMap, nodeMap, rootFrame);
      }
    }

    // z-index 기반 레이어 순서 정렬 (플랫 구조: 모두 rootFrame 자식)
    // z-index가 높은 요소가 Figma에서 위로 올라감 (나중에 삽입 = 위에 표시)
    var sortedElements: { id: number; zIndex: number; domOrder: number }[] = [];
    for (var i = 0; i < elements.length; i++) {
      if (nodeMap[elements[i].id]) {
        sortedElements.push({ id: elements[i].id, zIndex: elements[i].zIndex, domOrder: i });
      }
    }
    sortedElements.sort(function (a, b) {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return a.domOrder - b.domOrder;
    });
    for (var si = 0; si < sortedElements.length; si++) {
      var sNode = nodeMap[sortedElements[si].id];
      if (sNode && sNode.parent === rootFrame) {
        rootFrame.insertChild(si, sNode);
      }
    }

    offsetX += rootFrame.width + SITE_GAP;
  }

  figma.viewport.scrollAndZoomIntoView(
    figma.currentPage.children.slice(-layoutResults.length)
  );
}

// ── AI Layout 렌더러 (하이브리드: 스크린샷 배경 + 텍스트 오버레이) ──

export async function renderAILayout(results: ExtractResult[]) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" }).catch(() => {});

  var aiResults = results.filter(function (r) {
    return r.success && r.aiScreenshot;
  });
  if (aiResults.length === 0) return;

  var offsetX = 0;

  for (var ri = 0; ri < aiResults.length; ri++) {
    var result = aiResults[ri];
    var textElements = (result.aiElements || []).filter(function (e) { return e.kind === "text"; });
    var pageW = result.pageWidth || 1920;
    var pageH = result.pageHeight || 800;

    // 루트 프레임 생성
    var rootFrame = figma.createFrame();
    rootFrame.name = "AI Layout: " + result.url;
    rootFrame.layoutMode = "NONE" as any;
    rootFrame.resize(pageW, pageH);
    rootFrame.clipsContent = true;
    rootFrame.x = offsetX;
    rootFrame.y = 0;

    // 1) 배경 레이어: 풀페이지 스크린샷
    try {
      var scrBytes = figma.base64Decode(result.aiScreenshot!);
      var scrImage = figma.createImage(scrBytes);
      rootFrame.fills = [{
        type: "IMAGE",
        imageHash: scrImage.hash,
        scaleMode: "FILL",
      } as ImagePaint];
    } catch (_) {
      rootFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    }

    // 2) 텍스트 오버레이: AI가 추출한 텍스트를 편집 가능한 노드로 배치
    for (var i = 0; i < textElements.length; i++) {
      var tel = textElements[i];
      if (!tel.text || tel.text.length === 0) continue;

      var textNode = figma.createText();
      textNode.name = tel.type + ": " + tel.text.slice(0, 30);

      // 폰트
      var fw = tel.fontWeight || 400;
      var fStyle = fw >= 700 ? "Bold" : fw >= 600 ? "Semi Bold" : "Regular";
      try {
        textNode.fontName = { family: "Inter", style: fStyle };
      } catch (_) {
        textNode.fontName = { family: "Inter", style: "Regular" };
      }

      textNode.characters = tel.text;
      textNode.fontSize = tel.fontSize || 16;

      // 색상
      if (tel.color) {
        try {
          textNode.fills = [{ type: "SOLID", color: hexToRgb(tel.color) }];
        } catch (_) {
          textNode.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
        }
      }

      // 위치
      textNode.x = tel.x;
      textNode.y = tel.y;
      if (tel.width > 0) {
        textNode.resize(tel.width, textNode.height);
        textNode.textAutoResize = "HEIGHT";
      }

      rootFrame.appendChild(textNode);
    }

    offsetX += rootFrame.width + SITE_GAP;
  }

  figma.viewport.scrollAndZoomIntoView(
    figma.currentPage.children.slice(-aiResults.length)
  );
}

// ── Semantic Layout 렌더러 (Auto Layout 기반) ──

function applyNodeVisualStyle(frame: FrameNode, node: LayoutNode): void {
  // 배경
  if (node.gradient && !node.imageData) {
    var grad = parseLinearGradient(node.gradient);
    if (grad) {
      frame.fills = [grad];
    } else if (node.backgroundColor) {
      frame.fills = [{ type: "SOLID", color: hexToRgb(node.backgroundColor) }];
    } else {
      frame.fills = [];
    }
  } else if (node.backgroundColor) {
    frame.fills = [{ type: "SOLID", color: hexToRgb(node.backgroundColor) }];
  } else {
    frame.fills = [];
  }

  // 보더
  if (node.borderWidth > 0 && node.borderColor) {
    frame.strokes = [{ type: "SOLID", color: hexToRgb(node.borderColor) }];
    frame.strokeWeight = Math.min(node.borderWidth, 4);
  }

  // 라운딩
  if (node.borderRadius > 0) {
    frame.cornerRadius = node.borderRadius;
  }

  // 그림자
  if (node.boxShadow) {
    var shadows = node.boxShadow.split(/,(?![^(]*\))/);
    var effects: Effect[] = [];
    for (var si = 0; si < shadows.length; si++) {
      var trimmed = shadows[si].trim();
      if (trimmed.indexOf("inset") !== -1) continue;
      var effect = parseBoxShadow(trimmed);
      if (effect) effects.push(effect);
    }
    if (effects.length > 0) frame.effects = effects;
  }

  // opacity
  if (node.opacity < 1) {
    frame.opacity = node.opacity;
  }

  // 클리핑
  var ov = node.overflow || "visible";
  frame.clipsContent = (ov === "hidden" || ov === "clip" || ov === "scroll" || ov === "auto");
}

function createStyledText(node: LayoutNode): TextNode {
  var textNode = figma.createText();
  textNode.name = node.tag;
  var fontFamily = node.fontFamily ? shortFontName(node.fontFamily) : "Inter";
  var fontWeight = node.fontWeight || 400;
  var cKey = fontFamily + "::" + weightToStyle(fontWeight);

  if (loadedFontCache[cKey]) {
    textNode.fontName = { family: fontFamily, style: weightToStyle(fontWeight) };
  } else {
    textNode.fontName = { family: "Inter", style: fontWeight >= 600 ? "Bold" : "Regular" };
  }

  textNode.characters = node.textContent || "";
  textNode.fontSize = node.fontSize || 16;
  if (node.lineHeight && node.lineHeight > 0) {
    textNode.lineHeight = { value: node.lineHeight, unit: "PIXELS" };
  }
  if (node.letterSpacing && node.letterSpacing !== 0) {
    textNode.letterSpacing = { value: node.letterSpacing, unit: "PIXELS" };
  }
  if (node.textColor) {
    textNode.fills = [{ type: "SOLID", color: hexToRgb(node.textColor) }];
  }
  if (node.textAlign === "center") {
    textNode.textAlignHorizontal = "CENTER";
  } else if (node.textAlign === "right") {
    textNode.textAlignHorizontal = "RIGHT";
  }
  // 기본: HEIGHT (가로는 부모가 결정, 세로만 텍스트에 맞춤)
  textNode.textAutoResize = "HEIGHT";
  return textNode;
}

function hasTextDescendant(node: LayoutNode): boolean {
  if (node.textContent) return true;
  for (var i = 0; i < node.children.length; i++) {
    if (hasTextDescendant(node.children[i])) return true;
  }
  return false;
}

function applyChildSizing(childNode: SceneNode, childData: LayoutNode, parentNode: LayoutNode): void {
  var isHorizontalParent = parentNode.layoutModel === "flex-row";
  var isSpaceBetween = parentNode.mainAxisAlign === "space-between";
  var crossAlign = parentNode.crossAxisAlign;
  // 교차축이 center/end이면 자식을 FILL하면 안 됨 (정렬 효과가 사라짐)
  var crossIsCentered = crossAlign === "center" || crossAlign === "end";

  try {
    if (childNode.type === "TEXT") {
      var tn = childNode as TextNode;

      if (isHorizontalParent) {
        // HORIZONTAL 부모의 주축 = 가로
        if (isSpaceBetween || childData.widthMode === "hug") {
          tn.textAutoResize = "WIDTH_AND_HEIGHT";
          tn.layoutSizingHorizontal = "HUG";
        } else if (childData.widthMode === "fill") {
          tn.textAutoResize = "HEIGHT";
          tn.layoutSizingHorizontal = "FILL";
        } else {
          tn.textAutoResize = "HEIGHT";
          tn.layoutSizingHorizontal = "FIXED";
        }
        // HORIZONTAL 교차축 = 세로: center면 HUG 유지
        tn.layoutSizingVertical = "HUG";
      } else {
        // VERTICAL 부모의 교차축 = 가로
        if (crossIsCentered && childData.widthMode !== "fill") {
          // center/end 정렬이면 가로를 FILL하면 안 됨
          tn.textAutoResize = "WIDTH_AND_HEIGHT";
          tn.layoutSizingHorizontal = childData.widthMode === "fixed" ? "FIXED" : "HUG";
        } else {
          tn.textAutoResize = "HEIGHT";
          tn.layoutSizingHorizontal = "FILL";
        }
        tn.layoutSizingVertical = "HUG";
      }
      return;
    }

    if (childNode.type === "FRAME") {
      var fn = childNode as FrameNode;
      // 텍스트를 포함하는 프레임은 높이를 HUG로 (텍스트 오버플로우 방지)
      var containsText = hasTextDescendant(childData);

      if (isHorizontalParent) {
        // ── HORIZONTAL 부모 ──
        // 주축 = 가로
        if (isSpaceBetween && childData.widthMode !== "fill") {
          fn.layoutSizingHorizontal = childData.widthMode === "fixed" ? "FIXED" : "HUG";
        } else if (childData.widthMode === "fill") {
          fn.layoutSizingHorizontal = "FILL";
        } else if (childData.widthMode === "fixed") {
          fn.layoutSizingHorizontal = "FIXED";
        } else {
          fn.layoutSizingHorizontal = "HUG";
        }

        // 교차축 = 세로: center/end면 FILL하면 안 됨
        if (crossIsCentered && childData.heightMode !== "fill") {
          fn.layoutSizingVertical = childData.heightMode === "fixed" ? "FIXED" : "HUG";
        } else if (childData.heightMode === "fill") {
          fn.layoutSizingVertical = "FILL";
        } else {
          fn.layoutSizingVertical = "HUG";
        }
      } else {
        // ── VERTICAL 부모 ──
        // 교차축 = 가로: center/end면 FILL하면 안 됨
        if (crossIsCentered && childData.widthMode !== "fill") {
          fn.layoutSizingHorizontal = childData.widthMode === "fixed" ? "FIXED" : "HUG";
        } else if (childData.widthMode === "fixed") {
          fn.layoutSizingHorizontal = "FIXED";
        } else {
          fn.layoutSizingHorizontal = "FILL";
        }

        // 주축 = 세로: 텍스트 포함이면 HUG 우선
        if (isSpaceBetween && childData.heightMode !== "fill") {
          fn.layoutSizingVertical = childData.heightMode === "fixed" ? "FIXED" : "HUG";
        } else if (childData.heightMode === "fill") {
          fn.layoutSizingVertical = "FILL";
        } else if (childData.heightMode === "fixed" && !containsText) {
          fn.layoutSizingVertical = "FIXED";
        } else {
          fn.layoutSizingVertical = "HUG";
        }
      }
    }
  } catch (_) { /* sizing 설정 실패 시 무시 */ }
}

async function renderNode(node: LayoutNode): Promise<SceneNode | null> {
  // 리프 텍스트 노드
  if (node.layoutModel === "leaf" && node.textContent) {
    var hasBg = !!(node.backgroundColor || node.borderWidth > 0 || node.boxShadow || node.gradient);

    if (hasBg) {
      // 배경이 있는 텍스트: 프레임으로 감싸기
      var textFrame = figma.createFrame();
      textFrame.name = node.tag + " (text)";
      textFrame.resize(Math.max(node.width, 1), Math.max(node.height, 1));
      textFrame.layoutMode = "VERTICAL";
      textFrame.primaryAxisSizingMode = "AUTO";
      textFrame.counterAxisSizingMode = "FIXED";
      textFrame.paddingTop = node.paddingTop;
      textFrame.paddingRight = node.paddingRight;
      textFrame.paddingBottom = node.paddingBottom;
      textFrame.paddingLeft = node.paddingLeft;
      applyNodeVisualStyle(textFrame, node);

      var textNode = createStyledText(node);
      textFrame.appendChild(textNode);
      textNode.layoutSizingHorizontal = "FILL";
      textNode.layoutSizingVertical = "HUG";
      return textFrame;
    } else {
      return createStyledText(node);
    }
  }

  // 이미지 노드
  if (node.isImage) {
    var imgFrame = figma.createFrame();
    imgFrame.name = node.tag === "img" ? "img" : "bg-image";
    imgFrame.resize(Math.max(node.width, 1), Math.max(node.height, 1));
    imgFrame.clipsContent = true;
    if (node.borderRadius > 0) imgFrame.cornerRadius = node.borderRadius;

    if (node.imageData) {
      try {
        var imgBytes = figma.base64Decode(node.imageData);
        var figmaImage = figma.createImage(imgBytes);
        imgFrame.fills = [{
          type: "IMAGE",
          imageHash: figmaImage.hash,
          scaleMode: "FILL",
        } as ImagePaint];
      } catch (_) {
        imgFrame.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
      }
    } else {
      imgFrame.fills = [{ type: "SOLID", color: { r: 0.94, g: 0.94, b: 0.96 } }];
    }

    return imgFrame;
  }

  // 컨테이너 노드
  var frame = figma.createFrame();
  frame.name = node.role || node.tag;

  // DOM 원본 크기로 초기화 (FILL 적용 전 기준 크기)
  frame.resize(Math.max(node.width, 1), Math.max(node.height, 1));

  var isHorizontal = node.layoutModel === "flex-row";

  // Auto Layout 설정
  frame.layoutMode = isHorizontal ? "HORIZONTAL" : "VERTICAL";

  // gap
  frame.itemSpacing = Math.round(node.gap);

  // padding
  frame.paddingTop = Math.round(node.paddingTop);
  frame.paddingRight = Math.round(node.paddingRight);
  frame.paddingBottom = Math.round(node.paddingBottom);
  frame.paddingLeft = Math.round(node.paddingLeft);

  // 주축 정렬
  if (node.mainAxisAlign === "center") {
    frame.primaryAxisAlignItems = "CENTER";
  } else if (node.mainAxisAlign === "end") {
    frame.primaryAxisAlignItems = "MAX";
  } else if (node.mainAxisAlign === "space-between") {
    frame.primaryAxisAlignItems = "SPACE_BETWEEN";
  } else {
    frame.primaryAxisAlignItems = "MIN";
  }

  // 교차축 정렬
  if (node.crossAxisAlign === "center") {
    frame.counterAxisAlignItems = "CENTER";
  } else if (node.crossAxisAlign === "end") {
    frame.counterAxisAlignItems = "MAX";
  } else {
    frame.counterAxisAlignItems = "MIN";
  }

  // wrap
  if (node.flexWrap) {
    (frame as any).layoutWrap = "WRAP";
    // wrap 모드에서 줄 간 gap (counterAxisSpacing)
    // flex-row: crossGap = row-gap, gap = column-gap (itemSpacing)
    // flex-col: crossGap = column-gap, gap = row-gap (itemSpacing)
    if (node.crossGap > 0) {
      (frame as any).counterAxisSpacing = Math.round(node.crossGap);
    } else if (node.gap > 0) {
      // gap shorthand: row-gap과 column-gap이 같은 경우
      (frame as any).counterAxisSpacing = Math.round(node.gap);
    }
  }

  // 시각 스타일
  applyNodeVisualStyle(frame, node);

  // 프레임 크기 모드
  frame.primaryAxisSizingMode = "AUTO"; // 주축 HUG
  frame.counterAxisSizingMode = "FIXED"; // 교차축 FIXED (DOM 원본 크기 유지, center 정렬 공간 확보)

  // 자식 중 margin:auto로 가운데 정렬된 요소가 있으면 부모 교차축을 CENTER로
  var hasCenteredChild = false;
  for (var ci = 0; ci < node.children.length; ci++) {
    if (node.children[ci].isCentered) {
      hasCenteredChild = true;
      break;
    }
  }
  if (hasCenteredChild && !isHorizontal) {
    frame.counterAxisAlignItems = "CENTER";
  }

  // 자식 렌더링
  for (var ci = 0; ci < node.children.length; ci++) {
    var childData = node.children[ci];
    var childNode = await renderNode(childData);
    if (!childNode) continue;

    var hasMargin = childData.marginTop > 0 || childData.marginRight > 0 ||
                    childData.marginBottom > 0 || childData.marginLeft > 0;

    if (hasMargin && !childData.isCentered) {
      // margin이 있는 요소: wrapper 프레임으로 감싸서 padding으로 변환
      var marginWrapper = figma.createFrame();
      marginWrapper.name = "margin-wrap";
      marginWrapper.fills = [];
      marginWrapper.clipsContent = false;
      marginWrapper.layoutMode = isHorizontal ? "HORIZONTAL" : "VERTICAL";
      marginWrapper.primaryAxisSizingMode = "AUTO";
      marginWrapper.counterAxisSizingMode = "AUTO";
      marginWrapper.paddingTop = Math.round(childData.marginTop);
      marginWrapper.paddingRight = Math.round(childData.marginRight);
      marginWrapper.paddingBottom = Math.round(childData.marginBottom);
      marginWrapper.paddingLeft = Math.round(childData.marginLeft);
      marginWrapper.itemSpacing = 0;
      marginWrapper.appendChild(childNode);
      applyChildSizing(childNode, childData, node);
      frame.appendChild(marginWrapper);
      // wrapper 크기: 교차축 center/end면 HUG (센터링 유지), 아니면 FILL
      var parentCrossCenter = node.crossAxisAlign === "center" || node.crossAxisAlign === "end";
      try {
        if (!isHorizontal) {
          marginWrapper.layoutSizingHorizontal = parentCrossCenter ? "HUG" : "FILL";
          marginWrapper.layoutSizingVertical = "HUG";
        } else {
          marginWrapper.layoutSizingHorizontal = "HUG";
          marginWrapper.layoutSizingVertical = parentCrossCenter ? "HUG" : "FILL";
        }
      } catch (_) {}
    } else {
      frame.appendChild(childNode);
      applyChildSizing(childNode, childData, node);
    }
  }

  return frame;
}

export async function renderSemanticLayout(results: ExtractResult[]) {
  var semanticResults = results.filter(function (r) {
    return r.success && r.layoutTree;
  });
  if (semanticResults.length === 0) return;

  // Inter 기본 로드
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  // 트리에서 사용된 폰트 사전 로드
  function collectFonts(node: LayoutNode, seen: Record<string, boolean>) {
    if (node.textContent && node.fontFamily && node.fontWeight !== null) {
      var fKey = shortFontName(node.fontFamily) + "::" + node.fontWeight;
      if (!seen[fKey]) {
        seen[fKey] = true;
      }
    }
    for (var i = 0; i < node.children.length; i++) {
      collectFonts(node.children[i], seen);
    }
  }

  for (var ri = 0; ri < semanticResults.length; ri++) {
    var tree = semanticResults[ri].layoutTree!;
    var fontSeen: Record<string, boolean> = {};
    collectFonts(tree, fontSeen);
    var fontKeys = Object.keys(fontSeen);
    for (var fi = 0; fi < fontKeys.length; fi++) {
      var parts = fontKeys[fi].split("::");
      await tryLoadFont(parts[0], parseInt(parts[1], 10));
    }
  }

  var offsetX = 0;

  for (var ri = 0; ri < semanticResults.length; ri++) {
    var result = semanticResults[ri];
    var tree = result.layoutTree!;

    // 루트 프레임을 렌더링
    var rootNode = await renderNode(tree);
    if (!rootNode) continue;

    // 최상위 프레임 설정
    if (rootNode.type === "FRAME") {
      rootNode.name = "Semantic: " + result.url;
      // 루트는 고정 너비, hug 높이
      (rootNode as FrameNode).layoutSizingHorizontal = "FIXED";
      (rootNode as FrameNode).resize(1920, (rootNode as FrameNode).height);
      (rootNode as FrameNode).layoutSizingVertical = "HUG";
    }

    rootNode.x = offsetX;
    rootNode.y = 0;
    figma.currentPage.appendChild(rootNode);

    offsetX += rootNode.width + SITE_GAP;
  }

  figma.viewport.scrollAndZoomIntoView(
    figma.currentPage.children.slice(-semanticResults.length)
  );
}
