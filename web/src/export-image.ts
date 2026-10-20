import { toPng } from 'html-to-image';
import { getNodesBounds, type Node } from '@xyflow/react';

const PAD = 48;
const MAX_SIDE = 8000;

/** Render the whole board (not just the viewport) to a PNG and hand it to the browser as a download. */
export async function exportCanvasPng(nodes: Node[], filename: string) {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport || !nodes.length) throw new Error('nothing to export');
  const bounds = getNodesBounds(nodes);
  const scale = Math.min(2, (MAX_SIDE - PAD * 2) / Math.max(bounds.width, bounds.height, 1));
  const width = Math.ceil(bounds.width * scale + PAD * 2);
  const height = Math.ceil(bounds.height * scale + PAD * 2);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  const url = await toPng(viewport, {
    width,
    height,
    backgroundColor: background,
    pixelRatio: 1,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PAD - bounds.x * scale}px, ${PAD - bounds.y * scale}px) scale(${scale})` },
  });
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
}
