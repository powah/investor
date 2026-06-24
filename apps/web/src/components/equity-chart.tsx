"use client";

import { useEffect, useMemo, useRef } from "react";
import { createChart, LineSeries, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import type { JournalEntry } from "@/types/trading";

type EquityChartProps = {
  entries: JournalEntry[];
};

export function EquityChart({ entries }: EquityChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const data = useMemo(() => {
    return [...entries]
      .sort((a, b) => `${a.trade_date}-${a.id}`.localeCompare(`${b.trade_date}-${b.id}`))
      .reduce<{ equity: number; points: { time: UTCTimestamp; value: number }[] }>(
        (accumulator, entry) => {
        const equity = accumulator.equity + entry.pnl;
        const timestamp = Math.floor(new Date(`${entry.trade_date}T12:00:00Z`).getTime() / 1000);
        return {
          equity,
          points: [
            ...accumulator.points,
            {
              time: timestamp as UTCTimestamp,
              value: Number(equity.toFixed(2)),
            },
          ],
        };
      },
      { equity: 0, points: [] },
    ).points;
  }, [entries]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let chart: IChartApi | null = createChart(containerRef.current, {
      height: 190,
      layout: {
        background: { color: "#ffffff" },
        textColor: "#475569",
      },
      grid: {
        vertLines: { color: "#eef2f7" },
        horzLines: { color: "#eef2f7" },
      },
      rightPriceScale: {
        borderColor: "#d7dde7",
      },
      timeScale: {
        borderColor: "#d7dde7",
        timeVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    });

    const series = chart.addSeries(LineSeries, {
      color: "#2563eb",
      lineWidth: 2,
      priceLineVisible: false,
    });
    series.setData(data);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chart) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart?.remove();
      chart = null;
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex h-[190px] items-center justify-center border-t border-line text-sm text-slate-500">No journal data.</div>
    );
  }

  return <div ref={containerRef} className="h-[190px] w-full border-t border-line" />;
}
