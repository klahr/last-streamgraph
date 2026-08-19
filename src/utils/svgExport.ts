// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Rasterize a live chart to a PNG, for the links that are too big to travel in
 * a URL and for the chat clients that would rather show an image than a link.
 *
 * The catch worth knowing about: the views colour their text with Tailwind
 * classes (`fill-slate-500 text-[10px]`), which live in a stylesheet the
 * serialized SVG can't reach. Export naively and every label turns black at the
 * browser's default size. So computed styles are flattened onto a clone first —
 * the clone is what gets serialized, the original on screen is untouched.
 */

/**
 * Presentation properties copied onto the clone. A whitelist rather than the
 * whole computed style: copying all ~340 properties makes the serialized SVG
 * enormous and drags in layout values that mean nothing outside the document.
 */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'mix-blend-mode',
] as const;

function inlineStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const from = [source, ...source.querySelectorAll<Element>('*')];
  const to = [clone, ...clone.querySelectorAll<Element>('*')];
  for (let i = 0; i < from.length && i < to.length; i++) {
    const computed = window.getComputedStyle(from[i]!);
    const target = to[i] as SVGElement;
    let css = '';
    for (const prop of STYLE_PROPS) {
      const value = computed.getPropertyValue(prop);
      if (value) css += `${prop}:${value};`;
    }
    target.setAttribute('style', css);
    // Classes are dead weight once the styles are inline, and they'd only
    // mislead anyone who opens the file.
    target.removeAttribute('class');
  }
}

export interface PngOptions {
  /** Painted behind the chart — a transparent PNG looks broken in light UIs. */
  background: string;
  /** Pixel density multiplier. 2 keeps text crisp on the usual displays. */
  scale?: number;
}

/**
 * Render one `<svg>` to a PNG blob. Rejects rather than guessing when the
 * element has no measurable size.
 */
export async function svgToPng(svg: SVGSVGElement, opts: PngOptions): Promise<Blob> {
  const rect = svg.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (!width || !height) throw new Error('Chart has no size to export.');

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not rasterize the chart.'));
      img.src = url;
    });

    const scale = opts.scale ?? 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser.');
    ctx.scale(scale, scale);
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The single `<svg>` inside a container, or null when there isn't exactly one.
 * Views built from many small charts (the forecast's card grid) have no one
 * image to export, and silently exporting the first card would be a lie.
 */
export function soleSvg(container: HTMLElement | null): SVGSVGElement | null {
  if (!container) return null;
  const found = container.querySelectorAll('svg');
  return found.length === 1 ? (found[0] as SVGSVGElement) : null;
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick — immediately would race the click in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
