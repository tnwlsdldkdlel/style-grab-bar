import { Router, Request, Response, NextFunction } from "express";
import { parseTypography, parseLayout, parseSemanticLayout } from "../services/parser";
import { parseLayoutWithAI } from "../services/aiLayout";
import type { ExtractResult } from "../types";

export const extractRouter = Router();

// URL 검증 미들웨어
function validateUrl(req: Request, res: Response, next: NextFunction): void {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }
  next();
}

extractRouter.post("/extract", validateUrl, async (req, res) => {
  const { url } = req.body;
  try {
    const { styles, scaleSystem, componentSpecs, audit, cleanedData, screenshot, screenshotChunks, elementPositions } = await parseTypography(url);
    const result: ExtractResult = { url, success: true, data: styles, scaleSystem, componentSpecs, audit, cleanedData, screenshot, screenshotChunks, elementPositions };
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const result: ExtractResult = { url, success: false, error: message };
    res.json(result);
  }
});

extractRouter.post("/extract-layout", validateUrl, async (req, res) => {
  const { url } = req.body;
  try {
    const { layoutElements } = await parseLayout(url);
    const result: ExtractResult = { url, success: true, layoutElements };
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const result: ExtractResult = { url, success: false, error: message };
    res.json(result);
  }
});

extractRouter.post("/extract-semantic-layout", validateUrl, async (req, res) => {
  const { url } = req.body;
  try {
    const { layoutTree } = await parseSemanticLayout(url);
    const result: ExtractResult = { url, success: true, layoutTree };
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const result: ExtractResult = { url, success: false, error: message };
    res.json(result);
  }
});

extractRouter.post("/extract-layout-ai", validateUrl, async (req, res) => {
  const { url } = req.body;
  console.log("[AI Layout] Starting for:", url);
  try {
    const { elements, screenshotBase64, pageWidth, pageHeight } = await parseLayoutWithAI(url);
    console.log("[AI Layout] Success:", elements.length, "text elements + screenshot");
    res.json({ url, success: true, aiElements: elements, aiScreenshot: screenshotBase64, pageWidth, pageHeight });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI Layout] Error:", message);
    res.json({ url, success: false, error: message });
  }
});
