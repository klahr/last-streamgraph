/**
 * The Streamgraph: an imperative D3 render inside React.
 *
 * We let D3 own the SVG internals (paths, axes, transitions) because morphing
 * hundreds of area paths smoothly is exactly what D3's transition/`interpolate`
 * machinery is built for, while React owns the surrounding layout and the
 * tooltip overlay (driven by hover state lifted out of the D3 event handlers).
 *
 * Modes:
 *  - absolute → `stackOffsetWiggle` (classic organic streamgraph); total
 *    thickness at any x equals that bucket's scrobble count.
 *  - relative → `stackOffsetExpand` (each bucket normalized to fill 100% height).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  area,
  axisBottom,
  axisLeft,
  curveBasis,
  format as d3format,
  max,
  min,
  scaleLinear,
  scaleTime,
  select,
  stack,
  stackOffsetExpand,
  stackOffsetWiggle,
  stackOrderInsideOut,
  timeFormat,
  type Series,
  type SeriesPoint,
} from 'd3';
import type { PaletteId, ProcessedData, Resolution, StreamMode } from '../types';
import { buildColorMap } from '../utils/colors';
import type { Size } from '../hooks/useResizeObserver';

interface Props {
  data: ProcessedData;
  size: Size;
  mode: StreamMode;
  palette: PaletteId;
  resolution: Resolution;
}

interface TooltipState {
  x: number;
  y: number;
  artist: string;
  label: string;
  count: number;
  pct: number;
  color: string;
}

const MARGIN = { top: 16, right: 16, bottom: 28, left: 48 };
const TRANSITION_MS = 600;
/** Above this many simultaneous streams, skip the `d` morph (too costly to animate). */
const ANIMATE_MAX_LAYERS = 80;

