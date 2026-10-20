# React Flow UI components

Local source copies of official React Flow UI registry components, restyled for
the Blackboard theme tokens (see `src/styles.css`). Upstream is MIT licensed.

- BaseNode: https://ui.reactflow.dev/base-node
- GroupNode / GroupNodeLabel: https://ui.reactflow.dev/labeled-group-node
- shadcn Button, Slider, Tooltip, Popover, Dialog, Command (cmdk):
  https://ui.shadcn.com/docs/components — vendored under `components/ui/`.

Adaptations: local import paths, theme-token colours, a quieter node chrome and
dashed display-only group frames. Applications compose them in `SecurityNode.tsx`,
`BoardGroup.tsx` and `CanvasToolbar.tsx`.
