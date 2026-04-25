// Catalog browser — 3 variations
// A: dense table (Linear/Datadog feel)
// B: terminal-style columnar view (mono-heavy)
// C: card grid grouped by status + origin

function CatalogA_Table({ theme = rrDark }) {
  const rows = RULES.filter(r => r.catalog === 'otel-rules');
  return (
    <AppFrame theme={theme} route="/catalog/otel-rules">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Toolbar */}
          <div style={{
            padding: '12px 18px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 10, background: theme.bg,
          }}>
            <div>
              <div style={{ fontSize: 15, color: theme.heading, fontWeight: 500 }}>otel-rules</div>
              <div style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO, marginTop: 2 }}>
                {rows.length} rules · 8 runtime · {rows.filter(r => r.status === 'ACTIVE').length} active
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: theme.bg2, border: `1px solid ${theme.border}`,
              borderRadius: 4, padding: '5px 10px', width: 280,
            }}>
              <span style={{ color: theme.dim, fontFamily: RR_FONT_MONO, fontSize: 12 }}>⌕</span>
              <span style={{ color: theme.dim, fontSize: 12 }}>filter by name, author, hash…</span>
              <div style={{ flex: 1 }} />
              <span style={{
                fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim,
                border: `1px solid ${theme.border2}`, padding: '1px 5px', borderRadius: 3,
              }}>⌘K</span>
            </div>
            <Btn theme={theme} kind="ghost" icon="⇅">Dump</Btn>
            <Btn theme={theme} kind="primary" icon="+">New rule</Btn>
          </div>

          {/* Filter chips */}
          <div style={{
            padding: '8px 18px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 8, background: theme.bg,
          }}>
            <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>where</span>
            <Pill tone="accent">status : ACTIVE</Pill>
            <Pill tone="dim">origin : any</Pill>
            <Pill tone="dim">+ add filter</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>sort · updated ↓</span>
          </div>

          {/* Table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '24px 2fr 110px 120px 120px 1fr 70px 110px 32px',
              padding: '8px 18px', fontFamily: RR_FONT_MONO, fontSize: 10,
              color: theme.dim, letterSpacing: 0.8, textTransform: 'uppercase',
              borderBottom: `1px solid ${theme.border}`, gap: 12,
            }}>
              <span></span>
              <span>name</span>
              <span>status</span>
              <span>local</span>
              <span>hash</span>
              <span>author · updated</span>
              <span style={{ textAlign: 'right' }}>metrics</span>
              <span>origin</span>
              <span></span>
            </div>
            {rows.map((r, i) => (
              <div key={r.name} style={{
                display: 'grid',
                gridTemplateColumns: '24px 2fr 110px 120px 120px 1fr 70px 110px 32px',
                padding: '11px 18px', alignItems: 'center', gap: 12,
                borderBottom: `1px solid ${theme.border}`,
                background: i === 2 ? theme.bg2 : 'transparent',
              }}>
                <Dot tone={r.err ? 'err' : r.localState === 'SUSPENDED' ? 'warn' : r.status === 'INACTIVE' ? 'dim' : 'ok'} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading }}>{r.name}</span>
                  {r.err && <Pill tone="err" style={{ fontSize: 10 }}>apply error</Pill>}
                </div>
                <Pill tone={r.status === 'ACTIVE' ? 'ok' : 'dim'}>{r.status}</Pill>
                <Pill tone={r.localState === 'RUNNING' ? 'ok' : r.localState === 'SUSPENDED' ? 'warn' : 'dim'}>{r.localState}</Pill>
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11.5, color: theme.ink2 }}>{r.hash}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: theme.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.author}</span>
                  <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>{r.updated}</span>
                </div>
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.ink2, textAlign: 'right' }}>{r.metrics}</span>
                <Pill tone={r.origin === 'runtime' ? 'violet' : 'dim'}>{r.origin}</Pill>
                <span style={{ color: theme.dim, textAlign: 'center', cursor: 'pointer' }}>⋯</span>
              </div>
            ))}
          </div>

          {/* Status bar */}
          <div style={{
            padding: '6px 18px', borderTop: `1px solid ${theme.border}`,
            fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim,
            display: 'flex', alignItems: 'center', gap: 14, background: theme.bg2,
          }}>
            <span><Dot tone="ok" size={5} style={{ marginRight: 6 }} />reconciler tick · 12s ago</span>
            <span>·</span>
            <span>next tick in 18s</span>
            <div style={{ flex: 1 }} />
            <span>4 nodes converged</span>
            <span>·</span>
            <span>last broadcast · suspend k8s/node · 31s ago</span>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function CatalogB_Terminal({ theme = rrDark }) {
  const rows = RULES.filter(r => r.catalog === 'otel-rules');
  // Cave-diver style: everything mono, column alignment, terminal prompt
  const col = (s, w) => String(s).padEnd(w);
  return (
    <AppFrame theme={theme} route="/catalog/otel-rules">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', overflow: 'auto' }}>
          <div style={{ fontFamily: RR_FONT_MONO, fontSize: 12, lineHeight: 1.75, color: theme.ink }}>
            <div style={{ color: theme.dim, marginBottom: 8 }}>
              <span style={{ color: theme.active }}>❯</span> rr list <span style={{ color: theme.info }}>--catalog=otel-rules</span> <span style={{ color: theme.info }}>--status=active</span>
            </div>
            <div style={{ color: theme.dim, marginBottom: 14, fontSize: 11 }}>
              # 8 rules · last tick 12s ago · 4 nodes converged
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '18px 2.4fr 90px 110px 110px 80px 90px', gap: 14,
              padding: '6px 0', borderBottom: `1px dashed ${theme.border2}`,
              color: theme.dim, fontSize: 10.5, letterSpacing: 0.5, textTransform: 'uppercase',
            }}>
              <span></span>
              <span>name</span>
              <span>status</span>
              <span>local</span>
              <span>hash</span>
              <span style={{ textAlign: 'right' }}>metrics</span>
              <span>origin</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.name} style={{
                display: 'grid', gridTemplateColumns: '18px 2.4fr 90px 110px 110px 80px 90px', gap: 14,
                padding: '8px 0', borderBottom: `1px dashed ${theme.border}`, alignItems: 'center',
              }}>
                <span style={{ color: r.err ? theme.err : r.localState === 'SUSPENDED' ? theme.warn : r.status === 'INACTIVE' ? theme.dim : theme.ok }}>
                  {r.err ? '✖' : r.localState === 'SUSPENDED' ? '◐' : r.status === 'INACTIVE' ? '·' : '●'}
                </span>
                <span style={{ color: theme.heading }}>{r.name}</span>
                <span style={{ color: r.status === 'ACTIVE' ? theme.ok : theme.dim }}>{r.status}</span>
                <span style={{ color: r.localState === 'RUNNING' ? theme.ok : r.localState === 'SUSPENDED' ? theme.warn : theme.dim }}>{r.localState}</span>
                <span style={{ color: theme.ink2 }}>{r.hash}</span>
                <span style={{ color: theme.ink, textAlign: 'right' }}>{r.metrics}</span>
                <span style={{ color: r.origin === 'runtime' ? theme.violet : theme.dim }}>{r.origin}</span>
              </div>
            ))}
            <div style={{ marginTop: 16, color: theme.dim, fontSize: 11 }}>
              <div>
                <span style={{ color: theme.err }}>warn</span> kafka · applyError: ddl_verify_failed on oap-03 · 21s ago
              </div>
              <div>
                <span style={{ color: theme.warn }}>info</span> k8s/node · SUSPENDED · structural apply in progress
              </div>
            </div>
            <div style={{ marginTop: 20, color: theme.dim, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: theme.active }}>❯</span>
              <span style={{ color: theme.info }}>rr </span>
              <span style={{ background: theme.bg3, color: theme.heading, padding: '1px 6px', borderRadius: 2 }}>
                debug <span style={{ color: theme.dim }}>--rule=vm --tail</span>
              </span>
              <span style={{ color: theme.dim, fontSize: 10.5, marginLeft: 6 }}>⏎ to run</span>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function CatalogC_Groups({ theme = rrDark }) {
  const byStatus = {
    'Runtime overrides': RULES.filter(r => r.origin === 'runtime' && r.status === 'ACTIVE').slice(0, 6),
    'Static (from disk)': RULES.filter(r => r.origin === 'static').slice(0, 4),
    'Inactive (tombstoned)': RULES.filter(r => r.status === 'INACTIVE'),
  };
  const groupTone = {
    'Runtime overrides': 'violet',
    'Static (from disk)': 'info',
    'Inactive (tombstoned)': 'dim',
  };
  return (
    <AppFrame theme={theme} route="/catalog/otel-rules">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" />
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 17, color: theme.heading, fontWeight: 500 }}>otel-rules</div>
            <Pill tone="dim">8 rules</Pill>
            <Pill tone="violet">6 runtime</Pill>
            <Pill tone="info">2 static</Pill>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost" icon="↻">Tick now</Btn>
            <Btn theme={theme} kind="primary" icon="+">New rule</Btn>
          </div>

          {Object.entries(byStatus).map(([group, items]) => (
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
                    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
                    position: 'relative', overflow: 'hidden',
                  }}>
                    {r.err && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: theme.err }} />}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Dot tone={r.err ? 'err' : r.localState === 'SUSPENDED' ? 'warn' : r.status === 'INACTIVE' ? 'dim' : 'ok'} style={{ marginTop: 6 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading, marginBottom: 2 }}>{r.name}</div>
                        <div style={{ fontSize: 10.5, color: theme.dim, fontFamily: RR_FONT_MONO }}>{r.hash} · {r.updated}</div>
                      </div>
                      <span style={{ color: theme.dim, fontSize: 14, cursor: 'pointer' }}>⋯</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Pill tone={r.localState === 'RUNNING' ? 'ok' : r.localState === 'SUSPENDED' ? 'warn' : 'dim'}>{r.localState}</Pill>
                      <Pill tone="dim">{r.metrics} metrics</Pill>
                    </div>
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

Object.assign(window, { CatalogA_Table, CatalogB_Terminal, CatalogC_Groups });
