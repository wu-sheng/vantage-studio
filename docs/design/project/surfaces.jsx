// Cluster · History · Dump · Destructive confirm

function ClusterStatus({ theme = rrDark }) {
  return (
    <AppFrame theme={theme} route="/cluster">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="cluster" compact />
        <div style={{ flex: 1, padding: '20px 26px', overflow: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{ fontSize: 17, color: theme.heading, fontWeight: 500 }}>Cluster & reconciler</div>
            <Pill tone="ok">converged</Pill>
            <Pill tone="dim">4 nodes</Pill>
            <Pill tone="violet">oap-01 · main</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>tick interval 30s · self-heal 60s</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
            {CLUSTER_NODES.map(n => (
              <div key={n.id} style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Dot tone={n.state === 'HEALTHY' ? 'ok' : 'warn'} />
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 13, color: theme.heading }}>{n.id}</span>
                  {n.role === 'MAIN' && <Pill tone="accent">MAIN</Pill>}
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim }}>{n.ip}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontFamily: RR_FONT_MONO, fontSize: 11 }}>
                  <span style={{ color: theme.dim }}>uptime</span><span style={{ color: theme.ink2 }}>{n.up}</span>
                  <span style={{ color: theme.dim }}>last tick</span><span style={{ color: theme.ink2 }}>{n.lastTick} ago</span>
                  <span style={{ color: theme.dim }}>state</span>
                  <span style={{ color: n.state === 'HEALTHY' ? theme.ok : theme.warn }}>{n.state}{n.drift ? ` · ${n.drift} drifted` : ''}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            per-rule state · across nodes
          </div>
          <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr repeat(4, 1fr) 120px', padding: '9px 14px', fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 0.8, textTransform: 'uppercase', borderBottom: `1px solid ${theme.border}`, gap: 10 }}>
              <span>rule</span>
              {CLUSTER_NODES.map(n => <span key={n.id}>{n.id}</span>)}
              <span>content hash</span>
            </div>
            {RULES.filter(r => r.catalog === 'otel-rules' && r.status === 'ACTIVE').slice(0, 6).map(r => (
              <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '1.5fr repeat(4, 1fr) 120px', padding: '10px 14px', gap: 10, borderBottom: `1px solid ${theme.border}`, alignItems: 'center' }}>
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.heading }}>{r.name}</span>
                {CLUSTER_NODES.map((n, i) => {
                  const sus = r.localState === 'SUSPENDED' && i < 2;
                  const err = r.err && i === 2;
                  return (
                    <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Dot tone={err ? 'err' : sus ? 'warn' : 'ok'} />
                      <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: err ? theme.err : sus ? theme.warn : theme.ink2 }}>
                        {err ? 'ddl_verify_fail' : sus ? 'SUSPENDED' : 'RUNNING'}
                      </span>
                    </div>
                  );
                })}
                <span style={{ fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.ink2 }}>{r.hash}</span>
              </div>
            ))}
          </div>

          {/* Broadcast log */}
          <div style={{ marginTop: 22, fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            recent broadcasts
          </div>
          <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '12px 16px', fontFamily: RR_FONT_MONO, fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              ['31s', 'Suspend', 'k8s/node', 'oap-01 → all peers · 3 acks · 0 rejected'],
              ['2m', 'Commit', 'vm', 'oap-01 · filter_only_applied · cluster converged 9s'],
              ['14m', 'Commit', 'nginx', 'oap-01 · structural_applied · verify OK · 12s roundtrip'],
              ['21s', 'ApplyError', 'kafka', 'oap-03 · ddl_verify_failed · rolled back newly-registered metrics'],
            ].map(([t, k, r, msg], i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ color: theme.dim, width: 34 }}>{t}</span>
                <Pill tone={k === 'Suspend' ? 'warn' : k === 'ApplyError' ? 'err' : 'info'} style={{ minWidth: 76, justifyContent: 'center' }}>{k}</Pill>
                <span style={{ color: theme.heading, width: 120 }}>{r}</span>
                <span style={{ color: theme.ink2, flex: 1 }}>{msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function HistoryDiff({ theme = rrDark }) {
  return (
    <AppFrame theme={theme} route="/history/otel-rules/vm">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="otel-rules" compact />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '10px 18px', borderBottom: `1px solid ${theme.border}`, background: theme.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.dim }}>history · otel-rules / vm</span>
            <Pill tone="dim">12 revisions</Pill>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: theme.dim, fontFamily: RR_FONT_MONO }}>v12 → v11 · comparing</span>
            <Btn theme={theme} kind="ghost" icon="⎘">Copy</Btn>
            <Btn theme={theme} kind="solid" icon="⤺">Restore v11</Btn>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ width: 260, flexShrink: 0, borderRight: `1px solid ${theme.border}`, overflow: 'auto' }}>
              {HISTORY.map((h, i) => (
                <div key={h.id} style={{
                  padding: '10px 14px', borderBottom: `1px solid ${theme.border}`,
                  background: i === 0 ? theme.bg2 : 'transparent', display: 'flex', flexDirection: 'column', gap: 4,
                  borderLeft: i === 0 ? `2px solid ${theme.active}` : '2px solid transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: RR_FONT_MONO, fontSize: 12, color: theme.heading }}>{h.id}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>{h.time}</span>
                  </div>
                  <Pill tone={h.kind === 'structural_applied' ? 'accent' : h.kind === 'filter_only_applied' ? 'ok' : 'info'} style={{ alignSelf: 'flex-start' }}>{h.kind}</Pill>
                  <span style={{ fontSize: 11.5, color: theme.ink2, lineHeight: 1.4 }}>{h.msg}</span>
                  <span style={{ fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim }}>{h.by} · {h.hash}</span>
                </div>
              ))}
            </div>

            {/* Diff view */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 14px', borderBottom: `1px solid ${theme.border}`, background: theme.bg2, display: 'flex', alignItems: 'center', gap: 10, fontFamily: RR_FONT_MONO, fontSize: 11, color: theme.dim }}>
                <span>diff</span>
                <Pill tone="ok">+1</Pill>
                <Pill tone="err">−1</Pill>
                <div style={{ flex: 1 }} />
                <span>classified as FILTER_ONLY · no DDL</span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', fontFamily: RR_FONT_MONO, fontSize: 12 }}>
                {[
                  { t: ' ', line: '# otel-rules/vm.yaml · OTLP MAL rule' },
                  { t: ' ', line: '' },
                  { t: ' ', line: "filter: \"{ tags -> tags.job == 'node-exporter' }\"" },
                  { t: ' ', line: '' },
                  { t: ' ', line: 'metricsRules:' },
                  { t: ' ', line: '  - name: memory_available_percent' },
                  { t: '-', line: "    exp: node_memory_MemAvailable_bytes.tagEqual('region', 'us-east')" },
                  { t: '+', line: "    exp: node_memory_MemAvailable_bytes.tagEqual('region', 'us-east-1')" },
                  { t: ' ', line: '         * 100 / node_memory_MemTotal_bytes' },
                  { t: ' ', line: '    downsampling: AVG' },
                ].map((d, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    background: d.t === '+' ? 'rgba(127,191,122,0.10)' : d.t === '-' ? 'rgba(232,113,102,0.10)' : 'transparent',
                    borderLeft: `2px solid ${d.t === '+' ? theme.ok : d.t === '-' ? theme.err : 'transparent'}`,
                    padding: '1px 0',
                  }}>
                    <span style={{ width: 30, textAlign: 'right', color: theme.dim, paddingRight: 8, userSelect: 'none' }}>{i + 1}</span>
                    <span style={{ width: 16, textAlign: 'center', color: d.t === '+' ? theme.ok : d.t === '-' ? theme.err : theme.dim }}>{d.t}</span>
                    <span style={{ color: theme.ink, whiteSpace: 'pre' }}>{d.line}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: `1px solid ${theme.border}`, background: theme.bg2, padding: '10px 14px', fontSize: 11.5, color: theme.ink2 }}>
                Restoring will POST v11's content to <span style={{ fontFamily: RR_FONT_MONO, color: theme.accent }}>/runtime/rule/addOrUpdate</span> — same as a fresh push, subject to classifier rules.
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function DumpRestore({ theme = rrDark }) {
  return (
    <AppFrame theme={theme} route="/dump">
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <CatalogNav theme={theme} active="dump" compact />
        <div style={{ flex: 1, overflow: 'auto', padding: '26px 36px' }}>
          <div style={{ fontSize: 17, color: theme.heading, fontWeight: 500, marginBottom: 4 }}>Dump & restore</div>
          <div style={{ fontSize: 12, color: theme.dim, marginBottom: 22, maxWidth: 620, lineHeight: 1.5 }}>
            A dump is a tar.gz of all runtime-rule rows plus <span style={{ fontFamily: RR_FONT_MONO }}>manifest.yaml</span>. Use it as a disaster-recovery baseline — take one before any structural push, restore from one when a rule regression needs rollback.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 26 }}>
            <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '18px 20px' }}>
              <Pill tone="info">dump</Pill>
              <div style={{ fontSize: 14, color: theme.heading, fontFamily: RR_FONT_MONO, marginTop: 10, marginBottom: 12 }}>Export current runtime state</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontFamily: RR_FONT_MONO, fontSize: 11.5, marginBottom: 14 }}>
                <span style={{ color: theme.dim }}>catalogs</span><span style={{ color: theme.ink }}>all 3 · 49 rules</span>
                <span style={{ color: theme.dim }}>size est.</span><span style={{ color: theme.ink }}>~412 KB gz</span>
                <span style={{ color: theme.dim }}>includes</span><span style={{ color: theme.ink }}>content + manifest + node hashes</span>
              </div>
              <Btn theme={theme} kind="primary" icon="⇩">Generate dump</Btn>
            </div>

            <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '18px 20px' }}>
              <Pill tone="accent">restore</Pill>
              <div style={{ fontSize: 14, color: theme.heading, fontFamily: RR_FONT_MONO, marginTop: 10, marginBottom: 12 }}>Restore from a tarball</div>
              <div style={{
                border: `1px dashed ${theme.border2}`, borderRadius: 5, padding: '18px 16px',
                textAlign: 'center', color: theme.dim, fontSize: 12, fontFamily: RR_FONT_MONO, marginBottom: 14,
              }}>
                drop rules.tar.gz here · or <span style={{ color: theme.accent, textDecoration: 'underline', cursor: 'pointer' }}>browse</span>
              </div>
              <div style={{ fontSize: 11, color: theme.dim, lineHeight: 1.55 }}>
                Restore is per-file addOrUpdate — existing ACTIVE rules are replaced, storage identity changes blocked unless approved per file.
              </div>
            </div>
          </div>

          <div style={{ fontFamily: RR_FONT_MONO, fontSize: 10, color: theme.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            recent dumps · auto + manual
          </div>
          <div style={{ background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {[
              ['2026-04-23 14:02', 'manual', 'ops@tetrate', '49 rules · 412 KB', 'recovery-baseline-20260423'],
              ['2026-04-22 04:00', 'auto',   'scheduler',  '49 rules · 408 KB', 'nightly-20260422'],
              ['2026-04-21 04:00', 'auto',   'scheduler',  '48 rules · 401 KB', 'nightly-20260421'],
              ['2026-04-20 09:18', 'manual', 'han.l',      '47 rules · 398 KB', 'pre-nginx-push'],
            ].map(([t, kind, by, size, tag], i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '180px 80px 130px 1fr 1fr auto', padding: '11px 16px', gap: 14,
                alignItems: 'center', borderBottom: i < 3 ? `1px solid ${theme.border}` : 'none',
                fontFamily: RR_FONT_MONO, fontSize: 11.5,
              }}>
                <span style={{ color: theme.ink }}>{t}</span>
                <Pill tone={kind === 'manual' ? 'accent' : 'dim'}>{kind}</Pill>
                <span style={{ color: theme.ink2 }}>{by}</span>
                <span style={{ color: theme.dim }}>{size}</span>
                <span style={{ color: theme.ink2 }}>{tag}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn theme={theme} kind="ghost" style={{ padding: '3px 8px', fontSize: 11 }}>Download</Btn>
                  <Btn theme={theme} kind="ghost" style={{ padding: '3px 8px', fontSize: 11 }}>Restore</Btn>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

function DestructiveConfirm({ theme = rrDark }) {
  // Two-step confirmation modal — what will drop
  return (
    <AppFrame theme={theme} route="/edit/otel-rules/vm">
      <div style={{ flex: 1, position: 'relative', background: theme.bg, display: 'flex' }}>
        {/* faded background */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.35, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', height: '100%' }}>
            <CatalogNav theme={theme} active="otel-rules" compact />
            <div style={{ flex: 1, padding: 20 }}>
              <YamlView code={SAMPLE_YAML_MAL} theme={theme} />
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,8,6,0.55)' }} />
        {/* Modal */}
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 640, background: theme.panel, border: `1px solid ${theme.err}`, borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: theme.err, fontSize: 18 }}>⚠</span>
            <span style={{ fontSize: 14, color: theme.heading, fontWeight: 500 }}>Storage-identity change — confirm data loss</span>
          </div>
          <div style={{ padding: '16px 20px', fontSize: 12.5, color: theme.ink2, lineHeight: 1.6 }}>
            This update would move storage identity. The server <strong style={{ color: theme.err }}>drops the existing BanyanDB measure and its data</strong> before registering the new shape.
          </div>
          <div style={{ margin: '0 20px 14px', background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${theme.border}`, fontFamily: RR_FONT_MONO, fontSize: 10.5, color: theme.dim, letterSpacing: 0.8, textTransform: 'uppercase' }}>
              what will drop
            </div>
            {[
              ['vm_memory_available_percent', 'instance(host)', 'service(region)', 'scope change'],
              ['vm_cpu_used_percent', 'AVG', 'MAX', 'downsampling change'],
              ['vm_disk_used_percent', '— (removed)', '—', 'metric removed'],
            ].map(([m, a, b, k], i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', padding: '10px 14px', gap: 10, fontFamily: RR_FONT_MONO, fontSize: 11.5, alignItems: 'center', borderBottom: i < 2 ? `1px solid ${theme.border}` : 'none' }}>
                <span style={{ color: theme.heading }}>{m}</span>
                <span style={{ color: theme.err }}>{a}</span>
                <span style={{ color: theme.ok }}>→ {b}</span>
                <Pill tone="err">{k}</Pill>
              </div>
            ))}
          </div>
          <div style={{ padding: '0 20px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: theme.ink2 }}>
              Type <code style={{ fontFamily: RR_FONT_MONO, color: theme.accent, background: theme.bg2, padding: '1px 5px', borderRadius: 3 }}>otel-rules/vm</code> to confirm:
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: theme.bg, border: `1px solid ${theme.border2}`, borderRadius: 4,
              padding: '8px 12px', fontFamily: RR_FONT_MONO, fontSize: 12.5,
            }}>
              <span style={{ color: theme.accent }}>otel-rules/vm</span>
              <span style={{ width: 1, height: 14, background: theme.accent, animation: 'blink 1s infinite' }} />
            </div>
          </div>
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${theme.border}`, background: theme.bg2, display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: theme.ink2 }}>
              <span style={{ width: 12, height: 12, border: `1px solid ${theme.border2}`, borderRadius: 2, background: theme.panel }} />
              Take dump before applying
            </label>
            <div style={{ flex: 1 }} />
            <Btn theme={theme} kind="ghost">Cancel</Btn>
            <Btn theme={theme} kind="danger" icon="↑">Apply with allowStorageChange</Btn>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

Object.assign(window, { ClusterStatus, HistoryDiff, DumpRestore, DestructiveConfirm });
