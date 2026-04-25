// Shared primitives + realistic mock data for the runtime-rule admin.
// Everything is global-scoped so other scripts can reach it.

const RR_FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const RR_FONT_UI = "Inter, -apple-system, 'Segoe UI', system-ui, sans-serif";

// Dark theme (default)
const rrDark = {
  bg: '#15130f',
  bg2: '#1b1814',
  bg3: '#221e19',
  panel: '#1e1b16',
  border: '#2b2721',
  border2: '#393329',
  dim: '#6b6359',
  ink: '#d9d2c5',
  ink2: '#a8a094',
  heading: '#efeadb',
  accent: 'oklch(0.82 0.14 75)',  // amber
  accentDim: 'oklch(0.62 0.11 75)',
  active: '#f3b35a',
  ok: '#7fbf7a',
  warn: '#e5a84a',
  err: '#e87166',
  info: '#6ba3d6',
  violet: '#a990e6',
};

const rrLight = {
  bg: '#f6f3ec',
  bg2: '#ecead9',
  bg3: '#e4e1d0',
  panel: '#ffffff',
  border: '#d6d1c2',
  border2: '#c2bca9',
  dim: '#8a8475',
  ink: '#2a2721',
  ink2: '#5a5548',
  heading: '#141210',
  accent: 'oklch(0.58 0.14 60)',
  accentDim: 'oklch(0.70 0.11 60)',
  active: '#b8772a',
  ok: '#3e8a48',
  warn: '#b37a15',
  err: '#c14a3e',
  info: '#2e6da6',
  violet: '#6b4bbf',
};

// ── Realistic mock data ────────────────────────────────────────────

const CATALOGS = [
  { id: 'otel-rules', label: 'MAL · OTEL', count: 27, hint: 'OTLP metrics → MAL' },
  { id: 'log-mal-rules', label: 'MAL · Log', count: 8, hint: 'Log-derived metrics' },
  { id: 'lal', label: 'LAL', count: 14, hint: 'Log analysis rules' },
  { id: 'oal', label: 'OAL', count: 12, hint: 'Trace / mesh analysis' },
];

const RULES = [
  { catalog: 'otel-rules', name: 'vm', status: 'ACTIVE', localState: 'RUNNING', hash: '7c3a91…', updated: '2m ago', author: 'ops@tetrate', metrics: 18, origin: 'runtime', err: null },
  { catalog: 'otel-rules', name: 'nginx', status: 'ACTIVE', localState: 'RUNNING', hash: 'b1d402…', updated: '14m ago', author: 'han.l', metrics: 9, origin: 'runtime', err: null },
  { catalog: 'otel-rules', name: 'k8s/node', status: 'ACTIVE', localState: 'SUSPENDED', hash: '4fe810…', updated: '31s ago', author: 'han.l', metrics: 22, origin: 'runtime', err: null, suspending: true },
  { catalog: 'otel-rules', name: 'k8s/pod', status: 'ACTIVE', localState: 'RUNNING', hash: 'a02cff…', updated: '2h ago', author: 'static', metrics: 15, origin: 'static', err: null },
  { catalog: 'otel-rules', name: 'aws-gateway/gateway-service', status: 'ACTIVE', localState: 'RUNNING', hash: '88a30c…', updated: '4h ago', author: 'ops@tetrate', metrics: 6, origin: 'runtime', err: null },
  { catalog: 'otel-rules', name: 'mysql', status: 'INACTIVE', localState: 'NOT_LOADED', hash: '—', updated: 'yesterday', author: 'han.l', metrics: 0, origin: 'runtime', err: null },
  { catalog: 'otel-rules', name: 'redis', status: 'ACTIVE', localState: 'RUNNING', hash: 'e1f72b…', updated: '3d ago', author: 'static', metrics: 11, origin: 'static', err: null },
  { catalog: 'otel-rules', name: 'kafka', status: 'ACTIVE', localState: 'RUNNING', hash: '55aa01…', updated: '5d ago', author: 'static', metrics: 24, origin: 'static', err: 'ddl_verify_failed on node-03 · 21s ago' },
  { catalog: 'log-mal-rules', name: 'access-log', status: 'ACTIVE', localState: 'RUNNING', hash: '2d8e44…', updated: '1h ago', author: 'han.l', metrics: 4, origin: 'runtime', err: null },
  { catalog: 'log-mal-rules', name: 'app-errors', status: 'ACTIVE', localState: 'RUNNING', hash: '9b12a0…', updated: '18h ago', author: 'static', metrics: 3, origin: 'static', err: null },
  { catalog: 'lal', name: 'envoy-access', status: 'ACTIVE', localState: 'RUNNING', hash: 'fa0023…', updated: '2d ago', author: 'ops@tetrate', metrics: 7, origin: 'runtime', err: null },
  { catalog: 'lal', name: 'k8s-audit', status: 'ACTIVE', localState: 'RUNNING', hash: 'c7d19e…', updated: '6d ago', author: 'static', metrics: 5, origin: 'static', err: null },
  { catalog: 'lal', name: 'tomcat', status: 'INACTIVE', localState: 'NOT_LOADED', hash: '—', updated: '10d ago', author: 'ops@tetrate', metrics: 0, origin: 'runtime', err: null },
];

