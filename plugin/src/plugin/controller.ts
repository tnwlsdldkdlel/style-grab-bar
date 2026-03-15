import { renderTables, renderCleanedTables, renderCaptureForSession, renderLayout } from "./tableRenderer";
import type { PluginMessage, ExtractResult } from "../types";

figma.showUI(__html__, { width: 420, height: 520 });

// 청크 수집용 저장소
var chunkStore: Record<string, { chunks: Uint8Array[]; total: number; received: number }> = {};

// 결과 데이터 저장 (스크린샷 오버레이용)
var resultStore: Record<string, ExtractResult> = {};

figma.ui.onmessage = async (msg: any) => {
  // 디버그: 수신 메시지 확인
  console.log("[StyleGrabber] msg received:", msg.type, "keys:", Object.keys(msg));

  if (msg.type === "done") {
    var results = msg.results as ExtractResult[];
    var cleanedOnly = msg.cleanedOnly || false;

    console.log("[StyleGrabber] results count:", results.length, "first result:", results[0] ? { success: results[0].success, url: results[0].url, hasData: !!results[0].data, hasLayout: !!results[0].layoutElements } : "none");

    // 결과 데이터 저장
    for (var ri = 0; ri < results.length; ri++) {
      if (results[ri].success) {
        resultStore[results[ri].url] = results[ri];
      }
    }

    var successCount = results.filter(function (r) { return r.success; }).length;
    var failCount = results.length - successCount;

    var layoutMode = msg.layoutMode || false;

    console.log("[StyleGrabber] successCount:", successCount, "layoutMode:", layoutMode, "cleanedOnly:", cleanedOnly);

    if (successCount > 0) {
      try {
        if (layoutMode) {
          await renderLayout(results);
        } else if (cleanedOnly) {
          await renderCleanedTables(results);
        } else {
          await renderTables(results);
        }
        var modeLabel = cleanedOnly ? " (Cleaned)" : "";
        figma.notify(successCount + "개 사이트 추출 완료" + modeLabel + (failCount > 0 ? ", " + failCount + "개 실패" : ""));
      } catch (e) {
        var errMsg = e instanceof Error ? e.message : String(e);
        figma.notify("렌더링 오류: " + errMsg, { error: true });
      }
    } else {
      figma.notify("추출에 성공한 사이트가 없습니다.", { error: true });
    }
  }

  if (msg.type === "screenshot-chunk") {
    try {
      var url = msg.url as string;
      var chunkIndex = msg.chunkIndex as number;
      var totalChunks = msg.totalChunks as number;

      var raw = msg.data;
      var imageData: Uint8Array;
      if (typeof raw === "string") {
        if (raw.indexOf(",") > -1) {
          var parts = raw.split(",");
          imageData = new Uint8Array(parts.length);
          for (var pi = 0; pi < parts.length; pi++) {
            imageData[pi] = parseInt(parts[pi], 10);
          }
        } else {
          try {
            imageData = figma.base64Decode(raw);
          } catch (decErr) {
            figma.notify("base64 디코딩 실패 (chunk " + chunkIndex + ")", { error: true });
            return;
          }
        }
      } else if (raw instanceof Uint8Array) {
        imageData = raw;
      } else if (typeof raw === "object" && raw !== null && typeof raw.length === "number") {
        imageData = new Uint8Array(raw.length);
        for (var idx = 0; idx < raw.length; idx++) imageData[idx] = raw[idx];
      } else {
        figma.notify("데이터 형식 오류: " + typeof raw, { error: true });
        return;
      }

      // 청크 저장
      if (!chunkStore[url]) {
        chunkStore[url] = { chunks: new Array(totalChunks), total: totalChunks, received: 0 };
      }
      chunkStore[url].chunks[chunkIndex] = imageData;
      chunkStore[url].received++;

      // 모든 청크 수신 완료 시 렌더링
      if (chunkStore[url].received >= chunkStore[url].total) {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        await figma.loadFontAsync({ family: "Inter", style: "Bold" });
        var result = resultStore[url] || null;
        renderCaptureForSession(url, chunkStore[url].chunks, result);
        figma.notify("스크린샷 추가 완료: " + url);
        delete chunkStore[url];
        delete resultStore[url];
      }
    } catch (e) {
      var scrErrMsg = e instanceof Error ? e.message : String(e);
      figma.notify("스크린샷 오류: " + scrErrMsg, { error: true });
    }
  }
};
