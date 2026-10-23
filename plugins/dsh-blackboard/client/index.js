/* Authored DSH lazy-CJS browser entry: no build, network requests or module-body side effects. */
window.__ModuleLoader__.load({ id: 'dsh-blackboard', factory(require) {
  const React = require('react');
  const h = React.createElement;
  const NS = 'blackboard';
  const actions = ['status', 'context', 'node_get', 'node_add', 'node_patch', 'link', 'cursor', 'checkpoint', 'diagnose'];
  const dictionaries = {
    zh: { status: '黑板状态', context: '恢复研究现场', node_get: '查看节点', node_add: '记录判断', node_patch: '更新节点', link: '关联证据', cursor: '切换关注位置', checkpoint: '保存交接', diagnose: '接入诊断',
      settings: '项目与运行时配置', summary: '显式选择接入项目；保存不会初始化黑板。', project: '项目工作区', board: '黑板根目录（可选）', add: '添加项目', remove: '移除项目', runtime: 'blackboard CLI（留空使用 current）', node: 'Node（留空使用宿主运行时）', timeout: '超时（毫秒）', output: '输出上限（字节）', save: '保存配置', reload: '重新读取配置', saved: '配置已保存，新调用即时生效。', conflict: '保存未被接受；草稿已保留，请重新读取配置后重试。', readonly: '当前配置不可编辑。', loading: '正在加载配置…', guide: '在项目会话中输入“检查 blackboard 接入状态”可运行只读诊断；不会创建黑板或修改权限。', rowHint: '点击下方组件的配置按钮，添加项目或调整 CLI。', running: '执行中', preparing: '准备中', done: '完成', failed: '执行失败', detail: '查看原始调用与结果', inspect: '查看轨迹', read: '可读取', write: '可写入', yes: '是', no: '否', failureDetail: '操作未成功，原始结果如下。', unknown: '缺少可识别的卡片信息，原始记录如下。' },
    en: { status: 'Board status', context: 'Restore context', node_get: 'Read node', node_add: 'Record judgment', node_patch: 'Update node', link: 'Link evidence', cursor: 'Change focus', checkpoint: 'Save handoff', diagnose: 'Setup diagnosis',
      settings: 'Projects and runtime', summary: 'Enable projects explicitly; saving never initializes a board.', project: 'Workspace', board: 'Board root (optional)', add: 'Add project', remove: 'Remove project', runtime: 'blackboard CLI (blank uses current)', node: 'Node (blank uses host runtime)', timeout: 'Timeout (ms)', output: 'Output limit (bytes)', save: 'Save configuration', reload: 'Reload configuration', saved: 'Saved. New calls use this configuration immediately.', conflict: 'Save was not accepted. Draft retained; reload before retrying.', readonly: 'Configuration is not editable.', loading: 'Loading configuration…', guide: 'Ask “check blackboard setup” in a project session for a read-only diagnosis. It never initializes a board or changes permissions.', rowHint: 'Use the component configuration button below to add projects or change the CLI.', running: 'Running', preparing: 'Preparing', done: 'Completed', failed: 'Failed', detail: 'Raw call and result', inspect: 'Inspect trace', read: 'Readable', write: 'Writable', yes: 'Yes', no: 'No', failureDetail: 'Operation failed; original result follows.', unknown: 'No recognized card metadata; original record follows.' },
  };
  const box = { border: '1px solid #8885', borderRadius: 10, padding: 16, margin: '12px 0' };
  const fieldStyle = { display: 'block', boxSizing: 'border-box', width: '100%', padding: '8px 10px', margin: '6px 0 12px', border: '1px solid #8888', borderRadius: 6, background: 'transparent', color: 'inherit', font: 'inherit' };
  const buttonStyle = { padding: '7px 12px', marginRight: 8, borderRadius: 6, border: '1px solid #8888', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' };
  const initial = value => ({ projects: (value?.projects ?? []).map(row => ({ workspace: row.workspace, boardRoot: row.boardRoot ?? '' })), runtimeCli: value?.runtimeCli ?? '', nodeExecutable: value?.nodeExecutable ?? '', timeoutMs: value?.timeoutMs ?? 10000, maxOutputBytes: value?.maxOutputBytes ?? 1048576 });
  const wire = draft => ({ ...draft, projects: draft.projects.map(row => ({ workspace: row.workspace, ...(row.boardRoot ? { boardRoot: row.boardRoot } : {}) })) });
  function edits(draft, base) {
    const next = wire(draft), previous = wire(base);
    return Object.keys(next).filter(key => JSON.stringify(next[key]) !== JSON.stringify(previous[key])).map(key =>
      ['runtimeCli', 'nodeExecutable'].includes(key) && next[key] === '' ? { op: 'unset', path: [key] } : { op: 'set', path: [key], value: next[key] });
  }
  function Editor({ form, t }) {
    const state = form?.state;
    const [draft, setDraft] = React.useState(() => initial(state?.value));
    const [base, setBase] = React.useState(() => initial(state?.value));
    const [revision, setRevision] = React.useState(state?.revision);
    const [dirty, setDirty] = React.useState(false), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState('');
    const reset = () => { const next = initial(state?.value); setDraft(next); setBase(next); setRevision(state?.revision); setDirty(false); setNotice(''); };
    React.useEffect(() => {
      if (!dirty && state?.revision !== revision) {
        const next = initial(state?.value); setDraft(next); setBase(next); setRevision(state?.revision);
      }
    }, [state?.revision, state?.status, dirty, revision]);
    const change = (key, value) => { setDraft(old => ({ ...old, [key]: value })); setDirty(true); setNotice(''); };
    const field = (key, label, options = {}) => h('label', { key }, label, h('input', { style: fieldStyle, value: draft[key], ...options, onChange: event => change(key, options.type === 'number' ? Number(event.target.value) : event.target.value) }));
    const ready = state?.status === 'ready' && state.writable && typeof revision === 'number';
    async function save(event) {
      event.preventDefault(); if (!ready || busy) return;
      setBusy(true); setNotice('');
      try {
        const accepted = await form.mutate(edits(draft, base), revision);
        if (accepted) { setDirty(false); setBase(draft); setNotice(t('saved')); }
        else setNotice(t('conflict'));
      } catch (error) { setNotice(`${t('conflict')} ${String(error.message ?? error)}`); }
      finally { setBusy(false); }
    }
    return h('form', { onSubmit: save, 'data-blackboard-settings': true, style: box },
      h('h3', null, t('settings')), h('p', null, t('summary')),
      h('fieldset', { disabled: !ready || busy, style: { border: 0, padding: 0, minWidth: 0 } },
        ...draft.projects.map((row, index) => h('section', { key: index, style: box },
          ...['workspace', 'boardRoot'].map(key => h('label', { key }, t(key === 'workspace' ? 'project' : 'board'), h('input', { required: key === 'workspace', style: fieldStyle, value: row[key], placeholder: '/absolute/path/to/project', onChange: event => change('projects', draft.projects.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item)) }))),
          h('button', { type: 'button', style: buttonStyle, onClick: () => change('projects', draft.projects.filter((_, i) => i !== index)) }, t('remove')))),
        h('button', { type: 'button', style: buttonStyle, onClick: () => change('projects', [...draft.projects, { workspace: '', boardRoot: '' }]) }, t('add')),
        h('div', { style: { marginTop: 16 } }, field('runtimeCli', t('runtime')), field('nodeExecutable', t('node')),
          field('timeoutMs', t('timeout'), { type: 'number', required: true, min: 50, max: 120000, step: 1 }),
          field('maxOutputBytes', t('output'), { type: 'number', required: true, min: 1024, max: 16777216, step: 1 })),
        h('button', { type: 'submit', style: buttonStyle, disabled: !dirty }, t('save'))),
      h('button', { type: 'button', style: buttonStyle, disabled: busy || state?.status !== 'ready', onClick: reset }, t('reload')),
      h('p', { role: 'status' }, notice || (!state || state.status === 'loading' ? t('loading') : !ready ? t('readonly') : '')),
      h('p', { style: { opacity: .7 } }, t('guide')));
  }
  const bounded = value => typeof value === 'string' ? value.slice(0, 1000) : '';
  function cardMeta(block, name) {
    const value = block?.meta?.blackboard;
    if (!value || value.schema !== 'blackboard.card.v1' || value.action !== name) return null;
    if (!['summary', 'boardRoot', 'agentId', 'nodeId', 'diagnostics'].every(key => typeof value[key] === 'string')) return null;
    if (name === 'blackboard_diagnose' && (typeof value.readyToRead !== 'boolean' || typeof value.readyToWrite !== 'boolean' || !Array.isArray(value.checks) || value.checks.length > 8 || value.checks.some(check => !check || !['id', 'status', 'code', 'message', 'remedy'].every(key => typeof check[key] === 'string')))) return null;
    return value;
  }
  function ToolCard({ toolName, phase, block, t, inspect }) {
    const action = toolName.replace(/^blackboard_/, '');
    const meta = phase === 'result' && block?.isError === false ? cardMeta(block, toolName) : null;
    const failed = phase === 'result' && block?.isError === true;
    const state = phase === 'preparing' ? 'preparing' : phase === 'result' ? (failed ? 'failed' : 'done') : 'running';
    const raw = (() => { try { return JSON.stringify({ call: block?.call, args: block?.argsRaw, content: block?.content, error: block?.error, meta: block?.meta }, null, 2); } catch { return 'Invalid recorded result'; } })();
    return h('article', { 'data-blackboard-tool': toolName, style: { ...box, borderLeft: `3px solid ${failed ? '#db5050' : '#66E0AE'}` } },
      h('header', null, h('strong', null, t(action)), ' · ', t(state)),
      meta ? h(React.Fragment, null,
        meta.summary ? h('p', null, bounded(meta.summary)) : null,
        h('small', { style: { display: 'block', opacity: .7 } }, [meta.nodeId, meta.agentId, meta.boardRoot].filter(Boolean).map(bounded).join(' · ')),
        action === 'diagnose' ? h(React.Fragment, null,
          h('p', null, `${t('read')}: ${t(meta.readyToRead ? 'yes' : 'no')} · ${t('write')}: ${t(meta.readyToWrite ? 'yes' : 'no')}`),
          h('ul', null, ...meta.checks.map((check, i) => h('li', { key: i }, `${check.status === 'ok' ? '✓' : '•'} ${bounded(check.code)} — ${bounded(check.message)}`, check.remedy ? h('p', null, bounded(check.remedy)) : null)))) : null,
        meta.diagnostics ? h('p', null, bounded(meta.diagnostics)) : null) : phase === 'result' ? h('p', null, t(failed ? 'failureDetail' : 'unknown')) : null,
      h('details', { open: failed || (phase === 'result' && !meta) }, h('summary', null, t('detail')), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 360, overflow: 'auto', fontSize: 12 } }, raw)),
      typeof inspect === 'function' ? h('button', { type: 'button', style: buttonStyle, onClick: inspect }, t('inspect')) : null);
  }
  return {
    name: 'blackboard-client', inject: ['slots', 'locale'],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries));
      ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: 'dsh-blackboard#blackboard', locale: NS }, props => props.view === 'summary' ? props.t('summary') : h(Editor, props)));
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-blackboard', locale: NS }, ({ t }) => h('p', null, t('rowHint'))));
      for (const action of actions) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: `blackboard_${action}`, locale: NS }, ToolCard));
    },
    // Pure seams used by package tests; no browser or Host state is accessed.
    test: { initial, edits, cardMeta, ToolCard, Editor },
  };
} });