// Sample "captured workflow" response from OAP for the debugger.
// Note: steps come from backend, each rule can have different steps.
const SAMPLE_DEBUG_CAPTURE = {
  catalog: 'otel-rules',
  name: 'vm',
  ruleName: 'vm_memory_available_percent',
  capturedAt: '2026-04-23T14:02:19.334Z',
  window: 'last 30 samples in past 2m',
  samplesSeen: 30,
  samplesShown: 4,
  pushNodes: ['vm-prod-a7', 'vm-prod-b1', 'vm-prod-c4'],
  families: {
    input: { name: 'node_memory_MemAvailable_bytes', kind: 'gauge', series: 5, points: 30 },
    afterFilter: { name: 'node_memory_MemAvailable_bytes', kind: 'gauge', series: 3, points: 20 },
    afterClosure: { name: 'mem_available_percent', kind: 'gauge', series: 3, points: 20 },
  },
  steps: [
    {
      id: 'input',
      kind: 'input',
      label: 'Input SampleFamily',
      detail: 'raw OTLP gauge · node_memory_MemAvailable_bytes',
      inCount: 30, outCount: 30,
      samples: [
        { labels: { host: 'vm-prod-a7', region: 'us-east-1' }, value: 8_414_208_000, ts: 1745329339334 },
        { labels: { host: 'vm-prod-a7', region: 'us-east-1' }, value: 8_412_172_288, ts: 1745329309334 },
        { labels: { host: 'vm-prod-b1', region: 'us-east-1' }, value: 6_221_004_800, ts: 1745329339112 },
        { labels: { host: 'vm-prod-c4', region: 'us-west-2' }, value: 11_004_928_000, ts: 1745329339012 },
      ],
    },
    {
      id: 'filter0',
      kind: 'filter',
      label: 'filter( tagEqual("region", "us-east-1") )',
      detail: 'predicate on SampleFamily',
      inCount: 30, outCount: 20,
      dropped: 10,
      samples: [
        { labels: { host: 'vm-prod-a7', region: 'us-east-1' }, value: 8_414_208_000, kept: true },
        { labels: { host: 'vm-prod-b1', region: 'us-east-1' }, value: 6_221_004_800, kept: true },
        { labels: { host: 'vm-prod-c4', region: 'us-west-2' }, value: 11_004_928_000, kept: false, reason: 'region ≠ us-east-1' },
      ],
    },
    {
      id: 'closure0',
      kind: 'closure',
      label: '* 100 / node_memory_MemTotal_bytes',
      detail: 'binary op · two SampleFamilies aligned by labels',
      inCount: 20, outCount: 20,
      samples: [
        { labels: { host: 'vm-prod-a7', region: 'us-east-1' }, lhs: 8_414_208_000, rhs: 16_793_681_920, value: 50.10 },
        { labels: { host: 'vm-prod-b1', region: 'us-east-1' }, lhs: 6_221_004_800, rhs: 16_793_681_920, value: 37.04 },
      ],
    },
    {
      id: 'scope',
      kind: 'scope',
      label: 'instance(["host"])',
      detail: 'scope binding · InstanceID derived from host',
      inCount: 20, outCount: 20,
      samples: [
        { scope: 'instance', instance: 'vm-prod-a7', entityId: 'dm9tLXByb2QtYTc=.1', value: 50.10 },
        { scope: 'instance', instance: 'vm-prod-b1', entityId: 'dm9tLXByb2QtYjE=.1', value: 37.04 },
      ],
    },
    {
      id: 'tag',
      kind: 'tag',
      label: '.tag("layer", "VM")',
      detail: 'append tag to every sample',
      inCount: 20, outCount: 20,
      samples: [
        { instance: 'vm-prod-a7', tags: { layer: 'VM' }, value: 50.10 },
        { instance: 'vm-prod-b1', tags: { layer: 'VM' }, value: 37.04 },
      ],
    },
    {
      id: 'downsample',
      kind: 'downsampling',
      label: '.downsampling(AVG)',
      detail: 'persistent aggregation over window',
      inCount: 20, outCount: 3,
      samples: [
        { instance: 'vm-prod-a7', window: 'minute=1445', avg: 50.14, n: 7 },
        { instance: 'vm-prod-b1', window: 'minute=1445', avg: 37.08, n: 7 },
        { instance: 'vm-prod-c4', window: 'minute=1445', avg: 67.22, n: 6 },
      ],
    },
    {
      id: 'store',
      kind: 'store',
      label: 'persist → storage',
      detail: 'measure: vm_memory_available_percent · BanyanDB',
      inCount: 3, outCount: 3,
      samples: [
        { measure: 'vm_memory_available_percent', entity: 'vm-prod-a7', ts: 1745329320000, value: 50.14, tags: { layer: 'VM' } },
        { measure: 'vm_memory_available_percent', entity: 'vm-prod-b1', ts: 1745329320000, value: 37.08, tags: { layer: 'VM' } },
        { measure: 'vm_memory_available_percent', entity: 'vm-prod-c4', ts: 1745329320000, value: 67.22, tags: { layer: 'VM' } },
      ],
    },
  ],
};

const CLUSTER_NODES = [
  { id: 'oap-01', role: 'MAIN', ip: '10.0.4.11', up: '2d 4h', lastTick: '12s', state: 'HEALTHY' },
  { id: 'oap-02', role: 'peer', ip: '10.0.4.12', up: '2d 4h', lastTick: '18s', state: 'HEALTHY' },
  { id: 'oap-03', role: 'peer', ip: '10.0.4.13', up: '2d 4h', lastTick: '21s', state: 'DRIFT', drift: 1 },
  { id: 'oap-04', role: 'peer', ip: '10.0.4.14', up: '13h', lastTick: '9s', state: 'HEALTHY' },
];

