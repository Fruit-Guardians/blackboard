import { snapshotConfig } from './config.js';
import { CliBridge } from './bridge.js';
import { toolSpecifications } from './tools.js';
import { skillProvider } from './skills.js';
import { writeAuthorizer } from './policy.js';

/** Keep SDK registration at the edge; core blackboard remains an independent executable. */
export function mount(ctx, input, { defineTool, bundledSkillRank }) {
  snapshotConfig(input);
  const config = () => snapshotConfig(input);
  const bridge = new CliBridge(config);
  ctx.effect(() => () => bridge.dispose());
  for (const spec of toolSpecifications(config, bridge, writeAuthorizer(ctx))) ctx.tools.register(defineTool(spec));
  ctx.skills.registerProvider(() => skillProvider(bridge, bundledSkillRank));
}
