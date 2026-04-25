// Editor — 3 variations
// A: Split editor / metadata (classic, safe)
// B: Full-bleed editor with floating inspector + inline debug preview
// C: Form-assisted editor (for users who don't want raw YAML)

function EditorA_Split({ theme = rrDark }) {
  const highlights = {
    5: theme.active,     // filter line
    11: theme.ok,        // metric name
    12: theme.accent,    // exp changed
  };
  return (
    <AppFrame theme={theme} route="/edit/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Breadcrumb / file bar */}
          <div style={{
            padding: '10px 16px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 12, background: theme.bg,
          }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>otel-rules</span>
            <span style={{ color: theme.dim }}>›</span>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading }}>vm</span>
            <Pill tone="accent">modified</Pill>
            <Pill tone="ok">ACTIVE</Pill>
            <Pill tone="violet">runtime</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>7c3a91… → <span style={{ color: theme.accent }}>(pending)</span></span>
            <Btn theme={theme} kind="ghost">Cancel</Btn>
            <Btn theme={theme} kind="ghost" icon="✓">Validate</Btn>
            <Btn theme={theme} kind="primary" icon="↑">addOrUpdate</Btn>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* Editor */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: `1px solid ${theme.border}` }}>
              <div style={{
                padding: '6px 14px', borderBottom: `1px solid ${theme.border}`,
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: theme.dim,
                fontFamily: RR_FONT_MONO, background: theme.bg2,
              }}>
                <span>vm.yaml</span>
                <div style={{ flex: 1 }} />
                <span>3 metrics · 47 lines · LF · UTF-8</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
                <YamlView code={SAMPLE_YAML_MAL} theme={theme} highlightLines={highlights} />
              </div>

              {/* Assistant / validation strip */}
              <div style={{
                borderTop: `1px solid ${theme.border}`, background: theme.bg2,
                padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Pill tone="ok">syntax ok</Pill>
                  <Pill tone="info">dsl resolved · 3 metrics</Pill>
                  <Pill tone="accent">1 suggestion</Pill>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>lints from oap-01</span>
                </div>
                <div style={{ fontSize: 11.5, color: theme.ink2, fontFamily: RR_FONT_MONO, display: 'flex', gap: 10 }}>
                  <span style={{ color: theme.accent }}>line 12</span>
                  <span>binary op on mismatched label sets — consider <span style={{ color: theme.info }}>.onLabels(['host'])</span></span>
                </div>
              </div>
            </div>

            {/* Inspector */}
            <div style={{ width: 320, flexShrink: 0, background: theme.bg, display: 'flex', flexDirection: 'column' }}>
              <Section kicker="identity" title="Rule" theme={theme}>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[['catalog', 'otel-rules'], ['name', 'vm'], ['status', 'ACTIVE'], ['local', 'RUNNING on 4 nodes'], ['current hash', '7c3a91…'], ['author', 'ops@tetrate · 2m ago']].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12 }}>
                      <span style={{ width: 80, color: theme.dim, fontFamily: RR_FONT_MONO, fontSize: 11 }}>{k}</span>
                      <span style={{ color: theme.ink, fontFamily: RR_FONT_MONO, fontSize: 11.5 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section kicker="delta" title="Pending change classifier" theme={theme}>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Pill tone="ok">FILTER_ONLY</Pill>
                    <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>fast path</span>
                  </div>
                  <div style={{ fontSize: 12, color: theme.ink2, lineHeight: 1.6, marginBottom: 12 }}>
                    No metric set change, no scope change, no downsampling change.
                    Safe to apply without broadcasting Suspend.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', fontSize: 11.5, fontFamily: RR_FONT_MONO }}>
                    <span style={{ color: theme.dim }}>metrics added</span><span style={{ color: theme.ok }}>0</span>
                    <span style={{ color: theme.dim }}>metrics removed</span><span style={{ color: theme.ok }}>0</span>
                    <span style={{ color: theme.dim }}>scope changes</span><span style={{ color: theme.ok }}>0</span>
                    <span style={{ color: theme.dim }}>downsampling changes</span><span style={{ color: theme.ok }}>0</span>
                    <span style={{ color: theme.dim }}>filter/exp changes</span><span style={{ color: theme.accent }}>1</span>
                    <span style={{ color: theme.dim }}>allowStorageChange</span><span style={{ color: theme.ok }}>not needed</span>
                  </div>
                </div>
              </Section>
              <Section kicker="peers" title="Cluster effect" theme={theme}>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, fontFamily: RR_FONT_MONO }}>
                  {CLUSTER_NODES.map(n => (
                    <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Dot tone="ok" />
                      <span style={{ color: theme.ink, width: 64 }}>{n.id}</span>
                      <span style={{ color: theme.dim }}>will swap on next tick</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ color: theme.dim }}>~{n.lastTick}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function EditorB_FullBleed({ theme = rrDark }) {
  // full-width editor, floating inspector, inline live-debug preview
  const highlights = { 11: theme.active, 15: theme.active };
  return (
    <AppFrame theme={theme} route="/edit/otel-rules/vm">
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '10px 18px', borderBottom: `1px solid ${theme.border}`,
          display: 'flex', alignItems: 'center', gap: 12, background: theme.bg,
        }}>
          <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>otel-rules / vm.yaml</span>
          <Pill tone="violet">runtime</Pill>
          <Pill tone="ok">ACTIVE · RUNNING on 4</Pill>
          <div style={{ flex: 1 }} />
          <Btn theme={theme} kind="ghost" icon="⊞">History</Btn>
          <Btn theme={theme} kind="ghost" icon="▷">Debug</Btn>
          <Btn theme={theme} kind="ghost">Inactivate</Btn>
          <Btn theme={theme} kind="primary" icon="↑">Apply</Btn>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 64px', overflow: 'auto' }}>
            <div style={{
              background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6,
              padding: '16px 0', boxShadow: '0 1px 0 rgba(255,255,255,0.02)',
            }}>
              <YamlView code={SAMPLE_YAML_MAL} theme={theme} highlightLines={highlights} fontSize={13} />
            </div>

            {/* Inline preview: what will flow out */}
            <div style={{ marginTop: 20 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
              }}>
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase' }}>
                  inline preview · from oap-01 capture · last 30 samples
                </span>
                <div style={{ flex: 1, height: 1, background: theme.border }} />
                <Pill tone="info">captured · 8s ago</Pill>
              </div>
              <div style={{
                background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6,
                padding: '14px 18px', fontFamily: RR_FONT_MONO, fontSize: 12,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '160px 80px 1fr', rowGap: 6, columnGap: 14, color: theme.ink2 }}>
                  <div style={{ color: theme.dim, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.8 }}>metric</div>
                  <div style={{ color: theme.dim, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'right' }}>value</div>
                  <div style={{ color: theme.dim, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.8 }}>entity · tags</div>
                  {[
                    ['vm_memory_available_percent', '50.14', 'vm-prod-a7 · {layer=VM}'],
                    ['vm_memory_available_percent', '37.08', 'vm-prod-b1 · {layer=VM}'],
                    ['vm_memory_available_percent', '67.22', 'vm-prod-c4 · {layer=VM}'],
                    ['vm_cpu_used_percent', '22.10', 'vm-prod-a7 · {layer=VM}'],
                    ['vm_disk_total_bytes', '5.12e11', 'vm-prod-a7 · {mount=/, layer=VM}'],
                  ].map(([m, v, e], i) => (
                    <React.Fragment key={i}>
                      <span style={{ color: theme.heading }}>{m}</span>
                      <span style={{ color: theme.accent, textAlign: 'right' }}>{v}</span>
                      <span style={{ color: theme.ink2 }}>{e}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Floating inspector column */}
          <div style={{
            width: 300, flexShrink: 0, borderLeft: `1px solid ${theme.border}`,
            background: theme.bg, padding: '18px 16px', overflow: 'auto',
          }}>
            <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
              dsl assistant
            </div>
            <div style={{ background: theme.bg2, borderRadius: 5, padding: '10px 12px', border: `1px solid ${theme.border}`, fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>
              <div style={{ color: theme.accent, fontFamily: RR_FONT_MONO, fontSize: 10.5, marginBottom: 4 }}>suggest · line 11</div>
              <div style={{ color: theme.ink }}>
                Align label sets before binary op:
              </div>
              <div style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.info, marginTop: 6, background: theme.bg3, padding: '6px 8px', borderRadius: 3 }}>
                node_memory_MemAvailable_bytes<span style={{ color: theme.active }}>.onLabels(['host'])</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Btn theme={theme} kind="solid" style={{ fontSize: 11, padding: '3px 8px' }}>Apply fix</Btn>
                <Btn theme={theme} kind="ghost" style={{ fontSize: 11, padding: '3px 8px' }}>Dismiss</Btn>
              </div>
            </div>

            <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 10 }}>
              classifier
            </div>
            <div style={{ fontSize: 12, color: theme.ink2, lineHeight: 1.55, marginBottom: 8 }}>
              This change is classified as <span style={{ color: theme.ok, fontFamily: RR_FONT_MONO }}>FILTER_ONLY</span> — local swap, no Suspend, no DDL.
            </div>

            <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 18 }}>
              dsl reference
            </div>
            {['filter({ tags -> …})', 'tagEqual(k, v)', '.sum([labels])', '.rate([window])', '.downsampling(AVG|SUM|LATEST|MAX)', 'instance([labels], Layer)', 'service([labels], Layer)', 'endpoint([labels], Layer)'].map(x => (
              <div key={x} style={{ fontFamily: RR_FONT_MONO, fontSize: 11.5, color: theme.ink2, padding: '4px 6px', borderRadius: 3, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = theme.bg2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {x}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function EditorC_FormAssisted({ theme = rrDark }) {
  return (
    <AppFrame theme={theme} route="/edit/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 18px', borderBottom: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 12, background: theme.bg,
          }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>otel-rules / vm</span>
            <div style={{ display: 'flex', background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 4, padding: 2 }}>
              {['Form', 'YAML', 'Diff'].map((t, i) => (
                <span key={t} style={{
                  fontSize: 11.5, padding: '3px 10px', borderRadius: 3,
                  background: i === 0 ? theme.bg3 : 'transparent',
                  color: i === 0 ? theme.heading : theme.dim,
                  fontFamily: RR_FONT_MONO, cursor: 'pointer',
                }}>{t}</span>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost">Cancel</Btn>
            <Btn theme={theme} kind="primary" icon="↑">Apply</Btn>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '22px 32px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
            <FormRow label="filter" hint="jq-like predicate applied before metric evaluation" theme={theme}>
              <code style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.ink, background: theme.bg2, padding: '8px 10px', borderRadius: 4, border: `1px solid ${theme.border}`, display: 'block' }}>
                {'{ tags -> tags.job == \'node-exporter\' }'}
              </code>
            </FormRow>
            <FormRow label="scope" hint="binds each sample to an entity" theme={theme}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Select val="instance" opts={['instance', 'service', 'endpoint', 'serviceInstance']} theme={theme} />
                <Select val="host" opts={['host', 'pod', 'service.name']} theme={theme} />
                <Select val="Layer.VM" opts={['Layer.VM', 'Layer.GENERAL', 'Layer.K8S']} theme={theme} />
              </div>
            </FormRow>
            <FormRow label="metric prefix" theme={theme}>
              <code style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.ink, background: theme.bg2, padding: '6px 10px', borderRadius: 4, border: `1px solid ${theme.border}`, width: 140 }}>vm</code>
            </FormRow>

            <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginTop: 8 }}>
              metrics · 3
            </div>
            {[
              { name: 'memory_available_percent', ds: 'AVG', shape: 'single', ok: true },
              { name: 'cpu_used_percent', ds: 'AVG', shape: 'single', ok: true, changed: true },
              { name: 'disk_total_bytes', ds: 'LATEST', shape: 'labeled · host', ok: true },
            ].map(m => (
              <div key={m.name} style={{
                background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6,
                padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Dot tone={m.ok ? 'ok' : 'err'} />
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading }}>vm_{m.name}</span>
                  {m.changed && <Pill tone="accent">modified</Pill>}
                  <div style={{ flex: 1 }} />
                  <Pill tone="info">downsampling · {m.ds}</Pill>
                  <Pill tone="dim">{m.shape}</Pill>
                </div>
                <div style={{
                  fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.ink2,
                  background: theme.bg2, padding: '8px 10px', borderRadius: 4,
                  border: `1px solid ${theme.border}`,
                }}>
                  <span style={{ color: theme.dim, marginRight: 6 }}>exp</span>
                  {m.name === 'memory_available_percent' && <>node_memory_MemAvailable_bytes<span style={{ color: theme.active }}>.tagEqual('region', 'us-east-1')</span> * 100 / node_memory_MemTotal_bytes</>}
                  {m.name === 'cpu_used_percent' && <>(1 - avg(rate(node_cpu_seconds_total{'{mode=\'idle\'}'}[1m]))) * 100</>}
                  {m.name === 'disk_total_bytes' && <>node_filesystem_size_bytes.tagEqual('mountpoint', '/').sum(['host'])</>}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: theme.dim, fontFamily: RR_FONT_MONO, cursor: 'pointer', padding: '8px 0' }}>+ add metric</div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function FormRow({ label, hint, theme, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 20, alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: 12, color: theme.heading, fontFamily: RR_FONT_MONO }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: theme.dim, marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
function Select({ val, opts, theme }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 4,
      padding: '5px 10px', fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.ink, cursor: 'pointer',
    }}>
      <span>{val}</span>
      <span style={{ color: theme.dim, fontSize: 10 }}>▾</span>
    </div>
  );
}

Object.assign(window, { EditorA_Split, EditorB_FullBleed, EditorC_FormAssisted });