const HISTORY = [
  { id: 'v12', time: '2m ago', by: 'ops@tetrate', hash: '7c3a91…', kind: 'filter_only_applied', msg: 'tighten region filter to us-east-1' },
  { id: 'v11', time: '14m ago', by: 'han.l', hash: 'b1d402…', kind: 'structural_applied', msg: 'add memory_used_percent metric' },
  { id: 'v10', time: '2h ago', by: 'han.l', hash: 'a02cff…', kind: 'structural_applied', msg: 'switch scope instance→service' },
  { id: 'v9', time: '6h ago', by: 'ops@tetrate', hash: '88a30c…', kind: 'filter_only_applied', msg: 'relax cpu threshold' },
  { id: 'v8', time: 'yesterday', by: 'bootstrap', hash: 'e1f72b…', kind: 'boot_substitute', msg: 'substituted from runtime entry at boot' },
  { id: 'v7', time: '3d ago', by: 'han.l', hash: '2d8e44…', kind: 'structural_applied', msg: 'initial ACTIVE push' },
];

// Sample YAML content — realistic MAL rule
const SAMPLE_YAML_MAL = `# otel-rules/vm.yaml · OTLP MAL rule
# identity: (catalog=otel-rules, name=vm)

filter: "{ tags -> tags.job == 'node-exporter' }"

expSuffix: instance(['host'], Layer.VM)
metricPrefix: vm
metricsRules:
  - name: memory_available_percent
    exp: node_memory_MemAvailable_bytes.tagEqual('region', 'us-east-1')
         * 100 / node_memory_MemTotal_bytes
    downsampling: AVG

  - name: cpu_used_percent
    exp: (1 - avg(rate(node_cpu_seconds_total{mode='idle'}[1m])))
         * 100
    downsampling: AVG

  - name: disk_total_bytes
    exp: node_filesystem_size_bytes
         .tagEqual('mountpoint', '/')
         .sum(['host'])
    downsampling: LATEST
`;

// Tiny reusable primitives ─────────────────────────────────────────

function Pill({ tone = 'dim', children, style }) {
  const tones = {
    ok: { bg: 'rgba(127,191,122,0.15)', fg: '#92d28b', bd: 'rgba(127,191,122,0.35)' },
    warn: { bg: 'rgba(229,168,74,0.15)', fg: '#eebf6a', bd: 'rgba(229,168,74,0.35)' },
    err: { bg: 'rgba(232,113,102,0.15)', fg: '#ee8d84', bd: 'rgba(232,113,102,0.35)' },
    info: { bg: 'rgba(107,163,214,0.15)', fg: '#8bbae1', bd: 'rgba(107,163,214,0.35)' },
    dim: { bg: 'rgba(216,210,198,0.06)', fg: '#a8a094', bd: 'rgba(216,210,198,0.14)' },
    accent: { bg: 'rgba(243,179,90,0.15)', fg: '#f3b35a', bd: 'rgba(243,179,90,0.40)' },
    violet: { bg: 'rgba(169,144,230,0.15)', fg: '#b9a5ee', bd: 'rgba(169,144,230,0.35)' },
  };
  const t = tones[tone] || tones.dim;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontFamily: RR_FONT_MONO, fontSize: 10.5, fontWeight: 500,
      padding: '2px 7px', borderRadius: 3, letterSpacing: 0.2,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      lineHeight: 1.4, whiteSpace: 'nowrap', ...style,
    }}>{children}</span>
  );
}

function Dot({ tone = 'ok', size = 6, style }) {
  const colors = { ok: '#7fbf7a', warn: '#e5a84a', err: '#e87166', info: '#6ba3d6', dim: '#6b6359' };
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: colors[tone], flexShrink: 0, ...style }} />;
}

