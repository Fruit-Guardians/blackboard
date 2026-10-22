import { defineTool } from '@deepseek-ai/dsh-tools';
import { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill';
import { mount } from './plugin.js';

export const name = 'blackboard';
export const inject = ['tools', 'skills'];

export function apply(ctx, config = {}) {
  mount(ctx, config, { defineTool, bundledSkillRank: BUNDLED_SKILL_RANK });
}
