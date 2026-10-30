import { getFontEmbedCSS, toPng } from 'html-to-image';
import type { Rect } from '@xyflow/react';

const PAD = 48;
const MAX_SIDE = 8000;

/** SVG children are deep-cloned by html-to-image without their computed styles. */
function svgPaintRules(viewport: HTMLElement) {
  const rule = (selector: string, element: Element | null, properties: string[]) => {
    if (!element) return '';
    const style = getComputedStyle(element);
    return `${selector}{${properties.map((name) => `${name}:${style.getPropertyValue(name)}!important`).join(';')}}`;
  };
  const edges = [...viewport.querySelectorAll<SVGElement>('.react-flow__edge')].map((edge) => {
    const scope = `.react-flow__edge[data-id="${CSS.escape(edge.dataset.id || '')}"]`;
    return rule(`${scope} .react-flow__edge-path`, edge.querySelector('.react-flow__edge-path'), ['stroke', 'stroke-opacity'])
      + rule(`${scope} .react-flow__edge-text`, edge.querySelector('.react-flow__edge-text'), ['fill', 'font-size', 'font-weight', 'opacity'])
      + rule(`${scope} .react-flow__edge-textbg`, edge.querySelector('.react-flow__edge-textbg'), ['fill', 'opacity']);
  });
  const markers = [...viewport.querySelectorAll('marker')].map((marker) =>
    rule(`[id="${CSS.escape(marker.id)}"] polyline`, marker.querySelector('polyline'), ['stroke', 'fill']));
  return edges.join('') + markers.join('');
}

/** Render the whole board (not just the viewport) to a PNG and hand it to the browser as a download. */
export async function exportCanvasPng(bounds: Rect, filename: string) {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || !bounds.width || !bounds.height) throw new Error('nothing to export');
  const scale = Math.min(2, (MAX_SIDE - PAD * 2) / Math.max(bounds.width, bounds.height, 1));
  const width = Math.ceil(bounds.width * scale + PAD * 2);
  const height = Math.ceil(bounds.height * scale + PAD * 2);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  const url = await toPng(viewport, {
    width,
    height,
    backgroundColor: background,
    // This public option embeds a stylesheet in the copy, leaving the live SVG untouched.
    fontEmbedCSS: (await getFontEmbedCSS(viewport)) + svgPaintRules(viewport),
    pixelRatio: 1,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PAD - bounds.x * scale}px, ${PAD - bounds.y * scale}px) scale(${scale})` },
  });
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
}
