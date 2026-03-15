interface ProgressBarProps {
  current: number;
  total: number;
  url: string;
}

export function ProgressBar({ current, total, url }: ProgressBarProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, marginBottom: 4, color: "#666" }}>
        처리 중 ({current}/{total}): {url}
      </div>
      <div
        style={{
          width: "100%",
          height: 6,
          backgroundColor: "#e0e0e0",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            backgroundColor: "#18a0fb",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
