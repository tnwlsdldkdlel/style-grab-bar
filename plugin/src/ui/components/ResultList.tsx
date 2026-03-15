import type { ExtractResult } from "../../types";

interface ResultListProps {
  results: ExtractResult[];
}

export function ResultList({ results }: ResultListProps) {
  if (results.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>결과</div>
      <div style={{ maxHeight: 160, overflowY: "auto" }}>
        {results.map((r, i) => (
          <div
            key={i}
            style={{
              padding: "4px 6px",
              fontSize: 11,
              borderBottom: "1px solid #eee",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                marginRight: 8,
              }}
              title={r.url}
            >
              {r.url}
            </span>
            {r.success ? (
              <span style={{ color: "#1bc47d", flexShrink: 0 }}>
                {r.data?.length ?? 0}개 스타일
              </span>
            ) : (
              <span style={{ color: "#f24822", flexShrink: 0 }} title={r.error}>
                실패
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
