import OpenAI from "openai";
import puppeteer from "puppeteer";

const VIEWPORT = { width: 1280, height: 800 };
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface AILayoutElement {
  kind: "text" | "visual";
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  description: string;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  backgroundColor?: string | null;
  imageData?: string;
}

export async function parseLayoutWithAI(url: string): Promise<{
  elements: AILayoutElement[];
  screenshotBase64: string;
  pageWidth: number;
  pageHeight: number;
}> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(USER_AGENT);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

  // 스크롤하여 lazy load 트리거
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const height = document.body.scrollHeight;
    const vh = window.innerHeight;
    let y = 0;
    while (y < height) {
      y += vh;
      window.scrollTo(0, y);
      await delay(300);
    }
    await delay(1000);
    window.scrollTo(0, 0);
    await delay(500);
  });

  await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

  const pageHeight = await page.evaluate(() =>
    Math.min(document.body.scrollHeight, 8000)
  );

  // 풀페이지 스크린샷 (배경 레이어용)
  const screenshotBase64 = await page.screenshot({
    type: "jpeg",
    quality: 85,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: pageHeight },
    encoding: "base64",
  }) as string;

  console.log("[AI Layout] Screenshot taken:", VIEWPORT.width, "x", pageHeight);

  // GPT-4o Vision: 텍스트 요소만 정밀 추출
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a text extraction specialist for web-to-Figma conversion.

Given a webpage screenshot (${VIEWPORT.width}x${pageHeight}px), extract ALL visible text elements with precise bounding boxes and styling.

Return JSON: { "texts": [...] }

Each text element:
- "text": exact visible text content (preserve original language, Korean etc.)
- "x": x position in pixels (integer)
- "y": y position in pixels (integer)
- "width": text block width in pixels (integer)
- "height": text block height in pixels (integer)
- "fontSize": font size in px (integer, estimate from visual size)
- "fontWeight": 400=regular, 600=semi-bold, 700=bold
- "color": text color as hex (e.g. "#ffffff", "#333333")
- "type": one of: heading, subheading, paragraph, nav-item, button-label, link, caption, price, badge, footer-text, label

Rules:
- Extract EVERY piece of visible text on the page, no matter how small
- Include: headings, body text, navigation items, button labels, footer links, prices, badges, captions, form labels
- Each distinct text block should be a separate element
- If text wraps to multiple lines, treat it as ONE element with appropriate width/height
- Be very precise with x,y coordinates — they must align with the screenshot
- Coordinates within bounds: x+width ≤ ${VIEWPORT.width}, y+height ≤ ${pageHeight}
- Estimate fontSize accurately: nav items ~14px, body ~16px, headings 24-48px, small text ~12px
- Return 50+ text elements for a typical content-rich webpage`
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract ALL text elements from this Korean webpage with precise positions and styling. Image: ${VIEWPORT.width}x${pageHeight}px`
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${screenshotBase64}`,
              detail: "high"
            }
          }
        ]
      }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    await browser.close();
    throw new Error("AI response empty");
  }

  let rawTexts: any[];
  try {
    const parsed = JSON.parse(content);
    rawTexts = parsed.texts || [];
  } catch {
    await browser.close();
    throw new Error("Failed to parse AI response: " + content.slice(0, 200));
  }

  console.log("[AI Layout] GPT returned", rawTexts.length, "text elements");

  // 텍스트 요소만 반환 (비주얼은 스크린샷 배경으로 처리)
  const elements: AILayoutElement[] = [];

  for (const t of rawTexts) {
    if (!t.text || t.text.length === 0) continue;

    const x = Math.max(0, Math.round(t.x || 0));
    const y = Math.max(0, Math.round(t.y || 0));
    const w = Math.min(Math.round(t.width || 100), VIEWPORT.width - x);
    const h = Math.round(t.height || 20);

    if (w < 4 || h < 4) continue;

    elements.push({
      kind: "text",
      x, y, width: w, height: h,
      type: t.type || "paragraph",
      description: t.text.slice(0, 40),
      text: t.text,
      fontSize: t.fontSize || 16,
      fontWeight: t.fontWeight || 400,
      color: t.color || "#000000",
    });
  }

  await browser.close();

  console.log("[AI Layout] Final:", elements.length, "text elements + screenshot background");

  return { elements, screenshotBase64, pageWidth: VIEWPORT.width, pageHeight };
}
