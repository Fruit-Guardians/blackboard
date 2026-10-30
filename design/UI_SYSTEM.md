# Blackboard UI

Linear/Vercel-style minimal tool UI: the canvas is the product, chrome stays quiet.

## Layout

- **Top bar (48px at 1024px and above)**: sidebar toggle · brand / task title · view
  switch (现场 / 逻辑 / 全局) · Agent perspective · ⌘K · Agent activity · new node ·
  digest · theme. Narrow screens use two compact rows. The Agent menu appears only
  when there is more than one perspective; long names truncate in the trigger,
  with the full identity available in its tooltip and menu.
- **Sidebar (256px, collapsible; overlay below 1024px)**: outline of the board —
  current position, open items, findings, unconnected records — plus counts.
  Rows show recorded status, severity and confidence independently; footer counts wrap
  between labels without splitting a label.
- **Canvas**: full-bleed React Flow. One floating toolbar (bottom-left) holds
  fit / locate current / layout direction / minimap / zoom. At narrow widths the zoom
  controls wrap together onto another row, keeping every button visible.
- **Inspector**: floats over the canvas right edge (bottom sheet on phones), so
  selecting a node never resizes or re-lays-out the canvas.
- **⌘K command palette** (cmdk): jump to any node, switch view/theme, copy digest.
  Search no longer dims the canvas; it navigates.

## Components

shadcn-style primitives live in `web/src/components/ui/` (Button, Tooltip, Popover,
Dialog, Command, Slider, Kbd, Segmented/ToggleGroup) on Radix + cmdk. Official React
Flow UI sources (BaseNode, LabeledGroupNode) are vendored in
`web/src/components/react-flow/`. Panels are in `web/src/panels/`.
All colours come from CSS tokens in `web/src/styles.css`; Tailwind 4 is compiled
by `@tailwindcss/vite`.

## Reading the board

- Context and logic use the ELK layered layout. Title-only nodes are 88px tall;
  nodes with supporting text are 128px tall (width 288).
- Global view uses display-only frames for purpose, reasoning, findings and
  unconnected records. Empty groups are omitted. Parents are never persisted.
- Semantic zoom: below 65% only a large heading (cards and frame labels scale up);
  65–90% heading plus type/status; 90%+ adds supporting text.
- Selecting a node highlights only its explicitly recorded one-hop edges and
  neighbours. Other nodes/edges are muted; Escape clears the selection.
- Arrow keys move the selection along explicit one-hop edges, towards the
  neighbour most directly in that direction. `/` opens the palette, `[` toggles
  the sidebar.
- **Follow Agent** (toolbar; disabled in the global view): when the Agent's
  current node changes, the canvas re-centres on it.
- Every node kind has its own hue: a faint wash, a tinted edge, an accent bar and a
  coloured type label/icon (`--c` set from `--node-<type>`).
- Severity has its own labelled badge, independent of node type, status and confidence:
  critical red, high orange, medium amber, low blue, information neutral. Cards, sidebar
  and Inspector share the same badge; rated badges remain visible in the zoomed-out
  overview. Missing severity stays unassessed; unknown values keep their authored label
  and a neutral tone.
  Recorded ruled-out, refuted and superseded states also remain labelled when zoomed out.
- `?` lists the shortcuts. The selected node is mirrored in the address (`?node=id`),
  so a reload or a shared link reopens it; Inspector has a copy-link button.
- Sidebar filter (type · status · high risk) replaces the outline with a flat result list.
- The toolbar and ⌘K can export the whole board as a PNG (capped at 8000px per side).
  Export bounds include display-only parents; the image carries resolved SVG edge,
  arrowhead and label colours for the current theme without changing the live canvas.
- A connection lost for more than 1.5s shows a banner with the last sync time; the
  status dot is always visible. Empty boards show how to write the first node.
- Nodes the Agent just wrote or changed pulse for a few seconds (`fresh-pulse`).
- Relation kinds fall into six families with one colour each — 证实 / 反驳 / 推导 /
  产出 / 取代 / 关联 (`relationGroup` in `graph.ts`; `--rel-*` / `--edge-*` tokens).
  反驳 is dashed, 取代 dotted; a focused edge keeps its family colour at full strength.
  Links use a separate grey from the background grid. Strokes keep a constant screen
  width while zooming (1.5px, 1.75px for emphasized relations, 2px when focused).
- The legend (top-left, toolbar toggle, hidden on phones) lists only the node types
  and relation families present in the current view.
- Connections can be drawn as curves (default), rounded steps or straight lines
  (toolbar → 连线样式).
- Curves and steps follow the route ELK computed (`edge-route.ts`, `RoutedEdge.tsx`), so long
  edges go around the nodes between their ends instead of passing behind them. After a node is
  dragged its edges fall back to a plain curve/step; straight lines never avoid nodes.
- Direction, minimap, edge style and follow settings persist in localStorage (`use-pref.ts`).
- If ELK layout throws, `gridLayout` places nodes on a simple grid instead of
  leaving the canvas empty.

## Theme

Neutral zinc surfaces, near-black (light) / near-white (dark) as the only accent.
Colour carries meaning only: node-kind hues, green for the current position, and
separate severity badges. Light and dark themes each define legible severity colours.
Follows `prefers-color-scheme` until the user toggles. Reduced-motion disables zoom
animation and transitions.

## Verification

`npm test`, `npm run build`, and `./node_modules/.bin/tsc --noEmit`.
The canvas suite checks semantic zoom thresholds, real one-hop adjacency,
group membership, empty state, parent bounds and a 150-node non-overlap fixture.
