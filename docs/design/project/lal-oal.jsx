// LAL & OAL surfaces — catalog pages + dataset-first debuggers.
// Visual language matches CatalogC_Groups / DebuggerB_Waterfall.

// ── LAL catalog ───────────────────────────────────────────────────────────────
function LalCatalog({ theme = rrDark }) {
  const rows = LAL_RULES;
  const groups = {
    'Runtime overrides':   rows.filter(r => r.origin === 'runtime' && r.status === 'ACTIVE'),
    'Static (from disk)':  rows.filter(r => r.origin === 'static'  && r.status === 'ACTIVE'),
    'Inactive / failing':  rows.filter(r => r.status === 'INACTIVE' || r.err),
  };
  const groupTone = { 'Runtime overrides': 'violet', 'Static (from disk)': 'info', 'Inactive / failing': 'dim' };
  return (
    <AppFrame theme={theme} route="/catalog/lal">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="lal" />
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <div style={{ fontSize: 17, color: theme.heading, fontWeight: 500 }}>lal</div>
            <Pill tone="dim">{rows.length} rules</Pill>
            <Pill tone="violet">{rows.filter(r => r.origin === 'runtime').length} runtime</Pill>
            <Pill tone="info">{rows.filter(r => r.origin === 'static').length} static</Pill>
            <Pill tone="err">{rows.filter(r => r.err).length} failing</Pill>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost" icon="↻">Tick now</Btn>
            <Btn theme={theme} kind="primary" icon="+">New LAL rule</Btn>
          </div>
          <div style={{ fontSize: 11.5, color: theme.dim, fontFamily: RR_FONT_MONO, marginBottom: 18 }}>
            Groovy DSL · filter &#123; parser · extractor · sink &#125; · bound by <span style={{ color: theme.accent }}>layer</span>. Routes LogData → persist /
            metrics-to-MAL / slow-SQL / sampled-trace.
          </div>
          {Object.entries(groups).map(([group, items]) => items.length > 0 && (
            <div key={group} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Pill tone={groupTone[group]}>{group}</Pill>
                <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>{items.length}</span>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {items.map(r => (
                  <div key={r.name} style={{
                    background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 6,
                    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden',
                  }}>
                    {r.err && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: theme.err }} />}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Dot tone={r.err ? 'err' : r.localState === 'SUSPENDED' ? 'warn' : r.status === 'INACTIVE' ? 'dim' : 'ok'} style={{ marginTop: 6 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading, marginBottom: 2 }}>{r.name}</div>
                        <div style={{ fontSize: 10.5, color: theme.dim, fontFamily: RR_FONT_MONO }}>layer <span style={{ color: theme.info }}>{r.layer}</span> · {r.hash}</div>
                      </div>
                      <span style={{ color: theme.dim, fontSize: 14, cursor: 'pointer' }}>⋯</span>
                    </div>
                    <div style={{ fontSize: 11, color: theme.ink2, lineHeight: 1.45 }}>
                      <span style={{ color: theme.dim, fontFamily: RR_FONT_MONO }}>out → </span>
                      <span style={{ fontFamily: RR_FONT_MONO, color: r.outputType.includes('SlowSQL') ? theme.violet : r.outputType.includes('Sampled') ? theme.accent : theme.ink2 }}>{r.outputType}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Pill tone={r.localState === 'RUNNING' ? 'ok' : r.localState === 'SUSPENDED' ? 'warn' : 'dim'}>{r.localState}</Pill>
                      {r.metrics > 0 && <Pill tone="dim">{r.metrics} metrics → MAL</Pill>}
                    </div>
                    {r.err && (
                      <div style={{ fontSize: 10.5, color: theme.err, fontFamily: RR_FONT_MONO, background: 'rgba(232,113,102,0.08)', padding: '5px 8px', borderRadius: 3, border: `1px solid rgba(232,113,102,0.25)` }}>
                        {r.err}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO, paddingTop: 6, borderTop: `1px solid ${theme.border}` }}>
                      <span>{r.author}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ color: theme.accent, cursor: 'pointer' }}>edit →</span>
                      <span style={{ color: theme.dim, cursor: 'pointer' }}>debug ▸</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

// ── OAL catalog ───────────────────────────────────────────────────────────────
function OalCatalog({ theme = rrDark }) {
  const rows = OAL_RULES;
  const groups = {
    'Runtime overrides':     rows.filter(r => r.origin === 'runtime' && r.status === 'ACTIVE'),
    'Static — bundled .oal': rows.filter(r => r.origin === 'static'  && r.status === 'ACTIVE'),
    'Inactive':              rows.filter(r => r.status === 'INACTIVE'),
  };
  const groupTone = { 'Runtime overrides': 'violet', 'Static — bundled .oal': 'info', 'Inactive': 'dim' };
  return (
    <AppFrame theme={theme} route="/catalog/oal">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="oal" />
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <div style={{ fontSize: 17, color: theme.heading, fontWeight: 500 }}>oal</div>
            <Pill tone="dim">{rows.length} scripts</Pill>
            <Pill tone="violet">{rows.filter(r => r.origin === 'runtime').length} runtime</Pill>
            <Pill tone="info">{rows.filter(r => r.origin === 'static').length} static</Pill>
            <Pill tone="accent">{rows.reduce((n, r) => n + r.metrics, 0)} metrics total</Pill>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost" icon="↻">Tick now</Btn>
            <Btn theme={theme} kind="primary" icon="+">New OAL script</Btn>
          </div>
          <div style={{ fontSize: 11.5, color: theme.dim, fontFamily: RR_FONT_MONO, marginBottom: 18 }}>
            <span style={{ color: theme.accent }}>from</span>(<em style={{ color: theme.info }}>Source</em>.field).<span style={{ color: theme.accent }}>filter</span>(…).<span style={{ color: theme.accent }}>aggregation</span>(…). Compiled at boot; runtime overrides hot-swap.
          </div>
          {Object.entries(groups).map(([group, items]) => items.length > 0 && (
            <div key={group} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Pill tone={groupTone[group]}>{group}</Pill>
                <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>{items.length}</span>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {items.map(r => (
                  <div key={r.name} style={{
                    background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 6,
                    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', overflow: 'hidden',
                  }}>
                    {r.suspending && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: theme.warn }} />}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Dot tone={r.localState === 'SUSPENDED' ? 'warn' : r.status === 'INACTIVE' ? 'dim' : 'ok'} style={{ marginTop: 6 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading, marginBottom: 2 }}>{r.name}.oal</div>
                        <div style={{ fontSize: 10.5, color: theme.dim, fontFamily: RR_FONT_MONO }}>layer <span style={{ color: theme.info }}>{r.layer}</span> · {r.hash}</div>
                      </div>
                      <span style={{ color: theme.dim, fontSize: 14, cursor: 'pointer' }}>⋯</span>
                    </div>
                    <div style={{ fontSize: 11, color: theme.ink2, lineHeight: 1.45 }}>{r.note}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Pill tone={r.localState === 'RUNNING' ? 'ok' : r.localState === 'SUSPENDED' ? 'warn' : 'dim'}>{r.localState}</Pill>
                      <Pill tone="dim">{r.metrics} metrics</Pill>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO, paddingTop: 6, borderTop: `1px solid ${theme.border}` }}>
                      <span>{r.author}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ color: theme.accent, cursor: 'pointer' }}>edit →</span>
                      <span style={{ color: theme.dim, cursor: 'pointer' }}>sample ▸</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppFrame>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────
function RowsTable({ theme, cols, rows, pinIdx = 0, valueIdx, flavour }) {
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.panel, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: RR_FONT_MONO, fontSize: 11 }}>
        <thead>
          <tr style={{ background: theme.bg }}>
            {cols.map(c => (
              <th key={c} style={{ textAlign: 'left', padding: '5px 10px', color: theme.dim, fontWeight: 400, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${theme.border}` }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const isPinned = ri === pinIdx;
            const asArr = Array.isArray(r) ? r : cols.map(c => r[c]);
            return (
              <tr key={ri} style={{
                background: isPinned ? 'rgba(255,180,80,0.08)' : 'transparent',
                borderLeft: isPinned ? `2px solid ${theme.accent}` : '2px solid transparent',
              }}>
                {asArr.map((cell, ci) => {
                  const isValue = ci === (valueIdx ?? asArr.length - 1);
                  return (
                    <td key={ci} style={{
                      padding: '5px 10px',
                      color: cell === false ? theme.err : cell === true ? theme.ok : (isValue ? theme.accent : (isPinned ? theme.heading : theme.ink2)),
                      borderBottom: ri < rows.length - 1 ? `1px solid ${theme.border}` : 'none',
                      whiteSpace: 'nowrap', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{typeof cell === 'boolean' ? (cell ? 'true' : 'false') : String(cell)}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {flavour && (
        <div style={{ padding: '6px 10px', borderTop: `1px dashed ${theme.border}`, fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim, background: theme.bg }}>{flavour}</div>
      )}
    </div>
  );
}

function StageLabel({ theme, kind, label, inCount, outCount, active, onClick }) {
  return (
    <div onClick={onClick} style={{ padding: '14px 12px 14px 0', cursor: onClick ? 'pointer' : 'default', borderLeft: active ? `2px solid ${theme.accent}` : '2px solid transparent', paddingLeft: 10 }}>
      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: active ? theme.accent : theme.dim, letterSpacing: 1, textTransform: 'uppercase' }}>{kind}</div>
      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading, marginTop: 4, wordBreak: 'break-word' }}>{label}</div>
      {inCount !== undefined && (
        <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim, marginTop: 6 }}>
          {inCount} <span style={{ color: theme.ink2 }}>→</span> <span style={{ color: outCount < inCount ? theme.warn : theme.ok }}>{outCount}</span>
        </div>
      )}
    </div>
  );
}

function StageRail({ theme }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: theme.border2, marginLeft: -1 }} />
      <div style={{ position: 'absolute', left: '50%', top: 22, width: 10, height: 10, borderRadius: '50%', background: theme.accent, marginLeft: -5, boxShadow: `0 0 0 3px ${theme.bg}` }} />
    </div>
  );
}

// ── LAL debugger · per-record × per-block grid ───────────────────────────────
// LAL processes one log line at a time. So the debugger is a matrix:
//   columns = sampled records (≤ ~10), rows = blocks (text/parser/extractor/sink/output-log/output-metric).
// Each cell shows what the record looks like at that block's boundary.
// Operator toggles which blocks are sampled via header chips.
function LalDebugger({ theme = rrDark }) {
  const cap = SAMPLE_LAL_CAPTURE;
  const [enabled, setEnabled] = React.useState({ text: true, parser: true, extractor: true, sink: true, output_log: true, output_metric: true });
  const toggle = (id) => setEnabled(e => ({ ...e, [id]: !e[id] }));
  const [pinned, setPinned] = React.useState(cap.records[0].id);
  const records = cap.records;

  const colW = 184;  // column width per record
  const labelW = 200;

  // cell renderer per (block, record)
  const cellFor = (blockId, rec) => {
    if (!enabled[blockId]) return <CellOff theme={theme} />;
    if (blockId === 'text') {
      const body = rec.text;
      return (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim }}>
            <span>{rec.ts}</span>
            <span style={{ color: theme.info }}>{rec.svc}</span>
          </div>
          <div style={{
            fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.ink2, lineHeight: 1.4,
            background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 3,
            padding: '6px 7px', height: 62, overflow: 'hidden',
            whiteSpace: 'normal', wordBreak: 'break-all',
          }}>{body}</div>
        </div>
      );
    }
    if (blockId === 'parser') {
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Pill tone="ok">parsed</Pill>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim }}>{rec.parsed.keys.length} keys</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {rec.parsed.keys.map(k => (
              <span key={k} style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.accent, background: 'rgba(243,179,90,0.08)', padding: '1px 5px', borderRadius: 2, border: `1px solid ${theme.border}` }}>{k}</span>
            ))}
          </div>
        </div>
      );
    }
    if (blockId === 'extractor') {
      const e = rec.extracted;
      return <KvStack theme={theme} entries={[
        ['service', e.service],
        ['instance', e.instance],
        ['endpoint', e.endpoint],
        ['status.code', e['status.code']],
        ['resp.flags', e['resp.flags']],
      ]} />;
    }
    if (blockId === 'sink') {
      const s = rec.sink;
      const tone = s.kept ? (s.branch === 'enforcer' ? 'err' : 'ok') : 'dim';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill tone={tone}>{s.branch}</Pill>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: s.kept ? theme.ok : theme.err }}>{s.kept ? 'kept' : 'dropped'}</span>
          </div>
          <div style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim, lineHeight: 1.4 }}>{s.note}</div>
        </div>
      );
    }
    if (blockId === 'output_log') {
      if (!rec.logData) {
        return <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, fontStyle: 'italic', padding: '6px 2px' }}>— nothing emitted (sink dropped)</div>;
      }
      const d = rec.logData;
      return <KvStack theme={theme} entries={[
        ['service', d.service],
        ['endpoint', d.endpoint],
        ['status.code', d['status.code']],
        ['timestamp', d.timestamp],
      ]} />;
    }
    if (blockId === 'output_metric') {
      const m = rec.metric;
      return (
        <div>
          <div style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim, marginBottom: 4 }}>mesh_access_log_count</div>
          <KvStack theme={theme} entries={[
            ['service', m.service],
            ['endpoint', m.endpoint],
            ['status.code', m['status.code']],
            ['delta', '+' + m.delta],
          ]} highlight="delta" />
        </div>
      );
    }
    return null;
  };

  return (
    <AppFrame theme={theme} route={`/debug/lal/${cap.rule}`}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="lal" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>debug · lal / {cap.rule}</span>
            <Pill tone="info">layer {cap.layer}</Pill>
            <Pill tone="dim">{cap.window}</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>sample blocks:</span>
            {[['text','text'],['parser','parser'],['extractor','extractor'],['sink','sink'],['output_log','output·log'],['output_metric','output·metric']].map(([id, lbl]) => (
              <span key={id} onClick={() => toggle(id)} style={{
                padding: '3px 8px', borderRadius: 3, fontFamily: RR_FONT_MONO, fontSize: 10.5, cursor: 'pointer',
                background: enabled[id] ? 'rgba(243,179,90,0.16)' : 'transparent',
                color: enabled[id] ? theme.accent : theme.dim,
                border: `1px solid ${enabled[id] ? theme.accentDim : theme.border}`,
              }}>{lbl}</span>
            ))}
            <Btn theme={theme} kind="primary" icon="↻">Sample</Btn>
          </div>

          {/* matrix */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ minWidth: labelW + records.length * colW + 40 }}>
              {/* record header row */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 2,
                display: 'grid', gridTemplateColumns: `${labelW}px repeat(${records.length}, ${colW}px)`,
                background: theme.bg2, borderBottom: `1px solid ${theme.border}`,
              }}>
                <div style={{ padding: '10px 14px', fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', borderRight: `1px solid ${theme.border}` }}>
                  block ▾ / record →
                </div>
                {records.map(r => (
                  <div key={r.id} onClick={() => setPinned(r.id)} style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: pinned === r.id ? 'rgba(243,179,90,0.12)' : 'transparent',
                    borderRight: `1px solid ${theme.border}`,
                    borderBottom: pinned === r.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                  }}>
                    <div style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: pinned === r.id ? theme.heading : theme.ink, fontWeight: 500 }}>
                      {r.id} <span style={{ color: theme.dim, fontWeight: 400 }}>· {r.ts}</span>
                    </div>
                    <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.info, marginTop: 2 }}>{r.svc}</div>
                  </div>
                ))}
              </div>

              {/* block rows */}
              {cap.blocks.map((b, bi) => {
                const on = enabled[b.id];
                const isLast = bi === cap.blocks.length - 1;
                return (
                  <div key={b.id} style={{
                    display: 'grid',
                    gridTemplateColumns: `${labelW}px repeat(${records.length}, ${colW}px)`,
                    borderBottom: isLast ? 'none' : `1px solid ${theme.border}`,
                    background: on ? 'transparent' : theme.bg,
                  }}>
                    {/* block label */}
                    <div onClick={() => toggle(b.id)} style={{
                      padding: '12px 14px',
                      borderRight: `1px solid ${theme.border}`,
                      borderLeft: on ? `2px solid ${theme.accent}` : '2px solid transparent',
                      cursor: 'pointer',
                      opacity: on ? 1 : 0.55,
                    }}>
                      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: on ? theme.accent : theme.dim, letterSpacing: 1, textTransform: 'uppercase' }}>{b.kind}</div>
                      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.heading, marginTop: 4, lineHeight: 1.3, wordBreak: 'break-word' }}>{b.label}</div>
                      <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, marginTop: 6, lineHeight: 1.45 }}>{b.detail}</div>
                    </div>
                    {records.map(r => (
                      <div key={r.id} style={{
                        padding: '10px 10px',
                        background: pinned === r.id ? 'rgba(243,179,90,0.06)' : 'transparent',
                        borderRight: `1px solid ${theme.border}`,
                        borderLeft: pinned === r.id ? `1px solid ${theme.accentDim}` : '1px solid transparent',
                      }}>
                        {cellFor(b.id, r)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function CellOff({ theme }) {
  return (
    <div style={{
      fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim,
      padding: '6px 8px', border: `1px dashed ${theme.border}`, borderRadius: 3, textAlign: 'center', opacity: 0.7,
    }}>sampling off</div>
  );
}

function KvStack({ theme, entries, highlight }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {entries.map(([k, v]) => {
        const isNull = v === null || v === undefined || v === '';
        const isHl = k === highlight;
        return (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 4, alignItems: 'baseline' }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 9.5, color: theme.dim }}>{k}</span>
            <span style={{
              fontFamily: RR_FONT_MONO, fontSize: 10,
              color: isNull ? theme.dim : isHl ? theme.accent : theme.ink,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{isNull ? '—' : String(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── OAL debugger · pick a rule, configure sampling ────────────────────────────
function OalDebugger({ theme = rrDark }) {
  const cap = SAMPLE_OAL_CAPTURE;
  const [maxRows, setMaxRows] = React.useState(cap.sampleRequest.maxRows);
  const [win, setWin] = React.useState(cap.sampleRequest.windowSec);

  const renderStage = (s) => {
    if (s.id === 'filter') {
      return (
        <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 6, background: theme.panel, padding: '12px 14px', color: theme.dim, fontSize: 12, fontFamily: RR_FONT_MONO }}>
          <div style={{ color: theme.ink2, marginBottom: 6 }}>{s.note}</div>
          <div>Cardinality preserved · <span style={{ color: theme.ok }}>{s.inCount}</span> <span style={{ color: theme.ink2 }}>→</span> <span style={{ color: theme.ok }}>{s.outCount}</span></div>
        </div>
      );
    }
    return (
      <div style={{ border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.panel, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8, background: theme.bg }}>
          <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 0.5, textTransform: 'uppercase' }}>{s.kind}</span>
          <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink }}>{s.label}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>{s.rows.length} rows</span>
        </div>
        <RowsTable theme={theme} cols={s.cols} rows={s.rows} pinIdx={0} valueIdx={s.cols.length - 1} />
      </div>
    );
  };

  return (
    <AppFrame theme={theme} route={`/debug/oal/${cap.rule}`}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="oal" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>sample · oal / {cap.script}</span>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>rule:</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 3, fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.heading }}>
              {cap.rule} <span style={{ color: theme.dim }}>▾</span>
            </div>
            <Pill tone="info">scope {cap.sourceScope}</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>max rows</span>
            <input type="number" value={maxRows} onChange={e => setMaxRows(+e.target.value)}
              style={{ width: 48, background: theme.bg2, border: `1px solid ${theme.border}`, color: theme.ink, fontFamily: RR_FONT_MONO, fontSize: 11, padding: '3px 6px', borderRadius: 3 }} />
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>window (s)</span>
            <input type="number" value={win} onChange={e => setWin(+e.target.value)}
              style={{ width: 48, background: theme.bg2, border: `1px solid ${theme.border}`, color: theme.ink, fontFamily: RR_FONT_MONO, fontSize: 11, padding: '3px 6px', borderRadius: 3 }} />
            <Btn theme={theme} kind="primary" icon="▶">Start sampling</Btn>
          </div>

          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg2, fontFamily: RR_FONT_MONO, fontSize: 12 }}>
            <span style={{ color: theme.dim }}># line from </span>
            <span style={{ color: theme.info }}>{cap.script}</span>
            <span style={{ color: theme.dim }}> · sampling started from this rule</span>
            <div style={{ marginTop: 4, color: theme.heading }}>{cap.expression}</div>
            <div style={{ marginTop: 4, color: theme.dim }}>{cap.window}</div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '18px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '170px 40px 1fr', gap: 0 }}>
              {cap.stages.map((s, i) => (
                <React.Fragment key={s.id}>
                  <div style={{ borderBottom: i < cap.stages.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                    <StageLabel theme={theme} kind={s.kind} label={s.label.split(' — ')[0]} inCount={s.inCount} outCount={s.outCount} />
                    <div style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO, paddingRight: 12, lineHeight: 1.5 }}>{s.detail}</div>
                  </div>
                  <div style={{ borderBottom: i < cap.stages.length - 1 ? `1px solid ${theme.border}` : 'none' }}><StageRail theme={theme} /></div>
                  <div style={{ padding: '14px 0 14px 16px', borderBottom: i < cap.stages.length - 1 ? `1px solid ${theme.border}` : 'none' }}>
                    {renderStage(s)}
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

Object.assign(window, { LalCatalog, OalCatalog, LalDebugger, OalDebugger });
