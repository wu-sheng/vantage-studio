// Live debugger — 3 variations
// The debugger visualizes backend-captured workflow stages.
// Steps come from OAP, NOT simulated here. Each rule yields its own step list.

// The "input" step is a full SampleFamily dataset — many series, not a single sample.
// Shared dataset used by A and C (B already renders families per stage).
const INPUT_FAMILY_DATASET = {
  title: 'SampleFamily · node_memory_MemAvailable_bytes',
  kind: 'gauge',
  totalPoints: 30,
  cols: ['host', 'region', 'env', 'last (bytes)', 'points'],
  series: [
    { host: 'vm-prod-a7',  region: 'us-east-1',  env: 'prod', last: 8_414_208_000,  n: 7 },
    { host: 'vm-prod-b1',  region: 'us-east-1',  env: 'prod', last: 6_221_004_800,  n: 6 },
    { host: 'vm-prod-c4',  region: 'us-west-2',  env: 'prod', last: 11_004_928_000, n: 6 },
    { host: 'vm-prod-d2',  region: 'eu-west-1',  env: 'prod', last: 4_980_113_408,  n: 5 },
    { host: 'vm-stg-x1',   region: 'us-east-1',  env: 'stg',  last: 2_117_894_144,  n: 6 },
  ],
};

function InputFamilyTable({ theme, highlight }) {
  const ds = INPUT_FAMILY_DATASET;
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 5, background: theme.panel, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8, background: theme.bg2 }}>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 0.5, textTransform: 'uppercase' }}>{ds.kind}</span>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink }}>{ds.title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>
          {ds.series.length} series · {ds.totalPoints} points
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: RR_FONT_MONO, fontSize: 11 }}>
        <thead>
          <tr style={{ background: theme.bg }}>
            {ds.cols.map(c => (
              <th key={c} style={{ textAlign: 'left', padding: '5px 10px', color: theme.dim, fontWeight: 400, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${theme.border}` }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ds.series.map((r, ri) => {
            const isHi = highlight && r.host === highlight;
            return (
              <tr key={r.host} style={{
                background: isHi ? 'rgba(255,180,80,0.08)' : 'transparent',
                borderLeft: isHi ? `2px solid ${theme.accent}` : '2px solid transparent',
              }}>
                <td style={{ padding: '5px 10px', color: isHi ? theme.heading : theme.ink, borderBottom: ri < ds.series.length - 1 ? `1px solid ${theme.border}` : 'none' }}>{r.host}</td>
                <td style={{ padding: '5px 10px', color: theme.ink2, borderBottom: ri < ds.series.length - 1 ? `1px solid ${theme.border}` : 'none' }}>{r.region}</td>
                <td style={{ padding: '5px 10px', color: theme.ink2, borderBottom: ri < ds.series.length - 1 ? `1px solid ${theme.border}` : 'none' }}>{r.env}</td>
                <td style={{ padding: '5px 10px', color: theme.accent, borderBottom: ri < ds.series.length - 1 ? `1px solid ${theme.border}` : 'none' }}>{r.last.toLocaleString()}</td>
                <td style={{ padding: '5px 10px', color: theme.ink2, borderBottom: ri < ds.series.length - 1 ? `1px solid ${theme.border}` : 'none' }}>{r.n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DebuggerA_Pipeline({ theme = rrDark }) {
  const cap = SAMPLE_DEBUG_CAPTURE;
  const [sel, setSel] = React.useState('downsample');
  const selStep = cap.steps.find(s => s.id === sel);

  return (
    <AppFrame theme={theme} route="/debug/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Capture control bar */}
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>debug · otel-rules / vm</span>
            <Pill tone="info">captured from oap-01</Pill>
            <Pill tone="dim">{cap.window}</Pill>
            <Pill tone="accent">{cap.samplesSeen} samples</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>{cap.capturedAt}</span>
            <Btn theme={theme} kind="ghost" icon="↻">Re-capture</Btn>
            <Btn theme={theme} kind="primary" icon="●">Tail live</Btn>
          </div>

          {/* Pipeline strip */}
          <div style={{ padding: '18px 14px 6px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, overflowX: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, minWidth: 'max-content' }}>
              {cap.steps.map((s, i) => {
                const active = sel === s.id;
                const droppedPct = s.inCount > 0 ? (1 - s.outCount / s.inCount) : 0;
                return (
                  <React.Fragment key={s.id}>
                    <div onClick={() => setSel(s.id)} style={{
                      minWidth: 164, padding: '10px 12px', cursor: 'pointer',
                      background: active ? theme.bg3 : theme.bg2,
                      border: `1px solid ${active ? theme.active : theme.border}`,
                      borderRadius: 5, position: 'relative',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{
                          fontFamily: RR_FONT_MONO, fontSize: 9.5, color: active ? theme.active : theme.dim,
                          letterSpacing: 1, textTransform: 'uppercase',
                        }}>{s.kind}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim }}>{i + 1}/{cap.steps.length}</span>
                      </div>
                      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 11.5, color: theme.heading, lineHeight: 1.35, marginBottom: 8, wordBreak: 'break-word' }}>
                        {s.label}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontFamily: RR_FONT_MONO }}>
                        <span style={{ color: theme.ok }}>{s.inCount}</span>
                        <span style={{ color: theme.dim }}>→</span>
                        <span style={{ color: s.outCount < s.inCount ? theme.warn : theme.ok }}>{s.outCount}</span>
                        {droppedPct > 0 && <span style={{ color: theme.warn, marginLeft: 'auto' }}>−{Math.round(droppedPct*100)}%</span>}
                      </div>
                      {/* bar */}
                      <div style={{ height: 3, background: theme.bg, marginTop: 6, borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${100 - droppedPct*100}%`, background: active ? theme.active : theme.ok2 || theme.ok, opacity: active ? 1 : 0.6 }} />
                      </div>
                    </div>
                    {i < cap.steps.length - 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', color: theme.dim, padding: '0 2px', fontSize: 14 }}>›</div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Detail panel */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <div style={{ flex: 1, padding: '16px 18px', overflow: 'auto', borderRight: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <Pill tone="accent">step · {selStep.kind}</Pill>
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading }}>{selStep.label}</span>
              </div>
              <div style={{ fontSize: 12, color: theme.ink2, marginBottom: 14 }}>{selStep.detail}</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
                <StatTile theme={theme} label="in" value={selStep.inCount} />
                <StatTile theme={theme} label="out" value={selStep.outCount} tone={selStep.outCount < selStep.inCount ? 'warn' : 'ok'} />
                <StatTile theme={theme} label="dropped" value={selStep.inCount - selStep.outCount} tone={selStep.inCount - selStep.outCount > 0 ? 'warn' : 'dim'} />
              </div>

              <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                {selStep.id === 'input' ? 'input dataset' : 'samples at this step'}
              </div>
              {selStep.id === 'input' ? (
                <InputFamilyTable theme={theme} highlight="vm-prod-a7" />
              ) : (
              <div style={{
                background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 5,
                fontFamily: RR_FONT_MONO, fontSize: 11.5, overflow: 'hidden',
              }}>
                {selStep.samples.map((s, i) => (
                  <div key={i} style={{
                    padding: '8px 12px', borderBottom: i < selStep.samples.length - 1 ? `1px solid ${theme.border}` : 'none',
                    display: 'grid', gridTemplateColumns: '90px 1fr 120px', gap: 14, alignItems: 'baseline',
                  }}>
                    <span style={{ color: theme.dim, fontSize: 10.5 }}>#{i + 1}</span>
                    <span style={{ color: theme.ink2 }}>{JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'value' && k !== 'avg' && k !== 'lhs' && k !== 'rhs' && k !== 'kept')))}</span>
                    <span style={{ color: theme.accent, textAlign: 'right' }}>
                      {s.value !== undefined ? s.value.toLocaleString?.() ?? s.value : s.avg ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
              )}
            </div>

            {/* Right rail — diff vs previous step */}
            <div style={{ width: 280, padding: '16px 14px', fontFamily: RR_FONT_MONO, fontSize: 11.5 }}>
              <div style={{ color: theme.dim, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                diff vs prev step
              </div>
              {selStep.kind === 'downsampling' ? (
                <div style={{ color: theme.ink2, lineHeight: 1.6 }}>
                  <div style={{ color: theme.warn, marginBottom: 6 }}>cardinality 20 → 3</div>
                  <div style={{ color: theme.dim, marginBottom: 10 }}>3 window keys, AVG applied per instance+minute</div>
                  <div style={{ color: theme.heading, marginBottom: 4 }}>window = minute=1445</div>
                  <div style={{ color: theme.dim }}>vm-prod-a7 · n=7 · Σ/n = 50.14</div>
                  <div style={{ color: theme.dim }}>vm-prod-b1 · n=7 · Σ/n = 37.08</div>
                  <div style={{ color: theme.dim }}>vm-prod-c4 · n=6 · Σ/n = 67.22</div>
                </div>
              ) : (
                <div style={{ color: theme.ink2 }}>see sample table on left</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function StatTile({ theme, label, value, tone = 'ok' }) {
  const c = tone === 'ok' ? theme.ok : tone === 'warn' ? theme.warn : theme.dim;
  return (
    <div style={{
      background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 5,
      padding: '10px 12px',
    }}>
      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 22, color: c, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function DebuggerB_Waterfall({ theme = rrDark }) {
  // Each stage shows the SampleFamily at that stage; one series is pinned across stages.
  // Entity scope is selectable — Service / ServiceInstance / Endpoint.
  const [scope, setScope] = React.useState('ServiceInstance');
  const pinned = 'vm-prod-a7';

  // Entity columns per scope
  const ENTITY_COL = {
    Service:         { label: 'service',    vals: { 'vm-prod-a7': 'vm-prod',     'vm-prod-b1': 'vm-prod',     'vm-prod-c4': 'vm-prod' } },
    ServiceInstance: { label: 'instance',   vals: { 'vm-prod-a7': 'vm-prod-a7',  'vm-prod-b1': 'vm-prod-b1',  'vm-prod-c4': 'vm-prod-c4' } },
    Endpoint:        { label: 'endpoint',   vals: { 'vm-prod-a7': '/api/orders', 'vm-prod-b1': '/api/orders', 'vm-prod-c4': '/api/orders' } },
  };
  const ENTITY_ID = {
    Service:         { 'vm-prod-a7': 'dm0tcHJvZA==.1', 'vm-prod-b1': 'dm0tcHJvZA==.1', 'vm-prod-c4': 'dm0tcHJvZA==.1' },
    ServiceInstance: { 'vm-prod-a7': 'dm9tLXByb2QtYTc=.1', 'vm-prod-b1': 'dm9tLXByb2QtYjE=.1', 'vm-prod-c4': 'dm9tLXByb2QtYzQ=.1' },
    Endpoint:        { 'vm-prod-a7': 'L2FwaS9vcmRlcnM=.1.vm-prod', 'vm-prod-b1': 'L2FwaS9vcmRlcnM=.1.vm-prod', 'vm-prod-c4': 'L2FwaS9vcmRlcnM=.1.vm-prod' },
  };
  const entLabel = ENTITY_COL[scope].label;
  const entVal = ENTITY_COL[scope].vals;
  const entId = ENTITY_ID[scope];

  // Synthetic family tables per stage
  const families = {
    input: {
      title: 'SampleFamily · node_memory_MemAvailable_bytes', kind: 'gauge',
      cols: ['host', 'region', 'last (bytes)', 'n'],
      rows: [
        { k: 'vm-prod-a7',  v: ['vm-prod-a7',  'us-east-1',  '8,414,208,000', '7'] },
        { k: 'vm-prod-b1',  v: ['vm-prod-b1',  'us-east-1',  '6,221,004,800', '6'] },
        { k: 'vm-prod-c4',  v: ['vm-prod-c4',  'us-west-2',  '11,004,928,000','6'] },
        { k: 'vm-prod-d2',  v: ['vm-prod-d2',  'eu-west-1',  '4,980,113,408', '5'] },
        { k: 'vm-stg-x1',   v: ['vm-stg-x1',   'us-east-1',  '2,117,894,144', '6'] },
      ],
    },
    afterFilter: {
      title: 'after filter · region != "eu-*" && env != "stg"', kind: 'gauge',
      cols: ['host', 'region', 'last (bytes)', 'n'],
      rows: [
        { k: 'vm-prod-a7',  v: ['vm-prod-a7',  'us-east-1',  '8,414,208,000', '7'] },
        { k: 'vm-prod-b1',  v: ['vm-prod-b1',  'us-east-1',  '6,221,004,800', '6'] },
        { k: 'vm-prod-c4',  v: ['vm-prod-c4',  'us-west-2',  '11,004,928,000','6'] },
      ],
      dropped: ['vm-prod-d2 (region=eu-west-1)', 'vm-stg-x1 (env=stg)'],
    },
    afterClosure: {
      title: 'after closure · mem_available_percent = bytes × 100 / MemTotal', kind: 'gauge',
      cols: ['host', 'region', 'last (%)', 'n'],
      rows: [
        { k: 'vm-prod-a7',  v: ['vm-prod-a7',  'us-east-1',  '50.10', '7'] },
        { k: 'vm-prod-b1',  v: ['vm-prod-b1',  'us-east-1',  '37.04', '6'] },
        { k: 'vm-prod-c4',  v: ['vm-prod-c4',  'us-west-2',  '65.52', '6'] },
      ],
    },
    afterScope: {
      title: `after scope · bound to ${scope} entity`, kind: 'gauge',
      cols: ['entityId', entLabel, 'host', 'last (%)', 'n'],
      rows: [
        { k: 'vm-prod-a7', v: [entId['vm-prod-a7'], entVal['vm-prod-a7'], 'vm-prod-a7', '50.10', '7'] },
        { k: 'vm-prod-b1', v: [entId['vm-prod-b1'], entVal['vm-prod-b1'], 'vm-prod-b1', '37.04', '6'] },
        { k: 'vm-prod-c4', v: [entId['vm-prod-c4'], entVal['vm-prod-c4'], 'vm-prod-c4', '65.52', '6'] },
      ],
    },
    afterTag: {
      title: 'after tag · layer="VM"', kind: 'gauge',
      cols: [entLabel, 'layer', 'last (%)', 'n'],
      rows: [
        { k: 'vm-prod-a7', v: [entVal['vm-prod-a7'], 'VM', '50.10', '7'] },
        { k: 'vm-prod-b1', v: [entVal['vm-prod-b1'], 'VM', '37.04', '6'] },
        { k: 'vm-prod-c4', v: [entVal['vm-prod-c4'], 'VM', '65.52', '6'] },
      ],
    },
    afterDownsample: {
      title: 'after downsample · 1m avg per entity', kind: 'measure',
      cols: [entLabel, 'minute', 'avg (%)', 'n'],
      rows: [
        { k: 'vm-prod-a7', v: [entVal['vm-prod-a7'], '1445', '50.14', '7'] },
        { k: 'vm-prod-b1', v: [entVal['vm-prod-b1'], '1445', '37.21', '6'] },
        { k: 'vm-prod-c4', v: [entVal['vm-prod-c4'], '1445', '65.18', '6'] },
      ],
    },
    store: {
      title: 'written to BanyanDB · measure vm_memory_available_percent', kind: 'rows',
      cols: ['entityId', entLabel, 'timestamp (minute)', 'value (%)', 'tags'],
      rows: [
        { k: 'vm-prod-a7', v: [entId['vm-prod-a7'], entVal['vm-prod-a7'], '2026-04-23T14:02', '50.14', '{layer:VM}'] },
        { k: 'vm-prod-b1', v: [entId['vm-prod-b1'], entVal['vm-prod-b1'], '2026-04-23T14:02', '37.21', '{layer:VM}'] },
        { k: 'vm-prod-c4', v: [entId['vm-prod-c4'], entVal['vm-prod-c4'], '2026-04-23T14:02', '65.18', '{layer:VM}'] },
      ],
    },
  };

  const stages = [
    { id: 'input',       kind: 'input',     label: 'Ingest',       fam: families.input },
    { id: 'filter0',     kind: 'stage',     label: 'filter',       fam: families.afterFilter },
    { id: 'closure0',    kind: 'stage',     label: 'closure',      fam: families.afterClosure },
    { id: 'scope',       kind: 'stage',     label: 'scope',        fam: families.afterScope },
    { id: 'tag',         kind: 'stage',     label: 'tag',          fam: families.afterTag },
    { id: 'downsample',  kind: 'stage',     label: 'downsample',   fam: families.afterDownsample },
    { id: 'store',       kind: 'sink',      label: 'store',        fam: families.store },
  ];

  const renderFamily = (fam, stepId) => (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.panel, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8, background: theme.bg }}>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 0.5, textTransform: 'uppercase' }}>{fam.kind}</span>
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink }}>{fam.title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>{fam.rows.length} series</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: RR_FONT_MONO, fontSize: 11 }}>
        <thead>
          <tr style={{ background: theme.bg }}>
            {fam.cols.map(c => (
              <th key={c} style={{ textAlign: 'left', padding: '5px 10px', color: theme.dim, fontWeight: 400, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${theme.border}` }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fam.rows.map((r, ri) => {
            const isPinned = r.k === pinned;
            return (
              <tr key={r.k} style={{
                background: isPinned ? 'rgba(255,180,80,0.08)' : 'transparent',
                borderLeft: isPinned ? `2px solid ${theme.accent}` : '2px solid transparent',
              }}>
                {r.v.map((cell, ci) => (
                  <td key={ci} style={{
                    padding: '5px 10px',
                    color: ci === r.v.length - 2 ? theme.accent : (isPinned ? theme.heading : theme.ink2),
                    borderBottom: ri < fam.rows.length - 1 ? `1px solid ${theme.border}` : 'none',
                    whiteSpace: 'nowrap',
                  }}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {fam.dropped && (
        <div style={{ padding: '6px 10px', borderTop: `1px dashed ${theme.border}`, fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.warn, background: theme.bg }}>
          dropped: {fam.dropped.join(' · ')}
        </div>
      )}
    </div>
  );

  return (
    <AppFrame theme={theme} route="/debug/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>debug · vm</span>
            <Pill tone="accent">pin · host={pinned}</Pill>
            <div style={{ display: 'flex', border: `1px solid ${theme.border}`, borderRadius: 4, overflow: 'hidden', marginLeft: 4 }}>
              {['Service', 'ServiceInstance', 'Endpoint'].map(s => (
                <div key={s} onClick={() => setScope(s)} style={{
                  padding: '4px 10px', fontFamily: RR_FONT_MONO, fontSize: 10.5,
                  cursor: 'pointer',
                  background: scope === s ? theme.active : theme.bg2,
                  color: scope === s ? theme.bg : theme.ink2,
                  borderRight: s !== 'Endpoint' ? `1px solid ${theme.border}` : 'none',
                }}>{s}</div>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>30 samples · 2m window</span>
            <Btn theme={theme} kind="ghost" icon="⎘">Copy</Btn>
            <Btn theme={theme} kind="primary" icon="↻">Re-capture</Btn>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '18px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '150px 40px 1fr', gap: 0 }}>
              {stages.map((s, i) => (
                <React.Fragment key={s.id}>
                  <div style={{
                    padding: '14px 12px 14px 0',
                    borderBottom: i < stages.length - 1 ? `1px solid ${theme.border}` : 'none',
                  }}>
                    <div style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase' }}>{s.kind}</div>
                    <div style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading, marginTop: 4 }}>{s.label}</div>
                  </div>
                  <div style={{
                    position: 'relative',
                    borderBottom: i < stages.length - 1 ? `1px solid ${theme.border}` : 'none',
                  }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: theme.border2, marginLeft: -1 }} />
                    <div style={{ position: 'absolute', left: '50%', top: 22, width: 10, height: 10, borderRadius: '50%', background: theme.accent, marginLeft: -5, boxShadow: `0 0 0 3px ${theme.bg}` }} />
                  </div>
                  <div style={{
                    padding: '14px 0 14px 16px',
                    borderBottom: i < stages.length - 1 ? `1px solid ${theme.border}` : 'none',
                  }}>
                    {renderFamily(s.fam, s.id)}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function DebuggerC_DualPane({ theme = rrDark }) {
  // Side-by-side: YAML on left w/ step anchors; sample table on right
  const cap = SAMPLE_DEBUG_CAPTURE;
  const [sel, setSel] = React.useState('filter0');
  const selStep = cap.steps.find(s => s.id === sel);
  // Map step → yaml line
  const stepLine = { input: 0, filter0: 4, closure0: 12, scope: 6, tag: 15, downsample: 13, store: 0 };

  return (
    <AppFrame theme={theme} route="/debug/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>debug · vm.yaml</span>
            <Pill tone="info">captured</Pill>
            <Pill tone="dim">30 samples · last 2m</Pill>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost">Inactivate</Btn>
            <Btn theme={theme} kind="ghost" icon="✎">Edit</Btn>
            <Btn theme={theme} kind="primary" icon="↻">Re-capture</Btn>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* YAML with step markers */}
            <div style={{ flex: 1, borderRight: `1px solid ${theme.border}`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{
                padding: '6px 14px', borderBottom: `1px solid ${theme.border}`,
                display: 'flex', alignItems: 'center', gap: 8, fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim, background: theme.bg2,
              }}>
                <span>vm.yaml</span>
                <div style={{ flex: 1 }} />
                <span>click a step to jump →</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <YamlView
                  code={SAMPLE_YAML_MAL}
                  theme={theme}
                  highlightLines={{ [stepLine[sel]]: theme.active }}
                />
              </div>
              <div style={{ borderTop: `1px solid ${theme.border}`, background: theme.bg, padding: '8px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {cap.steps.map(s => (
                  <div key={s.id} onClick={() => setSel(s.id)} style={{
                    fontFamily: RR_FONT_MONO, fontSize: 10.5,
                    padding: '4px 8px', borderRadius: 3, cursor: 'pointer',
                    background: sel === s.id ? theme.active : theme.bg2,
                    color: sel === s.id ? theme.bg : theme.ink2,
                    border: `1px solid ${sel === s.id ? theme.active : theme.border}`,
                  }}>
                    {s.kind} · {s.inCount}→{s.outCount}
                  </div>
                ))}
              </div>
            </div>

            {/* Samples */}
            <div style={{ width: 560, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${theme.border}`, background: theme.bg2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <Pill tone="accent">{selStep.kind}</Pill>
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12.5, color: theme.heading, wordBreak: 'break-word' }}>{selStep.label}</span>
                </div>
                <div style={{ fontSize: 11.5, color: theme.dim, marginTop: 6 }}>{selStep.detail}</div>
                <div style={{ display: 'flex', gap: 14, marginTop: 10, fontFamily: RR_FONT_MONO, fontSize: 11 }}>
                  <span style={{ color: theme.dim }}>in <span style={{ color: theme.ok }}>{selStep.inCount}</span></span>
                  <span style={{ color: theme.dim }}>out <span style={{ color: theme.ok }}>{selStep.outCount}</span></span>
                  <span style={{ color: theme.dim }}>dropped <span style={{ color: selStep.inCount - selStep.outCount > 0 ? theme.warn : theme.ok }}>{selStep.inCount - selStep.outCount}</span></span>
                </div>
              </div>

              <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
                {selStep.id === 'input' ? (
                  <InputFamilyTable theme={theme} highlight="vm-prod-a7" />
                ) : selStep.samples.map((s, i) => {
                  const dropped = s.kept === false;
                  return (
                    <div key={i} style={{
                      background: theme.panel, border: `1px solid ${dropped ? 'rgba(232,113,102,0.35)' : theme.border}`,
                      borderRadius: 4, padding: '8px 10px', marginBottom: 6,
                      display: 'flex', flexDirection: 'column', gap: 4,
                      opacity: dropped ? 0.75 : 1,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Dot tone={dropped ? 'err' : 'ok'} />
                        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink }}>#{i + 1}</span>
                        {dropped && <Pill tone="err">dropped</Pill>}
                        <div style={{ flex: 1 }} />
                        <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.accent }}>
                          {s.value !== undefined ? s.value.toLocaleString?.() ?? s.value : s.avg !== undefined ? s.avg : '—'}
                        </span>
                      </div>
                      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink2, wordBreak: 'break-word' }}>
                        {Object.entries(s).filter(([k]) => !['value', 'avg', 'kept', 'reason'].includes(k)).map(([k, v], j, arr) => (
                          <span key={k}>
                            <span style={{ color: theme.dim }}>{k}=</span>
                            <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            {j < arr.length - 1 && <span style={{ color: theme.dim }}> · </span>}
                          </span>
                        ))}
                      </div>
                      {s.reason && <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.err, paddingLeft: 2 }}>↳ {s.reason}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

Object.assign(window, { DebuggerA_Pipeline, DebuggerB_Waterfall, DebuggerC_DualPane });
