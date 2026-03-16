import { useState, useCallback } from "react";
import { ProgressBar } from "./components/ProgressBar";
import { ResultList } from "./components/ResultList";
import type { ExtractResult } from "../types";

const SERVER_URL = "http://localhost:3001";

function App() {
  const [urls, setUrls] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, url: "" });
  const [results, setResults] = useState<ExtractResult[]>([]);
  const [cleanedOnly, setCleanedOnly] = useState(false);
  const [mode, setMode] = useState<"style" | "layout" | "ai-layout">("style");

  const handleExtract = useCallback(async () => {
    const urlList = urls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urlList.length === 0) return;

    setIsProcessing(true);
    setResults([]);
    const allResults: ExtractResult[] = [];

    const isLayout = mode === "layout";
    const isAILayout = mode === "ai-layout";
    const endpoint = isAILayout
      ? "/api/extract-layout-ai"
      : isLayout
      ? "/api/extract-layout"
      : "/api/extract";

    for (let i = 0; i < urlList.length; i++) {
      const url = urlList[i];
      setProgress({ current: i + 1, total: urlList.length, url });

      try {
        const resp = await fetch(`${SERVER_URL}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const result: ExtractResult = await resp.json();
        console.log("[UI] fetch result:", url, "success:", result.success, "hasData:", !!result.data, "hasLayout:", !!result.layoutElements, "hasAI:", !!result.aiElements, "error:", result.error);
        allResults.push(result);
      } catch (err) {
        console.error("[UI] fetch error:", url, err);
        allResults.push({
          url,
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        });
      }

      setResults([...allResults]);
    }

    console.log("[UI] posting done message. mode:", mode, "resultCount:", allResults.length, "successes:", allResults.filter(r => r.success).length);

    if (isAILayout) {
      // AI Layout 모드
      parent.postMessage(
        { pluginMessage: { type: "done", results: allResults, aiLayoutMode: true } },
        "*"
      );
    } else if (isLayout) {
      // Layout 모드: 스크린샷 없이 바로 전달
      parent.postMessage(
        { pluginMessage: { type: "done", results: allResults, layoutMode: true } },
        "*"
      );
    } else {
      // 기존 Style Analysis 모드
      const chunkMap: Record<string, string[]> = {};
      const lightenedResults = allResults.map((r) => {
        if (r.screenshotChunks && r.screenshotChunks.length > 0) {
          chunkMap[r.url] = r.screenshotChunks;
        }
        const { screenshot, screenshotChunks, ...rest } = r;
        return rest;
      });

      parent.postMessage(
        { pluginMessage: { type: "done", results: lightenedResults, cleanedOnly } },
        "*"
      );

      for (const [url, chunks] of Object.entries(chunkMap)) {
        for (let i = 0; i < chunks.length; i++) {
          parent.postMessage(
            { pluginMessage: { type: "screenshot-chunk", url, data: chunks[i], chunkIndex: i, totalChunks: chunks.length } },
            "*"
          );
        }
      }
    }

    setIsProcessing(false);
  }, [urls, cleanedOnly, mode]);

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>StyleGrabber</h2>
      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        placeholder={"URL을 한 줄에 하나씩 입력하세요\nhttps://example.com\nhttps://example2.com"}
        disabled={isProcessing}
        style={{
          width: "100%",
          height: 140,
          resize: "vertical",
          boxSizing: "border-box",
          padding: 8,
          fontSize: 12,
          fontFamily: "monospace",
        }}
      />

      {/* 모드 선택 */}
      <div style={{ marginTop: 10, display: "flex", gap: 12, fontSize: 12 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            userSelect: "none",
            color: mode === "style" ? "#18a0fb" : "#555",
            fontWeight: mode === "style" ? 600 : 400,
          }}
        >
          <input
            type="radio"
            name="mode"
            value="style"
            checked={mode === "style"}
            onChange={() => setMode("style")}
            disabled={isProcessing}
            style={{ margin: 0, cursor: "pointer" }}
          />
          Style Analysis
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            userSelect: "none",
            color: mode === "layout" ? "#7b61ff" : "#555",
            fontWeight: mode === "layout" ? 600 : 400,
          }}
        >
          <input
            type="radio"
            name="mode"
            value="layout"
            checked={mode === "layout"}
            onChange={() => setMode("layout")}
            disabled={isProcessing}
            style={{ margin: 0, cursor: "pointer" }}
          />
          Layout Reconstruction
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            cursor: "pointer",
            userSelect: "none",
            color: mode === "ai-layout" ? "#10a37f" : "#555",
            fontWeight: mode === "ai-layout" ? 600 : 400,
          }}
        >
          <input
            type="radio"
            name="mode"
            value="ai-layout"
            checked={mode === "ai-layout"}
            onChange={() => setMode("ai-layout")}
            disabled={isProcessing}
            style={{ margin: 0, cursor: "pointer" }}
          />
          AI Layout
        </label>
      </div>

      {/* Phase 17: Cleaned Version 토글 (Style 모드에서만 표시) */}
      {mode === "style" && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 8,
            fontSize: 12,
            color: "#555",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={cleanedOnly}
            onChange={(e) => setCleanedOnly(e.target.checked)}
            disabled={isProcessing}
            style={{ margin: 0, cursor: "pointer" }}
          />
          <span>Cleaned Version만 보기</span>
          <span
            style={{
              fontSize: 10,
              color: "#999",
              marginLeft: 2,
            }}
          >
            (비표준 스타일 제거 + 유사값 병합)
          </span>
        </label>
      )}

      <button
        onClick={handleExtract}
        disabled={isProcessing}
        style={{
          marginTop: 8,
          width: "100%",
          padding: "8px 0",
          backgroundColor: isProcessing ? "#ccc" : mode === "ai-layout" ? "#10a37f" : mode === "layout" ? "#7b61ff" : cleanedOnly ? "#7b61ff" : "#18a0fb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: isProcessing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {isProcessing
          ? "추출 중..."
          : mode === "ai-layout"
          ? "AI 레이아웃 추출 시작"
          : mode === "layout"
          ? "레이아웃 추출 시작"
          : cleanedOnly
          ? "정제 추출 시작"
          : "추출 시작"}
      </button>

      {isProcessing && (
        <ProgressBar
          current={progress.current}
          total={progress.total}
          url={progress.url}
        />
      )}

      <ResultList results={results} />
    </div>
  );
}

export default App;
