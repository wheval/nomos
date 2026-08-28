"use client";

import { useState } from "react";
import styles from "../../../uni.module.css";

export type ChartPoint = { label: string; value: number };

// Round the axis ceiling up to a clean 1/2/5 x 10^n step so the gridline
// labels read as round numbers instead of whatever the max happened to be.
function niceCeil(max: number): number {
  if (max <= 0) return 4;
  const mag = 10 ** Math.floor(Math.log10(max));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const TICKS = 4; // 4 intervals -> 5 gridlines, matching the reference

export default function InsightsChart({
  points,
  unit,
  format,
}: {
  points: ChartPoint[];
  unit: string;
  format: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) return null;

  const ceil = niceCeil(Math.max(...points.map((p) => p.value)));
  const xAt = (i: number) => (i / (points.length - 1)) * 100;
  const yAt = (v: number) => (1 - v / ceil) * 100;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.value)}`).join(" ");

  // Only every Nth date gets a label, or they collide at narrow widths.
  const labelStride = Math.ceil(points.length / 12);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(ratio * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  }

  const active = hover === null ? null : points[hover];

  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartBody}>
        <div className={styles.chartYAxis}>
          {Array.from({ length: TICKS + 1 }, (_, i) => (
            <span key={i} className={styles.chartYLabel} style={{ top: `${(i / TICKS) * 100}%` }}>
              {format((ceil * (TICKS - i)) / TICKS)}
            </span>
          ))}
        </div>

        <div className={styles.chartPlot} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {Array.from({ length: TICKS + 1 }, (_, i) => (
            <span key={i} className={styles.chartGridLine} style={{ top: `${(i / TICKS) * 100}%` }} />
          ))}

          <svg className={styles.chartSvg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              d={path}
              fill="none"
              stroke="var(--pink)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {hover !== null && active ? (
            <>
              <span className={styles.chartCursor} style={{ left: `${xAt(hover)}%` }} />
              <span
                className={styles.chartDot}
                style={{ left: `${xAt(hover)}%`, top: `${yAt(active.value)}%` }}
              />
              <div
                className={styles.chartTooltip}
                style={{ left: `clamp(85px, ${xAt(hover)}%, calc(100% - 85px))`, top: `${yAt(active.value)}%` }}
              >
                <div className={styles.chartTooltipDay}>{active.label}</div>
                <div className={styles.chartTooltipRow}>
                  <span className={styles.chartTooltipDot} />
                  {unit}
                  <span className={styles.chartTooltipVal}>{format(active.value)}</span>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className={styles.chartXAxis}>
        {points.map((p, i) =>
          i % labelStride === 0 ? (
            <span key={p.label} className={styles.chartXLabel}>
              {p.label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

// Share-of-total ring with the percentage in the middle.
export function Donut({ percent, size = 148 }: { percent: number; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={styles.donutWrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth="14" strokeLinecap="round">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--inset-2)" />
          {clamped > 0 ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke="var(--pink)"
              strokeDasharray={`${(clamped / 100) * c} ${c}`}
            />
          ) : null}
        </g>
      </svg>
      <span className={styles.donutValue}>{Math.round(clamped)}%</span>
    </div>
  );
}