// Chrome wrapper for every artboard — gives a window frame, status bar.
function AppFrame({ theme = rrDark, route = '/', subtitle, children, width = 1200, height = 780, accent }) {
  return (
    <div style={{
      width, height, background: theme.bg, color: theme.ink,
      fontFamily: RR_FONT_UI, fontSize: 13, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', borderRadius: 6, position: 'relative',
    }}>
      {/* Top title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px',
        background: theme.bg2, borderBottom: `1px solid ${theme.border}`, height: 36, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#444039' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#444039' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#444039' }} />
        </div>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim, letterSpacing: 0.3 }}>
          skywalking · runtime rules
        </span>
        <span style={{ color: theme.dim, fontSize: 11 }}>/</span>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink2 }}>{route}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Dot tone="ok" size={5} /> oap-01 · main
        </span>
        <span style={{ color: theme.dim }}>·</span>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>4 nodes</span>
      </div>
      {subtitle && (
        <div style={{
          padding: '6px 14px', borderBottom: `1px solid ${theme.border}`,
          fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO, background: theme.bg,
        }}>{subtitle}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

// Minimal sidebar — top-level sections + catalog sublist.
function CatalogNav({ theme = rrDark, active = 'otel-rules', compact = false }) {
  const catalogIds = new Set(CATALOGS.map(c => c.id));
  const sections = [
    { id: 'catalogs',   label: 'Catalogs',           icon: '▤' },
    { id: 'cluster',    label: 'Cluster status',     icon: '⎈' },
    { id: 'history',    label: 'History · diff · rollback', icon: '⎙' },
    { id: 'dump',       label: 'Dump & restore',     icon: '⇅' },
    { id: 'dsl',        label: 'DSL Management',     icon: '⚙' },
  ];
  const catalogsActive = active === 'catalogs' || catalogIds.has(active);

  return (
    <div style={{
      width: compact ? 56 : 230, flexShrink: 0, borderRight: `1px solid ${theme.border}`,
      background: theme.bg, display: 'flex', flexDirection: 'column', padding: '14px 0', overflow: 'auto',
    }}>
      {sections.map(s => {
        const isActive = s.id === 'catalogs' ? catalogsActive : active === s.id;
        return (
          <React.Fragment key={s.id}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: compact ? '10px 0' : '9px 14px',
              justifyContent: compact ? 'center' : 'flex-start',
              background: isActive ? theme.bg3 : 'transparent',
              borderLeft: isActive ? `2px solid ${theme.active}` : '2px solid transparent',
              cursor: 'pointer',
            }}>
              <span style={{
                fontFamily: RR_FONT_MONO, fontSize: 11, width: 22, height: 22, borderRadius: 3,
                background: isActive ? theme.active : theme.bg3,
                color: isActive ? theme.bg : theme.ink2,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600,
              }}>{s.icon}</span>
              {!compact && (
                <div style={{ fontSize: 12.5, color: isActive ? theme.heading : theme.ink, fontWeight: isActive ? 500 : 400 }}>
                  {s.label}
                </div>
              )}
            </div>

            {/* Catalog sublist (nested under Catalogs) */}
            {s.id === 'catalogs' && catalogsActive && !compact && (
              <div style={{ padding: '2px 0 6px' }}>
                {CATALOGS.map(c => (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 14px 6px 36px',
                    background: active === c.id ? theme.bg2 : 'transparent',
                    cursor: 'pointer', opacity: c.soon ? 0.45 : 1,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: active === c.id ? theme.active : theme.border2,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11.5, color: active === c.id ? theme.heading : theme.ink2, fontFamily: RR_FONT_MONO }}>
                        {c.label}
                      </div>
                    </div>
                    <span style={{ fontSize: 10, color: theme.dim, fontFamily: RR_FONT_MONO }}>
                      {c.soon ? 'soon' : c.count}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* DSL Management sublist */}
            {s.id === 'dsl' && active === 'dsl' && !compact && (
              <div style={{ padding: '2px 0 6px' }}>
                {[
                  { id: 'dsl-validate', label: 'Validate' },
                  { id: 'dsl-assistant', label: 'DSL assistant' },
                  { id: 'dsl-destructive', label: 'Destructive confirm' },
                ].map(x => (
                  <div key={x.id} style={{
                    padding: '6px 14px 6px 36px',
                    fontSize: 11.5, fontFamily: RR_FONT_MONO,
                    color: theme.ink2,
                  }}>
                    <span style={{ color: theme.dim, marginRight: 8 }}>›</span>{x.label}
                  </div>
                ))}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Tiny syntax-highlighter for YAML (good-enough, not perfect).
function YamlView({ code, theme = rrDark, fontSize = 12, withLineNo = true, highlightLines = {}, width, maxHeight }) {
  const lines = code.split('\n');
  const col = {
    comment: theme.dim,
    key: '#9ec5e4',
    str: '#e3a57a',
    num: '#c299e6',
    dot: '#f3b35a',
    ident: theme.ink,
  };
  function hl(line) {
    if (/^\s*#/.test(line)) return <span style={{ color: col.comment }}>{line}</span>;
    const m = line.match(/^(\s*-?\s*)([A-Za-z_][\w-]*)(\s*:)(.*)$/);
    if (m) {
      return (
        <>
          <span>{m[1]}</span>
          <span style={{ color: col.key }}>{m[2]}</span>
          <span style={{ color: theme.ink2 }}>{m[3]}</span>
          <span>{hlVal(m[4])}</span>
        </>
      );
    }
    return hlVal(line);
  }
  function hlVal(s) {
    // crude: highlight strings and numbers
    const parts = [];
    let i = 0, buf = '';
    while (i < s.length) {
      const ch = s[i];
      if (ch === "'" || ch === '"') {
        if (buf) { parts.push(<span key={parts.length}>{buf}</span>); buf = ''; }
        const q = ch; let j = i + 1;
        while (j < s.length && s[j] !== q) j++;
        parts.push(<span key={parts.length} style={{ color: col.str }}>{s.slice(i, j + 1)}</span>);
        i = j + 1;
      } else {
        buf += ch; i++;
      }
    }
    if (buf) {
      // highlight numbers, dot-ops
      const tok = buf.split(/(\b\d+\b|\.\w+)/g);
      tok.forEach((t, k) => {
        if (/^\d+$/.test(t)) parts.push(<span key={`${parts.length}-${k}`} style={{ color: col.num }}>{t}</span>);
        else if (/^\.\w+/.test(t)) parts.push(<span key={`${parts.length}-${k}`} style={{ color: col.dot }}>{t}</span>);
        else parts.push(<span key={`${parts.length}-${k}`}>{t}</span>);
      });
    }
    return parts;
  }
  return (
    <div style={{
      fontFamily: RR_FONT_MONO, fontSize, lineHeight: 1.55, color: theme.ink,
      background: theme.bg, borderRadius: 4, overflow: 'auto',
      width, maxHeight,
    }}>
      {lines.map((ln, i) => (
        <div key={i} style={{
          display: 'flex',
          background: highlightLines[i + 1] ? `${highlightLines[i + 1]}22` : 'transparent',
          borderLeft: highlightLines[i + 1] ? `2px solid ${highlightLines[i + 1]}` : '2px solid transparent',
          padding: '0 0 0 6px',
        }}>
          {withLineNo && (
            <span style={{ width: 32, textAlign: 'right', color: theme.dim, paddingRight: 10, userSelect: 'none', flexShrink: 0 }}>
              {i + 1}
            </span>
          )}
          <span style={{ whiteSpace: 'pre' }}>{hl(ln)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, kicker, theme = rrDark, actions, children, flex }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex, minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 14px', borderBottom: `1px solid ${theme.border}`,
        background: theme.bg2, flexShrink: 0, height: 34,
      }}>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
          {kicker}
        </span>
        <span style={{ fontSize: 13, color: theme.heading, fontWeight: 500 }}>{title}</span>
        <div style={{ flex: 1 }} />
        {actions}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
    </div>
  );
}

function Btn({ children, kind = 'ghost', theme = rrDark, onClick, icon, style }) {
  const kinds = {
    primary: { bg: theme.active, color: theme.bg, bd: theme.active },
    danger: { bg: 'transparent', color: theme.err, bd: 'rgba(232,113,102,0.4)' },
    ghost: { bg: 'transparent', color: theme.ink, bd: theme.border2 },
    solid: { bg: theme.bg3, color: theme.ink, bd: theme.border2 },
  };
  const k = kinds[kind];
  return (
    <button onClick={onClick} style={{
      background: k.bg, color: k.color, border: `1px solid ${k.bd}`,
      padding: '5px 10px', borderRadius: 4, fontFamily: RR_FONT_UI, fontSize: 12,
      fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
      letterSpacing: 0.1, ...style,
    }}>
      {icon && <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11 }}>{icon}</span>}
      {children}
    </button>
  );
}

// ── LAL rules (bundled scripts from oap-server/server-starter/resources/lal) ───
const LAL_RULES = [
  { catalog: 'lal', name: 'envoy-als',       layer: 'MESH',         status: 'ACTIVE',   localState: 'RUNNING',    hash: 'fa0023…', updated: '2d ago',   author: 'ops@tetrate', metrics: 7, origin: 'runtime', outputType: 'Log + SampledTrace', err: null },
  { catalog: 'lal', name: 'mysql-slowsql',   layer: 'MYSQL',        status: 'ACTIVE',   localState: 'RUNNING',    hash: 'aa7c19…', updated: '6h ago',   author: 'static',      metrics: 0, origin: 'static',  outputType: 'SlowSQL', err: null },
  { catalog: 'lal', name: 'pgsql-slowsql',   layer: 'POSTGRESQL',   status: 'ACTIVE',   localState: 'RUNNING',    hash: 'bc4f02…', updated: '6h ago',   author: 'static',      metrics: 0, origin: 'static',  outputType: 'SlowSQL', err: null },
  { catalog: 'lal', name: 'redis-slowsql',   layer: 'REDIS',        status: 'ACTIVE',   localState: 'RUNNING',    hash: 'd19e7a…', updated: '6h ago',   author: 'static',      metrics: 0, origin: 'static',  outputType: 'SlowSQL', err: null },
  { catalog: 'lal', name: 'k8s-service',     layer: 'K8S_SERVICE',  status: 'ACTIVE',   localState: 'RUNNING',    hash: 'c7d19e…', updated: '6d ago',   author: 'static',      metrics: 5, origin: 'static',  outputType: 'Log + SampledTrace', err: null },
  { catalog: 'lal', name: 'mesh-dp',         layer: 'MESH_DP',      status: 'ACTIVE',   localState: 'RUNNING',    hash: '0e3b4c…', updated: '3d ago',   author: 'ops@tetrate', metrics: 4, origin: 'runtime', outputType: 'Log + SampledTrace', err: null },
  { catalog: 'lal', name: 'mesh-cp',         layer: 'MESH_CP',      status: 'ACTIVE',   localState: 'RUNNING',    hash: '91a8c2…', updated: '3d ago',   author: 'static',      metrics: 2, origin: 'static',  outputType: 'Log', err: null },
  { catalog: 'lal', name: 'k8s-audit',       layer: 'K8S',          status: 'ACTIVE',   localState: 'SUSPENDED',  hash: 'c7d19e…', updated: '6d ago',   author: 'static',      metrics: 5, origin: 'static',  outputType: 'Log', err: null, suspending: true },
  { catalog: 'lal', name: 'nginx',           layer: 'NGINX',        status: 'ACTIVE',   localState: 'RUNNING',    hash: '3f12ee…', updated: '12h ago',  author: 'han.l',       metrics: 3, origin: 'runtime', outputType: 'Log', err: null },
  { catalog: 'lal', name: 'apisix',          layer: 'APISIX',       status: 'ACTIVE',   localState: 'RUNNING',    hash: '7b44a1…', updated: '1d ago',   author: 'static',      metrics: 3, origin: 'static',  outputType: 'Log', err: null },
  { catalog: 'lal', name: 'tomcat',          layer: 'GENERAL',      status: 'INACTIVE', localState: 'NOT_LOADED', hash: '—',       updated: '10d ago',  author: 'ops@tetrate', metrics: 0, origin: 'runtime', outputType: 'Log', err: 'abortOnFailure tripped · regex miss · 7 lines' },
  { catalog: 'lal', name: 'default',         layer: 'GENERAL',      status: 'ACTIVE',   localState: 'RUNNING',    hash: 'bb0210…', updated: 'static',   author: 'static',      metrics: 0, origin: 'static',  outputType: 'Log', err: null },
  { catalog: 'lal', name: 'genai',           layer: 'GENERAL',      status: 'ACTIVE',   localState: 'RUNNING',    hash: '4e21cf…', updated: '4d ago',   author: 'ops@tetrate', metrics: 6, origin: 'runtime', outputType: 'Log', err: null },
  { catalog: 'lal', name: 'virtual-cache',   layer: 'VIRTUAL_CACHE',status: 'ACTIVE',   localState: 'RUNNING',    hash: '22aa9e…', updated: '5d ago',   author: 'static',      metrics: 2, origin: 'static',  outputType: 'Log', err: null },
];

// Realistic LAL script (envoy-als.yaml shape)
const SAMPLE_YAML_LAL = `# lal/envoy-als.yaml · Log Analysis Language
rules:
  - name: envoy-als
    layer: MESH
    dsl: |
      filter {
        json {
          abortOnFailure true
        }
        extractor {
          service       parsed.destination.address   as String
          instance      parsed.destination.port      as String
          endpoint      parsed.request.path          as String
          timestamp     parsed.startTime             as String
          def resp      = parsed?.response
          tag  'status.code'   : resp?.responseCode?.value
          tag  'resp.flags'    : resp?.responseCodeDetails
          layer 'MESH'
        }
        sink {
          if (tag('status.code') == null ||
              tag('status.code').toInteger() >= 500) {
            enforcer {}
          } else {
            sampler {
              rateLimit("mesh-access-log") {
                rpm 1800
              }
            }
          }
        }
      }
`;

// ── OAL rules (bundled scripts from oap-server/server-starter/resources/oal) ───
const OAL_RULES = [
  { catalog: 'oal', name: 'core',       layer: '—',      status: 'ACTIVE',   localState: 'RUNNING',    hash: '8a21f0…', updated: 'static',  author: 'static',      metrics: 86, origin: 'static',  err: null,
    note: 'Service / Instance / Endpoint core metrics' },
  { catalog: 'oal', name: 'envoy',      layer: 'MESH_DP',status: 'ACTIVE',   localState: 'RUNNING',    hash: '9b0ae1…', updated: 'static',  author: 'static',      metrics: 24, origin: 'static',  err: null,
    note: 'Envoy ALS / metrics service' },
  { catalog: 'oal', name: 'istio',      layer: 'MESH_CP',status: 'ACTIVE',   localState: 'RUNNING',    hash: 'f2103c…', updated: 'static',  author: 'static',      metrics: 18, origin: 'static',  err: null,
    note: 'Istio control plane' },
  { catalog: 'oal', name: 'browser',    layer: 'BROWSER',status: 'ACTIVE',   localState: 'RUNNING',    hash: '11cc4a…', updated: 'static',  author: 'static',      metrics: 14, origin: 'static',  err: null,
    note: 'Browser RUM — page perf, JS errors' },
  { catalog: 'oal', name: 'k8s',        layer: 'K8S',    status: 'ACTIVE',   localState: 'RUNNING',    hash: '7daa8c…', updated: 'static',  author: 'static',      metrics: 9,  origin: 'static',  err: null,
    note: 'Event / audit metrics' },
  { catalog: 'oal', name: 'zipkin',     layer: '—',      status: 'ACTIVE',   localState: 'RUNNING',    hash: '5e22b0…', updated: 'static',  author: 'static',      metrics: 6,  origin: 'static',  err: null,
    note: 'Zipkin-bridge spans' },
  { catalog: 'oal', name: 'event',      layer: '—',      status: 'ACTIVE',   localState: 'RUNNING',    hash: 'cc9003…', updated: 'static',  author: 'static',      metrics: 4,  origin: 'static',  err: null,
    note: 'Event records → counters' },
  { catalog: 'oal', name: 'custom/mobile', layer: 'MOBILE', status: 'ACTIVE', localState: 'RUNNING',   hash: 'e77912…', updated: '3d ago',  author: 'han.l',       metrics: 7,  origin: 'runtime', err: null,
    note: 'In-house mobile crash/rum OAL' },
  { catalog: 'oal', name: 'custom/orders', layer: 'GENERAL', status: 'ACTIVE', localState: 'RUNNING', hash: 'd20a4b…', updated: '14h ago', author: 'ops@tetrate', metrics: 5,  origin: 'runtime', err: null,
    note: 'Team-owned endpoint slicing for /api/orders/*' },
  { catalog: 'oal', name: 'custom/gateway', layer: 'GATEWAY', status: 'ACTIVE', localState: 'SUSPENDED', hash: '8141ae…', updated: '2h ago', author: 'ops@tetrate', metrics: 3, origin: 'runtime', err: null, suspending: true,
    note: 'Re-entity via service_instance(tag) — structural apply pending' },
  { catalog: 'oal', name: 'deprecated/old-svc', layer: 'GENERAL', status: 'INACTIVE', localState: 'NOT_LOADED', hash: '—', updated: '21d ago', author: 'han.l',  metrics: 0, origin: 'runtime', err: null,
    note: 'Superseded by custom/orders' },
  { catalog: 'oal', name: 'pulsar',     layer: 'PULSAR', status: 'ACTIVE',   localState: 'RUNNING',    hash: '3c881e…', updated: 'static',  author: 'static',      metrics: 8,  origin: 'static',  err: null,
    note: 'Pulsar receiver' },
];

// Realistic OAL script (core.oal shape; shortened to fit editor)
const SAMPLE_OAL = `// oal/core.oal · Observability Analysis Language
// Service layer
service_resp_time       = from(Service.latency).longAvg();
service_sla             = from(Service.*).percent(status == true);
service_cpm             = from(Service.*).cpm();
service_apdex           = from(Service.latency).apdex(name, status);
service_percentile      = from(Service.latency).percentile(50,75,90,95,99);

// Filter + disableOAL patterns
endpoint_resp_time      = from(Endpoint.latency).longAvg();
endpoint_cpm            = from(Endpoint.*).cpm();
endpoint_sla            = from(Endpoint.*).percent(status == true);

// Relations — scope the calling service / endpoint pair
service_relation_client_cpm = from(ServiceRelation.*)
    .filter(detectPoint == DetectPoint.CLIENT)
    .cpm();
service_relation_server_cpm = from(ServiceRelation.*)
    .filter(detectPoint == DetectPoint.SERVER)
    .cpm();

// Disable unused sources to reduce cardinality
disable(segment);
disable(top_n_database_statement);
`;

// ── LAL debugger capture (envoy-als rule) ─────────────────────────────────────
// Per-block sampling on the live push path. Parse-time/compile-time errors are
// caught at apply; if we're sampling, grammar is valid. Blocks: text · parser ·
// extractor · sink · output.
// LAL is per-record: each line flows independently through text → parser → extractor → sink → output(s).
// So we model "records" as the primary dimension, and each block is a lens onto the record at that step.
const LAL_RECORDS = [
  {
    id: 'r1', ts: '14:02:19.334', svc: 'checkout',
    text: '{"startTime":"2026-04-23T14:02:19.210Z","request":{"path":"/api/orders","method":"POST"},"response":{"responseCode":{"value":500},"responseCodeDetails":"upstream_reset_before_response_started"},"destination":{"address":"checkout","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'checkout', instance: '8080', endpoint: '/api/orders', 'status.code': '500', 'resp.flags': 'upstream_reset_before_response_started' },
    sink: { branch: 'enforcer', kept: true, note: 'status ≥ 500' },
    logData: { service: 'checkout', endpoint: '/api/orders', 'status.code': '500', timestamp: '2026-04-23T14:02:19.210Z' },
    metric: { service: 'checkout', endpoint: '/api/orders', 'status.code': '500', delta: 1 },
  },
  {
    id: 'r2', ts: '14:02:19.221', svc: 'checkout',
    text: '{"startTime":"2026-04-23T14:02:19.112Z","request":{"path":"/api/orders","method":"POST"},"response":{"responseCode":{"value":200}},"destination":{"address":"checkout","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'checkout', instance: '8080', endpoint: '/api/orders', 'status.code': '200', 'resp.flags': null },
    sink: { branch: 'rateLimit', kept: true, note: 'kept · under rpm cap' },
    logData: { service: 'checkout', endpoint: '/api/orders', 'status.code': '200', timestamp: '2026-04-23T14:02:19.112Z' },
    metric: { service: 'checkout', endpoint: '/api/orders', 'status.code': '200', delta: 1 },
  },
  {
    id: 'r3', ts: '14:02:18.907', svc: 'catalog',
    text: '{"startTime":"2026-04-23T14:02:18.804Z","request":{"path":"/api/items/127","method":"GET"},"response":{"responseCode":{"value":200}},"destination":{"address":"catalog","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'catalog', instance: '8080', endpoint: '/api/items/127', 'status.code': '200', 'resp.flags': null },
    sink: { branch: 'rateLimit', kept: false, note: 'dropped · over rpm cap' },
    logData: null,  // dropped
    metric:  { service: 'catalog',  endpoint: '/api/items/127', 'status.code': '200', delta: 1 }, // counter still increments
  },
  {
    id: 'r4', ts: '14:02:18.751', svc: 'checkout',
    text: '{"startTime":"2026-04-23T14:02:18.640Z","request":{"path":"/api/cart","method":"POST"},"response":{"responseCode":{"value":503},"responseCodeDetails":"no_healthy_upstream"},"destination":{"address":"checkout","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'checkout', instance: '8080', endpoint: '/api/cart', 'status.code': '503', 'resp.flags': 'no_healthy_upstream' },
    sink: { branch: 'enforcer', kept: true, note: 'status ≥ 500' },
    logData: { service: 'checkout', endpoint: '/api/cart', 'status.code': '503', timestamp: '2026-04-23T14:02:18.640Z' },
    metric: { service: 'checkout', endpoint: '/api/cart', 'status.code': '503', delta: 1 },
  },
  {
    id: 'r5', ts: '14:02:18.512', svc: 'catalog',
    text: '{"startTime":"2026-04-23T14:02:18.401Z","request":{"path":"/api/items/128","method":"GET"},"response":{"responseCode":{"value":200}},"destination":{"address":"catalog","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'catalog', instance: '8080', endpoint: '/api/items/128', 'status.code': '200', 'resp.flags': null },
    sink: { branch: 'rateLimit', kept: true, note: 'kept · under rpm cap' },
    logData: { service: 'catalog', endpoint: '/api/items/128', 'status.code': '200', timestamp: '2026-04-23T14:02:18.401Z' },
    metric: { service: 'catalog',  endpoint: '/api/items/128', 'status.code': '200', delta: 1 },
  },
  {
    id: 'r6', ts: '14:02:18.212', svc: 'checkout',
    text: '{"startTime":"2026-04-23T14:02:18.102Z","request":{"path":"/api/orders","method":"POST"},"response":{"responseCode":{"value":200}},"destination":{"address":"checkout","port":"8080"}}',
    parsed: { keys: ['startTime','request','response','destination'], status: 'ok' },
    extracted: { service: 'checkout', instance: '8080', endpoint: '/api/orders', 'status.code': '200', 'resp.flags': null },
    sink: { branch: 'rateLimit', kept: true, note: 'kept · under rpm cap' },
    logData: { service: 'checkout', endpoint: '/api/orders', 'status.code': '200', timestamp: '2026-04-23T14:02:18.102Z' },
    metric: { service: 'checkout', endpoint: '/api/orders', 'status.code': '200', delta: 1 },
  },
];

const SAMPLE_LAL_CAPTURE = {
  rule: 'envoy-als',
  layer: 'MESH',
  capturedAt: '2026-04-23T14:02:19.334Z',
  sampledBlock: 'all', // user toggles per-block sampling; 'all' shows every block
  window: 'sampled 6 records in past 60s',
  seen: 6,
  records: LAL_RECORDS,
  blocks: [
    { id: 'text',          kind: 'text',      label: 'text · raw log body',
      detail: 'Log body pre-parse — one record per line.' },
    { id: 'parser',        kind: 'parser',    label: 'parser · json { abortOnFailure=false }',
      detail: 'Emits a parsed map. Per-record output below.' },
    { id: 'extractor',     kind: 'extractor', label: 'extractor · map → LogData fields + tags',
      detail: 'service ← parsed.destination.address · endpoint ← parsed.request.path · tag "status.code"' },
    { id: 'sink',          kind: 'sink',      label: 'sink · if status ≥ 500 { enforcer } else { rateLimit rpm 1800 }',
      detail: 'Runtime routing only — per-record kept / dropped decision.' },
    { id: 'output_log',    kind: 'output',    label: 'output · LogData → Log index (layer=MESH)',
      detail: 'Persisted log record. Dropped records emit nothing here.' },
    { id: 'output_metric', kind: 'output',    label: 'output · metrics → MAL · mesh_access_log_count (counter)',
      detail: 'Derived metric. Counter still increments for dropped-from-log records.' },
  ],
};

// ── OAL debugger capture ─────────────────────────────────────────────────────
// Sampling starts from a single rule (one .oal line). Operator configures the
// sampling request (row cap + window) in the header; backend returns sampled
// source rows flowing through the rule's clauses. No implicit group-by stage
// dressed up — that's just how the aggregation emits.
const SAMPLE_OAL_RULES = [
  {
    rule: 'endpoint_cpm',
    script: 'core.oal',
    expression: 'endpoint_cpm = from(Endpoint.*).cpm();',
    sourceScope: 'Endpoint',
  },
  {
    rule: 'service_relation_server_cpm',
    script: 'core.oal',
    expression: 'service_relation_server_cpm = from(ServiceRelation.*).filter(detectPoint == DetectPoint.SERVER).cpm();',
    sourceScope: 'ServiceRelation',
  },
];

const SAMPLE_OAL_CAPTURE = {
  rule: 'endpoint_cpm',
  script: 'core.oal',
  sourceScope: 'Endpoint',
  expression: 'endpoint_cpm = from(Endpoint.*).cpm();',
  capturedAt: '2026-04-23T14:02:19.334Z',
  sampleRequest: { maxRows: 20, windowSec: 60 },
  window: 'sampled 14 of ~42 rows · 60s window',
  stages: [
    {
      id: 'source',
      kind: 'source sample',
      label: 'from(Endpoint.*) — sampled source rows',
      detail: 'Operator-requested sample of Endpoint rows in window',
      inCount: '—', outCount: 14,
      cols: ['entityId', 'service', 'endpoint', 'status', 'latency(ms)'],
      rows: [
        ['L2FwaS9vcmRlcnM=.1.checkout', 'checkout', '/api/orders',    true,  84],
        ['L2FwaS9vcmRlcnM=.1.checkout', 'checkout', '/api/orders',    false, 1212],
        ['L2FwaS9pdGVtcw==.1.catalog',  'catalog',  '/api/items/127', true,  17],
        ['L2FwaS9pdGVtcw==.1.catalog',  'catalog',  '/api/items/128', true,  22],
      ],
    },
    {
      id: 'filter',
      kind: 'filter',
      label: '.filter(...) — none on this metric',
      detail: 'Pass-through · no filter clause on endpoint_cpm',
      inCount: 14, outCount: 14,
      note: 'core.oal has .filter() clauses on service_relation_*; this rule has none.',
    },
    {
      id: 'func',
      kind: 'aggregation',
      label: '.cpm() — calls per minute',
      detail: 'func class: CPMFunction · one row per Endpoint entityId per minute',
      inCount: 14, outCount: 3,
      cols: ['entityId', 'endpoint', 'cpm'],
      rows: [
        ['L2FwaS9vcmRlcnM=.1.checkout', '/api/orders',    7],
        ['L2FwaS9pdGVtcw==.1.catalog',  '/api/items/127', 4],
        ['L2FwaS9pdGVtcw==.1.catalog',  '/api/items/128', 3],
      ],
    },
    {
      id: 'store',
      kind: 'store',
      label: 'persist · measure endpoint_cpm',
      detail: 'BanyanDB · measure=endpoint_cpm · tsBucket=minute',
      inCount: 3, outCount: 3,
      cols: ['entityId', 'endpoint', 'timestamp', 'value'],
      rows: [
        ['L2FwaS9vcmRlcnM=.1.checkout', '/api/orders',    '2026-04-23T14:02', 7],
        ['L2FwaS9pdGVtcw==.1.catalog',  '/api/items/127', '2026-04-23T14:02', 4],
        ['L2FwaS9pdGVtcw==.1.catalog',  '/api/items/128', '2026-04-23T14:02', 3],
      ],
    },
  ],
};

Object.assign(window, {
  RR_FONT_MONO, RR_FONT_UI, rrDark, rrLight,
  CATALOGS, RULES, SAMPLE_DEBUG_CAPTURE, CLUSTER_NODES, HISTORY, SAMPLE_YAML_MAL,
  LAL_RULES, OAL_RULES, SAMPLE_YAML_LAL, SAMPLE_OAL, SAMPLE_LAL_CAPTURE, SAMPLE_OAL_CAPTURE, SAMPLE_OAL_RULES, LAL_RECORDS,
  Pill, Dot, AppFrame, CatalogNav, YamlView, Section, Btn,
});
