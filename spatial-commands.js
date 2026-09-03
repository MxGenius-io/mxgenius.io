/**
 * Renderer-independent spatial command dispatcher.
 *
 * Model and socket callers may request reversible presentation changes, but
 * the registry remains the authority for target identity, revision, and
 * expiry. Adapters own renderer-specific work and must call the supplied
 * `isCurrent` guard immediately before changing what the user sees.
 */
(function mountSpatialCommands(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MXSpatialCommands = api;
})(typeof window !== 'undefined' ? window : globalThis, (root) => {
  const COMMAND_LIFETIME_MS = 3_000;
  const SCAN_COMMAND_LIFETIME_MS = 12_000;
  const MAX_RESULTS = 128;
  const COMMAND_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
  const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
  const TARGET_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}:[A-Za-z0-9._:-]{1,240}$/;
  const ARGUMENT_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
  const TARGET_ACTIONS = new Set(['lock', 'highlight']);
  const ACTION_METHODS = Object.freeze({
    scan: 'scan',
    lock: 'lock',
    highlight: 'highlight',
    clear: 'clear',
    'set-thermal': 'setThermal'
  });
  const TOOL_ACTIONS = Object.freeze({
    'mxg.spatial.scan': 'scan',
    'mxg.spatial.lock': 'lock',
    'mxg.spatial.highlight': 'highlight',
    'mxg.spatial.clear': 'clear',
    'mxg.spatial.set_thermal': 'set-thermal'
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function clean(value, fallback = '', limit = 240) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return (text || fallback).slice(0, limit);
  }

  function integer(value) {
    return Number.isInteger(value) ? value : null;
  }

  function makeCommandId() {
    const uuid = root.crypto?.randomUUID?.();
    if (uuid) return uuid;
    return `spatial_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function validArgumentValue(value) {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 500;
    return Array.isArray(value) && value.length <= 16 && value.every((item) => (
      ['boolean', 'number', 'string'].includes(typeof item) &&
      (typeof item !== 'number' || Number.isFinite(item)) &&
      (typeof item !== 'string' || item.length <= 180)
    ));
  }

  function validArguments(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    return entries.length <= 12 && entries.every(([key, item]) => (
      ARGUMENT_NAME_PATTERN.test(key) && validArgumentValue(item)
    ));
  }

  function normalizeAdapterOutcome(value) {
    if (value === true || value == null) return { status: 'applied' };
    if (value === false) return { status: 'unavailable', reason: 'Renderer action is unavailable' };
    const rawStatus = value?.status;
    const status = ['applied', 'rejected', 'stale', 'unavailable'].includes(rawStatus)
      ? rawStatus
      : rawStatus === 'failed' ? 'unavailable' : 'applied';
    return {
      status,
      ...(status !== 'applied' ? { reason: clean(value?.reason, 'Renderer action was not applied') } : {})
    };
  }

  function commonProperties() {
    return {
      expectedRegistryRevision: {
        type: 'integer',
        minimum: 1,
        description: 'Registry revision from the supplied spatial target projection.'
      }
    };
  }

  function targetProperties() {
    return {
      ...commonProperties(),
      targetId: {
        type: 'string',
        pattern: TARGET_ID_PATTERN.source,
        description: 'Exact targetId from the supplied spatial target projection.'
      },
      expectedTargetRevision: {
        type: 'integer',
        minimum: 1,
        description: 'Target revision from the supplied spatial target projection.'
      }
    };
  }

  function tool(name, description, properties, required) {
    return {
      name,
      description,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties,
        required
      },
      meta: {
        callable: true,
        availability: 'available',
        client_handler: 'spatial_command',
        requires_human_approval: false
      }
    };
  }

  function clientTools() {
    return [
      tool(
        'mxg.spatial.scan',
        'Capture and analyze one scene frame. Use only when the user explicitly asks to scan the scene.',
        commonProperties(),
        ['expectedRegistryRevision']
      ),
      tool(
        'mxg.spatial.lock',
        'Lock the exact visible spatial target selected from the current target projection.',
        targetProperties(),
        ['expectedRegistryRevision', 'targetId', 'expectedTargetRevision']
      ),
      tool(
        'mxg.spatial.highlight',
        'Move the visible highlight to the exact target selected from the current target projection.',
        targetProperties(),
        ['expectedRegistryRevision', 'targetId', 'expectedTargetRevision']
      ),
      tool(
        'mxg.spatial.clear',
        'Clear the current spatial highlight or lock without deleting maintenance data.',
        commonProperties(),
        ['expectedRegistryRevision']
      ),
      tool(
        'mxg.spatial.set_thermal',
        'Show or hide the thermal overlay. This changes presentation only.',
        {
          ...commonProperties(),
          enabled: { type: 'boolean', description: 'True to show thermal; false to hide it.' }
        },
        ['expectedRegistryRevision', 'enabled']
      )
    ];
  }

  function validateToolArgs(action, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be an object';
    const allowed = TARGET_ACTIONS.has(action)
      ? ['expectedRegistryRevision', 'targetId', 'expectedTargetRevision']
      : action === 'set-thermal'
        ? ['expectedRegistryRevision', 'enabled']
        : ['expectedRegistryRevision'];
    if (Object.keys(args).some((key) => !allowed.includes(key))) return 'Tool arguments contain unsupported fields';
    return '';
  }

  class Dispatcher {
    constructor({ registry, adapter = {}, now = () => Date.now(), maxResults = MAX_RESULTS } = {}) {
      if (!registry?.snapshot || !registry?.get) throw new Error('MXSpatialCommands requires an MXTargetRegistry instance');
      this.registry = registry;
      this.adapter = adapter || {};
      this.now = typeof now === 'function' ? now : () => Date.now();
      this.maxResults = Math.min(512, Math.max(8, Math.trunc(Number(maxResults) || MAX_RESULTS)));
      this.results = new Map();
    }

    clientTools() {
      return clientTools();
    }

    remember(result) {
      this.results.set(result.commandId, clone(result));
      while (this.results.size > this.maxResults) this.results.delete(this.results.keys().next().value);
      return clone(result);
    }

    result(command, status, reason = '') {
      const snapshot = this.registry.snapshot();
      const target = command.targetId ? this.registry.get(command.targetId) : null;
      return this.remember({
        type: 'spatial.command.result',
        version: 1,
        commandId: command.commandId,
        sessionId: snapshot.sessionId,
        status,
        ...(status !== 'applied' ? { reason: clean(reason, 'Spatial command was not applied') } : {}),
        registryRevision: snapshot.registryRevision,
        ...(target?.targetRevision ? { targetRevision: target.targetRevision } : {}),
        observedAtMs: Math.max(0, Math.trunc(this.now()))
      });
    }

    validate(command) {
      const allowed = ['type', 'version', 'commandId', 'sessionId', 'action', 'targetId', 'arguments', 'expectedRegistryRevision', 'expectedTargetRevision', 'issuedAtMs', 'expiresAtMs'];
      if (!command || typeof command !== 'object' || Array.isArray(command)) return 'Command must be an object';
      if (Object.keys(command).some((field) => !allowed.includes(field))) return 'Command contains unsupported fields';
      if (command.type !== 'spatial.command' || command.version !== 1) return 'Unsupported spatial command version';
      if (!COMMAND_ID_PATTERN.test(command.commandId || '')) return 'Invalid command ID';
      if (!SESSION_ID_PATTERN.test(command.sessionId || '')) return 'Invalid session ID';
      if (!Object.hasOwn(ACTION_METHODS, command.action)) return 'Unsupported spatial action';
      if (!validArguments(command.arguments)) return 'Invalid command arguments';
      if ((integer(command.expectedRegistryRevision) || 0) < 1) return 'Invalid expected registry revision';
      if ((integer(command.issuedAtMs) ?? -1) < 0 || (integer(command.expiresAtMs) ?? -1) < 0) return 'Invalid command timing';
      if (command.expiresAtMs <= command.issuedAtMs) return 'Command expiry must follow issue time';
      if (TARGET_ACTIONS.has(command.action)) {
        if (!TARGET_ID_PATTERN.test(command.targetId || '')) return 'Target action requires a valid target ID';
        if ((integer(command.expectedTargetRevision) || 0) < 1) return 'Target action requires a valid target revision';
      } else if (command.targetId !== undefined || command.expectedTargetRevision !== undefined) {
        return 'Target fields are not allowed for this action';
      }
      if (command.action === 'set-thermal' && typeof command.arguments.enabled !== 'boolean') return 'Thermal command requires enabled';
      return '';
    }

    currentGuard(command) {
      const snapshot = this.registry.snapshot();
      if (snapshot.sessionId !== command.sessionId) return { current: false, reason: 'Spatial session changed' };
      if (Math.trunc(this.now()) > command.expiresAtMs) return { current: false, reason: 'Spatial command expired' };
      if (snapshot.registryRevision !== command.expectedRegistryRevision) return { current: false, reason: 'Spatial registry revision changed' };
      if (command.targetId) {
        const target = this.registry.get(command.targetId);
        if (!target || ['lost', 'cleared'].includes(target.state)) return { current: false, reason: 'Spatial target is no longer available' };
        if (target.targetRevision !== command.expectedTargetRevision) return { current: false, reason: 'Spatial target revision changed' };
      }
      return { current: true, reason: '' };
    }

    async dispatch(command) {
      const replay = command?.commandId && this.results.get(command.commandId);
      if (replay) return clone(replay);
      const validation = this.validate(command);
      if (validation) {
        const fallback = {
          commandId: COMMAND_ID_PATTERN.test(command?.commandId || '') ? command.commandId : makeCommandId(),
          targetId: TARGET_ID_PATTERN.test(command?.targetId || '') ? command.targetId : undefined
        };
        return this.result(fallback, 'rejected', validation);
      }
      const guard = this.currentGuard(command);
      if (!guard.current) return this.result(command, 'stale', guard.reason);
      const method = ACTION_METHODS[command.action];
      if (typeof this.adapter[method] !== 'function') return this.result(command, 'unavailable', 'Renderer does not support this action');
      try {
        const outcome = normalizeAdapterOutcome(await this.adapter[method]({
          command: clone(command),
          target: command.targetId ? this.registry.get(command.targetId) : null,
          snapshot: this.registry.snapshot({ expire: false }),
          isCurrent: () => this.currentGuard(command)
        }));
        return this.result(command, outcome.status, outcome.reason);
      } catch (error) {
        return this.result(command, 'unavailable', clean(error?.message, 'Renderer action failed'));
      }
    }

    dispatchTool(name, args = {}) {
      const action = TOOL_ACTIONS[name];
      if (!action) {
        return Promise.resolve(this.result({ commandId: makeCommandId() }, 'rejected', 'Unknown spatial client tool'));
      }
      const issuedAtMs = Math.max(0, Math.trunc(this.now()));
      const argumentError = validateToolArgs(action, args);
      if (argumentError) {
        return Promise.resolve(this.result({ commandId: makeCommandId() }, 'rejected', argumentError));
      }
      return this.dispatch({
        type: 'spatial.command',
        version: 1,
        commandId: makeCommandId(),
        sessionId: this.registry.snapshot().sessionId,
        action,
        ...(TARGET_ACTIONS.has(action) ? {
          targetId: args.targetId,
          expectedTargetRevision: args.expectedTargetRevision
        } : {}),
        arguments: action === 'set-thermal' ? { enabled: args.enabled } : {},
        expectedRegistryRevision: args.expectedRegistryRevision,
        issuedAtMs,
        expiresAtMs: issuedAtMs + (action === 'scan' ? SCAN_COMMAND_LIFETIME_MS : COMMAND_LIFETIME_MS)
      });
    }
  }

  function createEmbeddedViewerAdapter({ viewer, registry, scan = null, setThermal = null } = {}) {
    function selector(target) {
      const aliases = target?.aliases || {};
      const path = aliases.meshPath || null;
      const meshName = aliases.meshId || target?.anchor?.objectName || null;
      const modelId = aliases.modelId || null;
      return modelId || meshName || path ? { modelId, meshName, path } : null;
    }
    async function display({ target, isCurrent }, lock) {
      const selected = selector(target);
      if (!selected || !viewer?.highlightPart) return { status: 'unavailable', reason: 'Target has no embedded-viewer mapping' };
      const guard = isCurrent();
      if (!guard.current) return { status: 'stale', reason: guard.reason };
      if (lock && !registry?.lock?.(target.targetId, { reason: 'spatial-command-lock' })) {
        return { status: 'stale', reason: 'Spatial target is no longer available' };
      }
      viewer.highlightPart(selected);
      return { status: 'applied' };
    }
    return {
      scan: typeof scan === 'function' ? scan : () => ({ status: 'unavailable', reason: 'Scene scanning is available in the headset sensor workspace' }),
      highlight: (context) => display(context, false),
      lock: (context) => display(context, true),
      clear: ({ isCurrent }) => {
        const guard = isCurrent();
        if (!guard.current) return { status: 'stale', reason: guard.reason };
        registry?.clear?.({ reason: 'spatial-command-clear' });
        viewer?.clearSelection?.();
        return { status: 'applied' };
      },
      setThermal: typeof setThermal === 'function'
        ? ({ command, isCurrent }) => setThermal({ enabled: command.arguments.enabled, isCurrent })
        : () => ({ status: 'unavailable', reason: 'Thermal presentation is available in the sensor workspace' })
    };
  }

  function createWebXRAdapter({ scan, highlight, lock, clear, setThermal } = {}) {
    return { scan, highlight, lock, clear, setThermal };
  }

  return Object.freeze({
    COMMAND_LIFETIME_MS,
    SCAN_COMMAND_LIFETIME_MS,
    TOOL_ACTIONS,
    Dispatcher,
    clientTools,
    createDispatcher: (options) => new Dispatcher(options),
    createEmbeddedViewerAdapter,
    createWebXRAdapter
  });
});
