import { Router, Request, Response, NextFunction } from "express";
import { parseTypography, parseLayout } from "../services/parser";
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
