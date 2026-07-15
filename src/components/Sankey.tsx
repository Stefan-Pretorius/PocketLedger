import { useMemo } from "react";
import type { SankeyData } from "../utils";

interface Props {
  data: SankeyData;
  width?: number;
  dimmedIds?: Set<string>;
}

const NODE_W = 14;
const NODE_GAP = 8;
const PAD = 24;
const LABEL_OFFSET = 8;
const FONT_SIZE = 12;
const MIN_HEIGHT = 400;
const MAX_HEIGHT = 700;

export function Sankey({ data, width = 1200, dimmedIds }: Props) {
  const svgWidth = width + 300;

  const layout = useMemo(() => {
    const { nodes, links } = data;
    if (nodes.length === 0) return { nodes: [], links: [], height: MIN_HEIGHT };

    const nodeVal = new Map<string, number>();
    for (const n of nodes) {
      const inVal = links.filter(l => l.target === n.id).reduce((s, l) => s + l.value, 0);
      const outVal = links.filter(l => l.source === n.id).reduce((s, l) => s + l.value, 0);
      nodeVal.set(n.id, Math.max(inVal, outVal, 1));
    }

    const cols = [0, 1, 2].map(col => nodes.filter(n => n.column === col));

    // Compute total needed height: tallest column's sum of values + gaps + padding
    const colTotals = cols.map(col =>
      col.reduce((s, n) => s + nodeVal.get(n.id)!, 0) + Math.max(0, col.length - 1) * NODE_GAP,
    );
    const maxCol = Math.max(...colTotals, 1);
    const height = Math.min(Math.max(Math.round(maxCol * 1.1 + PAD * 2), MIN_HEIGHT), MAX_HEIGHT);
    const available = height - PAD * 2;
    const scale = available / maxCol;

    const nodePos = new Map<string, { x: number; y: number; h: number }>();
    for (let ci = 0; ci < 3; ci++) {
      const space = width - PAD * 2 - NODE_W;
      const x = PAD + ci * (space / 2);
      let y = PAD;
      for (const n of cols[ci]) {
        const h = Math.max(nodeVal.get(n.id)! * scale, 6);
        nodePos.set(n.id, { x, y, h });
        y += h + NODE_GAP;
      }
    }

    const laidLinks = links.map(l => {
      const src = nodePos.get(l.source);
      const tgt = nodePos.get(l.target);
      if (!src || !tgt) return null;
      const sy = src.y + src.h / 2;
      const ty = tgt.y + tgt.h / 2;
      const sx = src.x + NODE_W;
      const tx = tgt.x;
      const cpx1 = sx + (tx - sx) * 0.45;
      const cpx2 = tx - (tx - sx) * 0.45;
      const d = `M${sx},${sy} C${cpx1},${sy} ${cpx2},${ty} ${tx},${ty}`;
      const dimmed = dimmedIds != null && (dimmedIds.has(l.source) || dimmedIds.has(l.target));
      return { d, color: l.color, value: l.value, dimmed };
    }).filter(Boolean);

    const laidNodes = [...nodePos.entries()].map(([id, p]) => {
      const n = nodes.find(x => x.id === id);
      const dimmed = dimmedIds != null && dimmedIds.has(id);
      return { id, ...p, label: n?.label ?? id, color: n?.color ?? "#94a3b8", dimmed };
    });

    return { nodes: laidNodes, links: laidLinks as NonNullable<typeof laidLinks[number]>[], height };
  }, [data, width, dimmedIds]);

  if (data.nodes.length === 0) return null;

  return (
    <svg
      width={svgWidth}
      height={layout.height}
      style={{ maxWidth: "none", maxHeight: "none", overflow: "visible" }}
    >
      <defs>
        {layout.links.map((l, i) => (
          <linearGradient key={i} id={`sg-${i}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={l.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={l.color} stopOpacity="0.25" />
          </linearGradient>
        ))}
      </defs>
      {layout.links.map((l, i) => (
        <path
          key={i} d={l.d} fill="none" stroke={`url(#sg-${i})`}
          strokeWidth={Math.max(Math.sqrt(l.value) * 0.35, 2)}
          opacity={l.dimmed ? 0.15 : 0.6}
        />
      ))}
      {layout.nodes.map(n => (
        <g key={n.id} opacity={n.dimmed ? 0.35 : 1}>
          <rect x={n.x} y={n.y} width={NODE_W} height={n.h} fill={n.color} rx="3" ry="3" opacity="0.85" />
          <text
            x={n.x + NODE_W + LABEL_OFFSET}
            y={n.y + n.h / 2}
            fontSize={FONT_SIZE}
            fill="currentColor"
            className="text-foreground fill-foreground"
            dominantBaseline="middle"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