export function Streamgraph({ data, size, mode, palette, resolution }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const colorMap = useMemo(
    () => buildColorMap(data.keys, palette),
    [data.keys, palette],
  );

  const innerW = Math.max(0, size.width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, size.height - MARGIN.top - MARGIN.bottom);

  useEffect(() => {
    const svg = select(svgRef.current);
    if (!data.keys.length || !data.matrix.length || innerW <= 0 || innerH <= 0) {
      svg.selectAll('*').remove();
      return;
    }

    // --- Scales -----------------------------------------------------------
    const xScale = scaleTime()
      .domain([
        data.matrix[0]!.date,
        data.matrix[data.matrix.length - 1]!.date,
      ])
      .range([0, innerW]);

    const offset = mode === 'relative' ? stackOffsetExpand : stackOffsetWiggle;
    const series = stack<ProcessedData['matrix'][number], string>()
      .keys(data.keys)
      .value((d, key) => (d[key] as number) ?? 0)
      .order(stackOrderInsideOut)
      .offset(offset)(data.matrix);

    const yMin = min(series, (s) => min(s, (d) => d[0])) ?? 0;
    const yMax = max(series, (s) => max(s, (d) => d[1])) ?? 1;
    const yScale = scaleLinear().domain([yMin, yMax]).range([innerH, 0]);

    const areaGen = area<SeriesPoint<ProcessedData['matrix'][number]>>()
      .x((d) => xScale(d.data.date))
      .y0((d) => yScale(d[0]))
      .y1((d) => yScale(d[1]))
      .curve(curveBasis);

    // --- Root group -------------------------------------------------------
    let root = svg.select<SVGGElement>('g.sg-root');
    if (root.empty()) {
      root = svg.append('g').attr('class', 'sg-root');
      root.append('g').attr('class', 'sg-layers');
      root.append('g').attr('class', 'sg-x-axis');
      root.append('g').attr('class', 'sg-y-axis');
    }
    root.attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // --- Layer paths (keyed join with smooth morphing) --------------------
    const layers = root
      .select('g.sg-layers')
      .selectAll<SVGPathElement, Series<ProcessedData['matrix'][number], string>>(
        'path.sg-layer',
      )
      .data(series, (s) => s.key);

    // Morphing the `d` of every path each frame is O(paths × points) per frame
    // and dominates render time once there are many streams (a top-100 union
    // can be 800+ paths → multi-second freeze). Above a threshold the morph is
    // visual mush anyway, so set geometry directly and skip the transition.
    const animate = series.length <= ANIMATE_MAX_LAYERS;

    if (animate) {
      layers.exit().transition().duration(TRANSITION_MS).style('opacity', 0).remove();
    } else {
      layers.exit().remove();
    }

    const enter = layers
      .enter()
      .append('path')
      .attr('class', 'sg-layer')
      .attr('fill', (s) => colorMap[s.key] ?? '#888')
      .attr('d', areaGen)
      .style('opacity', animate ? 0 : 1)
      .style('cursor', 'pointer');

    // Hover interactions: dim siblings, raise & outline the active layer.
    const allLayers = enter.merge(layers);
    allLayers
      .on('mousemove', function (event: MouseEvent, s) {
        const [mx, my] = pointer(event, svgRef.current!);
        const bisectDate = xScale.invert(mx - MARGIN.left);
        const idx = nearestIndex(data.matrix, +bisectDate);
        const datum = data.matrix[idx]!;
        const count = (datum[s.key] as number) ?? 0;
        const bucketTotal = data.keys.reduce(
          (sum, k) => sum + ((datum[k] as number) ?? 0),
          0,
        );
        allLayers.style('opacity', (o) => (o.key === s.key ? 1 : 0.2));
        select(this).attr('stroke', '#0b0e14').attr('stroke-width', 1);
        setTooltip({
          x: mx,
          y: my,
          artist: s.key,
          label: datum.label,
          count,
          pct: bucketTotal > 0 ? (count / bucketTotal) * 100 : 0,
          color: colorMap[s.key] ?? '#888',
        });
      })
      .on('mouseleave', function () {
        allLayers.style('opacity', 1);
        select(this).attr('stroke', null);
        setTooltip(null);
      });

    // Update existing layers' geometry + color (animated only when few enough).
    if (animate) {
      enter.transition().duration(TRANSITION_MS).style('opacity', 1);
      layers
        .transition()
        .duration(TRANSITION_MS)
        .attr('fill', (s) => colorMap[s.key] ?? '#888')
        .attr('d', areaGen);
    } else {
      layers.attr('fill', (s) => colorMap[s.key] ?? '#888').attr('d', areaGen);
    }

    // --- X axis -----------------------------------------------------------
    const tickFmt = timeFormat(
      resolution === 'yearly' ? '%Y' : resolution === 'monthly' ? "%b '%y" : '%d %b',
    );
    const xAxis = axisBottom<Date>(xScale)
      .ticks(Math.max(2, Math.floor(innerW / 90)))
      .tickFormat((d) => tickFmt(d as Date))
      .tickSizeOuter(0);
    root
      .select<SVGGElement>('g.sg-x-axis')
      .attr('transform', `translate(0,${innerH})`)
      .transition()
      .duration(TRANSITION_MS)
      .call(xAxis as never);

    // --- Y axis -----------------------------------------------------------
    const yAxisG = root.select<SVGGElement>('g.sg-y-axis');
    if (mode === 'relative') {
      const yPct = scaleLinear().domain([0, 1]).range([innerH, 0]);
      const yAxis = axisLeft(yPct)
        .ticks(5)
        .tickFormat((d) => `${Math.round((d as number) * 100)}%`)
        .tickSizeOuter(0);
      yAxisG.transition().duration(TRANSITION_MS).style('opacity', 1).call(yAxis as never);
    } else {
      // Absolute: thickness encodes scrobble counts. The wiggle baseline wanders,
      // so instead of a misleading origin axis we show a constant-scale tick set
      // (pixels-per-scrobble is constant), labelled as play counts spanning the
      // chart's vertical extent.
      const span = yMax - yMin; // total scrobbles represented top-to-bottom
      const countScale = scaleLinear().domain([0, span]).range([innerH, 0]);
      const yAxis = axisLeft(countScale)
        .ticks(5)
        .tickFormat((d) => d3format('~s')(d as number))
        .tickSizeOuter(0);
      yAxisG.transition().duration(TRANSITION_MS).style('opacity', 1).call(yAxis as never);
    }
  }, [data, innerW, innerH, mode, colorMap, resolution]);

  if (!data.matrix.length) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-500">
        No scrobbles in range yet.
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="block text-slate-400"
        role="img"
        aria-label="Streamgraph of listening history by artist over time"
      />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-slate-700 bg-slate-900/95 px-3 py-2 text-sm shadow-xl"
          style={{
            left: clampTooltip(tooltip.x, size.width),
            top: tooltip.y + 12,
          }}
        >
          <div className="flex items-center gap-2 font-medium text-slate-100">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: tooltip.color }}
            />
            {tooltip.artist}
          </div>
          <div className="mt-1 text-slate-400">{tooltip.label}</div>
          <div className="text-slate-200">
            {tooltip.count.toLocaleString()} play
            {tooltip.count === 1 ? '' : 's'} · {tooltip.pct.toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}

/** Keep the tooltip from overflowing the right edge. */
function clampTooltip(x: number, width: number): number {
  const TOOLTIP_W = 220;
  return Math.min(Math.max(8, x + 12), width - TOOLTIP_W);
}

/** d3.pointer without importing the whole event namespace inline. */
function pointer(event: MouseEvent, node: SVGSVGElement): [number, number] {
  const rect = node.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

/** Index of the matrix bucket whose date is closest to `target` (epoch ms). */
function nearestIndex(matrix: ProcessedData['matrix'], target: number): number {
  let lo = 0;
  let hi = matrix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matrix[mid]!.date < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(matrix[lo - 1]!.date - target) < Math.abs(matrix[lo]!.date - target)) {
    return lo - 1;
  }
  return lo;
}
