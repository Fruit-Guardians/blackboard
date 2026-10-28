// Development subprocesses must not inherit another project's blackboard selection.
export function isolatedBlackboardEnv(overrides = {}, source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith('BLACKBOARD_')) env[key] = value;
  }
  return { ...env, ...overrides };
}
