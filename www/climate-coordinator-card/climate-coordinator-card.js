import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit@2/index.js?module";

const DOMAIN = "climate_coordinator";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun"
};
const TEMP_REF_OPTIONS = [
  { value: "lowest_of_both",  label: "Lowest of current & target" },
  { value: "highest_of_both", label: "Highest of current & target" },
  { value: "current",         label: "Current temperature only" },
  { value: "target",          label: "Target temperature only" },
];
const ABSENT_OPTIONS = [
  { value: "min_temp", label: "Area minimum temperature" },
  { value: "off",      label: "Turn off" },
  { value: "fixed",    label: "Fixed temperature" },
];
const PRESENCE_WINDOW_OPTIONS = [
  { value: "past_n_minutes",     label: "Past N minutes" },
  { value: "past_n_hours",       label: "Past N hours" },
  { value: "since_period_start", label: "Since period started" },
];

class ClimateCoordinatorCard extends LitElement {

  static properties = {
    hass:           { type: Object },
    _config:        { state: true },
    _status:        { state: true },
    _entities:      { state: true },
    _tab:           { state: true },
    _expandedAreas: { state: true },
    _editingArea:   { state: true },
    _editingRule:   { state: true },
    _editingPeriod: { state: true },
    _error:         { state: true },
    _loading:       { state: true },
  };

  constructor() {
    super();
    this._config        = null;
    this._status        = null;
    this._entities      = { climate: [], binary_sensor: [], sensor: [] };
    this._tab           = "status";
    this._expandedAreas = new Set();
    this._editingArea   = null;
    this._editingRule   = null;
    this._editingPeriod = null;
    this._error         = null;
    this._loading       = false;
    this._pollInterval  = null;
  }

  setConfig(config) { this._cardConfig = config; }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._pollInterval = setInterval(() => this._loadStatus(), 15000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._pollInterval);
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------

  async _ws(type, params = {}) {
    return this.hass.connection.sendMessagePromise({ type, ...params });
  }

  async _load() {
    this._loading = true;
    try {
      await Promise.all([
        this._loadConfig(),
        this._loadStatus(),
        this._loadEntities(),
      ]);
    } finally {
      this._loading = false;
    }
  }

  async _loadConfig()  { this._config = await this._ws(`${DOMAIN}/get_config`); }
  async _loadStatus()  { this._status = await this._ws(`${DOMAIN}/get_status`); }

  async _loadEntities() {
    const [climate, binary_sensor, sensor] = await Promise.all([
      this._ws(`${DOMAIN}/get_entities`, { domain: "climate" }),
      this._ws(`${DOMAIN}/get_entities`, { domain: "binary_sensor" }),
      this._ws(`${DOMAIN}/get_entities`, { domain: "sensor" }),
    ]);
    this._entities = { climate, binary_sensor, sensor };
  }

  async _act(fn) {
    this._error = null;
    try {
      await fn();
      await this._load();
    } catch (e) {
      this._error = e.message || String(e);
    }
  }

  // ------------------------------------------------------------------
  // Root render
  // ------------------------------------------------------------------

  render() {
    return html`
      <ha-card>
        <div class="card-header">
          <span class="title">HA Climate Coordinator</span>
          <div class="tabs">
            ${["status","areas","schedule"].map(t => html`
              <button class="tab ${this._tab === t ? "active" : ""}"
                @click=${() => {
                  this._tab = t;
                  this._editingArea = null;
                  this._editingRule = null;
                  this._editingPeriod = null;
                }}>
                ${t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            `)}
          </div>
        </div>

        ${this._error ? html`
          <div class="error-bar">
            ⚠ ${this._error}
            <button class="clear-error" @click=${() => this._error = null}>✕</button>
          </div>
        ` : ""}

        <div class="card-content">
          ${this._loading && !this._config
            ? html`<div class="loading">Loading…</div>`
            : this._renderTab()}
        </div>
      </ha-card>
    `;
  }

  _renderTab() {
    if (this._tab === "status")   return this._renderStatus();
    if (this._tab === "areas")    return this._renderAreas();
    if (this._tab === "schedule") return this._renderSchedule();
    return html``;
  }

  // ------------------------------------------------------------------
  // Status tab
  // ------------------------------------------------------------------

  _renderStatus() {
    const areas = this._status?.areas ?? [];
    if (!areas.length) return html`<div class="empty">No areas configured yet.</div>`;
    return html`
      <div class="accordion-list">
        ${areas.map(a => this._renderStatusArea(a))}
      </div>
    `;
  }

  _renderStatusArea(a) {
    const key = `status-${a.id}`;
    const open = this._expandedAreas.has(key);
    return html`
      <div class="accordion ${open ? "open" : ""}">
        <div class="accordion-header" @click=${() => this._toggle(key)}>
          <div class="accordion-title">
            <span class="area-name">${a.name}</span>
            <div class="badge-row">
              ${a.passive        ? html`<span class="badge passive">Passive</span>` : ""}
              ${a.override_active? html`<span class="badge override">Override</span>` : ""}
              ${a.active_period  ? html`<span class="badge period">${a.active_period}</span>` : ""}
              ${!a.passive && a.present !== null ? html`
                <span class="badge ${a.present ? "present" : "absent"}">
                  ${a.present ? "Present" : "Absent"}
                </span>` : ""}
            </div>
          </div>
          <div class="accordion-temps">
            <span>${a.current_temp ?? "—"}°C</span>
            <span class="arrow">→</span>
            <span>${a.target_temp ?? "—"}°C</span>
          </div>
          <ha-icon icon="mdi:chevron-${open ? "up" : "down"}"></ha-icon>
        </div>

        ${open ? html`
          <div class="accordion-body">
            <div class="status-grid">
              <div class="status-item">
                <span class="label">Entity</span>
                <span class="value mono">${a.climate_entity}</span>
              </div>
              <div class="status-item">
                <span class="label">State</span>
                <span class="value">${a.climate_state}</span>
              </div>
              ${a.min_temp != null ? html`
                <div class="status-item">
                  <span class="label">Min</span>
                  <span class="value">${a.min_temp}°C</span>
                </div>` : ""}
              ${a.max_temp != null ? html`
                <div class="status-item">
                  <span class="label">Max</span>
                  <span class="value">${a.max_temp}°C</span>
                </div>` : ""}
            </div>

            ${a.presence_sensors?.length ? html`
              <div class="section-label">Presence</div>
              ${a.presence_sensors.map(ps => html`
                <div class="presence-row">
                  <span class="mono small">${ps.entity_id}</span>
                  <span class="badge ${ps.state === "on" ? "present" : "absent"} small">
                    ${ps.state}
                  </span>
                  <span class="muted small">
                    ${ps.last_seen ? this._formatTime(ps.last_seen) : "never"}
                  </span>
                </div>
              `)}
            ` : ""}

            ${a.override_active ? html`
              <div class="override-bar">
                <span>Manual override${a.override_remaining
                  ? ` — ${a.override_remaining} remaining` : ""}</span>
                <button class="btn-small danger"
                  @click=${() => this._cancelOverride(a.id)}>
                  Cancel Override
                </button>
              </div>
            ` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }

  async _cancelOverride(areaId) {
    await this._act(() =>
      this._ws(`${DOMAIN}/cancel_override`, { area_id: areaId })
    );
  }

  // ------------------------------------------------------------------
  // Areas tab
  // ------------------------------------------------------------------

  _renderAreas() {
    if (this._editingArea) return this._renderAreaEditor();
    if (this._editingRule) return this._renderRuleEditor();

    const areas = this._config?.areas ?? [];
    return html`
      <div class="accordion-list">
        ${areas.map(a => this._renderAreaAccordion(a))}
      </div>
      <button class="btn-add" @click=${() => this._startAddArea()}>
        + Add Area
      </button>
    `;
  }

  _renderAreaAccordion(area) {
    const key  = `area-${area.id}`;
    const open = this._expandedAreas.has(key);
    const statusArea = this._status?.areas?.find(a => a.id === area.id);
    return html`
      <div class="accordion ${open ? "open" : ""}">
        <div class="accordion-header" @click=${() => this._toggle(key)}>
          <div class="accordion-title">
            <span class="area-name">${area.name}</span>
            <div class="badge-row">
              ${area.passive ? html`<span class="badge passive">Passive</span>` : ""}
              ${statusArea?.active_period
                ? html`<span class="badge period">${statusArea.active_period}</span>`
                : ""}
            </div>
          </div>
          <div class="accordion-actions" @click=${e => e.stopPropagation()}>
            <button class="btn-icon" title="Edit"
              @click=${() => this._startEditArea(area)}>
              <ha-icon icon="mdi:pencil"></ha-icon>
            </button>
            <button class="btn-icon danger" title="Delete"
              @click=${() => this._deleteArea(area.id)}>
              <ha-icon icon="mdi:delete"></ha-icon>
            </button>
          </div>
          <ha-icon icon="mdi:chevron-${open ? "up" : "down"}"></ha-icon>
        </div>

        ${open ? html`
          <div class="accordion-body">
            <div class="area-meta-grid">
              <span class="label">Climate entity</span>
              <span class="mono small">${area.climate_entity}</span>
              ${area.temperature_sensor ? html`
                <span class="label">Temp sensor</span>
                <span class="mono small">${area.temperature_sensor}</span>
              ` : ""}
              ${area.override_duration ? html`
                <span class="label">Override duration</span>
                <span>${area.override_duration}h</span>
              ` : ""}
              ${area.min_temp != null ? html`
                <span class="label">Min temp</span>
                <span>${area.min_temp}°C</span>
              ` : ""}
              ${area.max_temp != null ? html`
                <span class="label">Max temp</span>
                <span>${area.max_temp}°C</span>
              ` : ""}
            </div>

            ${area.passive ? html`
              <div class="passive-note">
                This area is passive — no rules are applied.
                Other areas may follow its temperature.
              </div>
            ` : html`
              <div class="rules-header">
                <span class="section-label">Rules</span>
                <button class="btn-small"
                  @click=${() => this._startAddRule(area)}>
                  + Add Rule
                </button>
              </div>
              ${!area.rules?.length
                ? html`<div class="empty-rules">No rules yet.</div>`
                : area.rules.map(r => this._renderRuleRow(area, r))}
            `}
          </div>
        ` : ""}
      </div>
    `;
  }

  _renderRuleRow(area, rule) {
    const period = this._config?.time_periods?.find(
      p => p.id === rule.period_id
    );
    return html`
      <div class="rule-row ${!rule.enabled ? "disabled" : ""}">
        <div class="rule-summary">
          <span class="rule-period">${period?.name ?? "Unknown period"}</span>
          <span class="rule-detail muted">${this._ruleSummary(rule)}</span>
          ${rule.presence_sensors?.length ? html`
            <span class="badge small presence-badge">
              ${rule.presence_sensors.length} sensor${rule.presence_sensors.length > 1 ? "s" : ""}
            </span>` : ""}
        </div>
        <div class="rule-actions">
          <label class="toggle" title="${rule.enabled ? "Disable" : "Enable"}">
            <input type="checkbox"
              .checked=${rule.enabled !== false}
              @change=${e => this._toggleRule(area.id, rule.id, e.target.checked)}>
          </label>
          <button class="btn-icon"
            @click=${() => this._startEditRule(area, rule)}>
            <ha-icon icon="mdi:pencil"></ha-icon>
          </button>
          <button class="btn-icon danger"
            @click=${() => this._deleteRule(area.id, rule.id)}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Area editor
  // ------------------------------------------------------------------

  _renderAreaEditor() {
    const a = this._editingArea;
    return html`
      <div class="editor">
        <div class="editor-header">
          <button class="btn-back" @click=${() => this._editingArea = null}>← Back</button>
          <h3>${a.isNew ? "Add Area" : `Edit: ${a.name}`}</h3>
        </div>

        ${this._field("Name",
          html`<input type="text" .value=${a.name ?? ""}
            @input=${e => this._patch("area", { name: e.target.value })} />`
        )}

        ${this._field("Climate Entity",
          this._entitySelect(
            this._entities.climate, a.climate_entity,
            v => this._patch("area", { climate_entity: v })
          )
        )}

        ${this._field("Temperature Sensor (optional)",
          this._entitySelect(
            [...this._entities.sensor, ...this._entities.climate],
            a.temperature_sensor,
            v => this._patch("area", { temperature_sensor: v || null }),
            true
          )
        )}

        ${this._field("Override Duration (hours)",
          html`<input type="number" min="1" max="48" step="0.5"
            .value=${a.override_duration ?? 13}
            @input=${e => this._patch("area", {
              override_duration: parseFloat(e.target.value)
            })} />`
        )}

        <label class="toggle-row">
          <input type="checkbox"
            .checked=${a.passive === true}
            @change=${e => this._patch("area", { passive: e.target.checked })}>
          <span>Passive — no rules applied, temperature set independently</span>
        </label>

        ${!a.passive ? html`
          <div class="bounds-section">
            <div class="section-label">Temperature Bounds</div>
            <p class="hint">
              Min and max temperatures act as hard limits that override
              any temperature calculated by rules. Leave blank for no limit.
            </p>
            <div class="two-col">
              ${this._field("Min Temp (°C)",
                html`<input type="number" min="0" max="35" step="0.5"
                  .value=${a.min_temp ?? ""}
                  placeholder="None"
                  @input=${e => this._patch("area", {
                    min_temp: e.target.value === ""
                      ? null : parseFloat(e.target.value)
                  })} />`
              )}
              ${this._field("Max Temp (°C)",
                html`<input type="number" min="0" max="35" step="0.5"
                  .value=${a.max_temp ?? ""}
                  placeholder="None"
                  @input=${e => this._patch("area", {
                    max_temp: e.target.value === ""
                      ? null : parseFloat(e.target.value)
                  })} />`
              )}
            </div>
          </div>
        ` : ""}

        <div class="editor-actions">
          <button @click=${() => this._editingArea = null}>Cancel</button>
          <button class="btn-primary" @click=${() => this._saveArea()}>Save</button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Rule editor
  // ------------------------------------------------------------------

  _renderRuleEditor() {
    const r = this._editingRule;
    const periods   = this._config?.time_periods ?? [];
    const otherAreas = (this._config?.areas ?? []).filter(
      a => a.id !== r._areaId
    );
    const hasPresence = (r.presence_sensors ?? []).length > 0;

    return html`
      <div class="editor">
        <div class="editor-header">
          <button class="btn-back" @click=${() => this._editingRule = null}>← Back</button>
          <h3>${r.isNew ? "Add Rule" : "Edit Rule"}</h3>
        </div>

        ${this._field("Time Period",
          html`<select @change=${e => this._patch("rule", { period_id: e.target.value })}>
            <option value="">— select period —</option>
            ${periods.map(p => html`
              <option value=${p.id} ?selected=${r.period_id === p.id}>
                ${p.name}
              </option>`)}
          </select>`
        )}

        <label class="toggle-row">
          <input type="checkbox"
            .checked=${r.enabled !== false}
            @change=${e => this._patch("rule", { enabled: e.target.checked })}>
          <span>Rule enabled</span>
        </label>

        ${this._field("Temperature Mode",
          html`<select @change=${e =>
              this._patch("rule", { temperature_mode: e.target.value })}>
            <option value="fixed"  ?selected=${r.temperature_mode === "fixed"}>
              Fixed temperature
            </option>
            <option value="follow" ?selected=${r.temperature_mode === "follow"}>
              Follow another area
            </option>
          </select>`
        )}

        ${r.temperature_mode === "fixed" ? html`
          ${this._field("Temperature (°C)",
            html`<input type="number" min="0" max="35" step="0.5"
              .value=${r.temperature ?? 20}
              @input=${e => this._patch("rule", {
                temperature: parseFloat(e.target.value)
              })} />`
          )}
        ` : html`
          ${this._field("Follow Area",
            html`<select @change=${e =>
                this._patch("rule", { source_area_id: e.target.value })}>
              <option value="">— select area —</option>
              ${otherAreas.map(a => html`
                <option value=${a.id} ?selected=${r.source_area_id === a.id}>
                  ${a.name}
                </option>`)}
            </select>`
          )}
          ${this._field("Temperature Reference",
            html`<select @change=${e =>
                this._patch("rule", { temperature_reference: e.target.value })}>
              ${TEMP_REF_OPTIONS.map(o => html`
                <option value=${o.value}
                  ?selected=${r.temperature_reference === o.value}>
                  ${o.label}
                </option>`)}
            </select>`
          )}
          ${this._field("Offset (°C, negative = cooler)",
            html`<input type="number" min="-15" max="15" step="0.5"
              .value=${r.offset ?? 0}
              @input=${e => this._patch("rule", {
                offset: parseFloat(e.target.value)
              })} />`
          )}
        `}

        <div class="section-label" style="margin-top:14px">
          Presence Sensors
        </div>
        <p class="hint">
          If no sensors are selected, the rule always applies at full
          temperature. If sensors are selected, absent behaviour below
          is used when none are triggered.
        </p>
        <div class="presence-select">
          ${this._entities.binary_sensor.map(e => html`
            <label class="checkbox-label">
              <input type="checkbox"
                .checked=${(r.presence_sensors ?? []).includes(e.entity_id)}
                @change=${ev => this._toggleSensor(e.entity_id, ev.target.checked)}>
              ${e.name}
            </label>`)}
        </div>

        ${hasPresence ? html`
          ${this._field("Presence Window",
            html`<select @change=${e =>
                this._patch("rule", {
                  presence_window: {
                    ...r.presence_window,
                    type: e.target.value
                  }
                })}>
              ${PRESENCE_WINDOW_OPTIONS.map(o => html`
                <option value=${o.value}
                  ?selected=${r.presence_window?.type === o.value}>
                  ${o.label}
                </option>`)}
            </select>`
          )}

          ${r.presence_window?.type !== "since_period_start" ? html`
            ${this._field(
              `N (${r.presence_window?.type === "past_n_hours" ? "hours" : "minutes"})`,
              html`<input type="number" min="1" max="1440" step="1"
                .value=${r.presence_window?.value ?? 60}
                @input=${e => this._patch("rule", {
                  presence_window: {
                    ...r.presence_window,
                    value: parseInt(e.target.value)
                  }
                })} />`
            )}
          ` : ""}

          <div class="section-label" style="margin-top:14px">
            Absent Behaviour
          </div>
          ${this._field("When no presence detected",
            html`<select @change=${e =>
                this._patch("rule", { absent_behaviour: e.target.value })}>
              ${ABSENT_OPTIONS.map(o => html`
                <option value=${o.value}
                  ?selected=${r.absent_behaviour === o.value}>
                  ${o.label}
                </option>`)}
            </select>`
          )}

          ${r.absent_behaviour === "fixed" ? html`
            ${this._field("Absent Fixed Temperature (°C)",
              html`<input type="number" min="0" max="35" step="0.5"
                .value=${r.absent_fixed_temp ?? 16}
                @input=${e => this._patch("rule", {
                  absent_fixed_temp: parseFloat(e.target.value)
                })} />`
            )}
          ` : ""}
        ` : ""}

        <div class="editor-actions">
          <button @click=${() => this._editingRule = null}>Cancel</button>
          <button class="btn-primary" @click=${() => this._saveRule()}>
            Save Rule
          </button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Schedule tab
  // ------------------------------------------------------------------

  _renderSchedule() {
    if (this._editingPeriod) return this._renderPeriodEditor();
    const periods = [...(this._config?.time_periods ?? [])].sort(
      (a, b) => a.start_time.localeCompare(b.start_time)
    );
    return html`
      <div class="period-list">
        ${!periods.length
          ? html`<div class="empty">No time periods defined yet.</div>`
          : periods.map(p => this._renderPeriodRow(p))}
      </div>
      <button class="btn-add" @click=${() => this._startAddPeriod()}>
        + Add Time Period
      </button>
    `;
  }

  _renderPeriodRow(p) {
    return html`
      <div class="period-row">
        <div class="period-info">
          <span class="period-name">${p.name}</span>
          <span class="period-time muted">${p.start_time}</span>
          <div class="day-chips">
            ${DAYS.map(d => html`
              <span class="day-chip ${p.days.includes(d) ? "active" : ""}">
                ${DAY_LABELS[d]}
              </span>`)}
          </div>
        </div>
        <div class="period-actions">
          <button class="btn-icon" @click=${() => this._startEditPeriod(p)}>
            <ha-icon icon="mdi:pencil"></ha-icon>
          </button>
          <button class="btn-icon danger"
            @click=${() => this._deletePeriod(p.id)}>
            <ha-icon icon="mdi:delete"></ha-icon>
          </button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Period editor
  // ------------------------------------------------------------------

  _renderPeriodEditor() {
    const p = this._editingPeriod;
    return html`
      <div class="editor">
        <div class="editor-header">
          <button class="btn-back"
            @click=${() => this._editingPeriod = null}>← Back</button>
          <h3>${p.isNew ? "Add Time Period" : `Edit: ${p.name}`}</h3>
        </div>

        ${this._field("Name",
          html`<input type="text" .value=${p.name ?? ""}
            @input=${e => this._patch("period", { name: e.target.value })} />`
        )}

        ${this._field("Start Time",
          html`<input type="time" .value=${p.start_time ?? "08:00"}
            @change=${e => this._patch("period", { start_time: e.target.value })} />`
        )}

        <div class="field-label">Days</div>
        <div class="day-toggle-row">
          ${DAYS.map(d => html`
            <button
              class="day-toggle ${(p.days ?? []).includes(d) ? "active" : ""}"
              @click=${() => this._toggleDay(d)}>
              ${DAY_LABELS[d]}
            </button>`)}
        </div>

        <div class="editor-actions">
          <button @click=${() => this._editingPeriod = null}>Cancel</button>
          <button class="btn-primary" @click=${() => this._savePeriod()}>Save</button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // CRUD actions
  // ------------------------------------------------------------------

  _startAddArea() {
    this._editingArea = {
      isNew: true, name: "", climate_entity: "",
      temperature_sensor: null, passive: false,
      min_temp: null, max_temp: null, override_duration: 13
    };
  }
  _startEditArea(area) {
    this._editingArea = { ...area, isNew: false };
  }
  async _saveArea() {
    const a = this._editingArea;
    await this._act(async () => {
      if (a.isNew) {
        const { isNew, ...data } = a;
        await this._ws(`${DOMAIN}/add_area`, { area: data });
      } else {
        const { id, rules, isNew, ...updates } = a;
        await this._ws(`${DOMAIN}/update_area`, { area_id: id, updates });
      }
    });
    this._editingArea = null;
  }
  async _deleteArea(areaId) {
    if (!confirm("Delete this area and all its rules?")) return;
    await this._act(() =>
      this._ws(`${DOMAIN}/delete_area`, { area_id: areaId })
    );
  }

  _startAddRule(area) {
    this._editingRule = {
      isNew: true, _areaId: area.id,
      period_id: "", enabled: true,
      temperature_mode: "fixed", temperature: 20,
      source_area_id: null, temperature_reference: "lowest_of_both",
      offset: 0, presence_sensors: [],
      presence_window: { type: "past_n_minutes", value: 60 },
      absent_behaviour: "min_temp", absent_fixed_temp: null,
    };
  }
  _startEditRule(area, rule) {
    this._editingRule = { ...rule, isNew: false, _areaId: area.id };
  }
  async _saveRule() {
    const r = this._editingRule;
    const { isNew, _areaId, ...ruleData } = r;
    await this._act(async () => {
      if (isNew) {
        await this._ws(`${DOMAIN}/add_rule`,
          { area_id: _areaId, rule: ruleData });
      } else {
        const { id, ...updates } = ruleData;
        await this._ws(`${DOMAIN}/update_rule`,
          { area_id: _areaId, rule_id: r.id, updates });
      }
    });
    this._editingRule = null;
  }
  async _deleteRule(areaId, ruleId) {
    if (!confirm("Delete this rule?")) return;
    await this._act(() =>
      this._ws(`${DOMAIN}/delete_rule`, { area_id: areaId, rule_id: ruleId })
    );
  }
  async _toggleRule(areaId, ruleId, enabled) {
    await this._act(() =>
      this._ws(`${DOMAIN}/update_rule`,
        { area_id: areaId, rule_id: ruleId, updates: { enabled } })
    );
  }

  _startAddPeriod() {
    this._editingPeriod = {
      isNew: true, name: "", start_time: "08:00", days: [...DAYS]
    };
  }
  _startEditPeriod(p) {
    this._editingPeriod = { ...p, isNew: false };
  }
  async _savePeriod() {
    const p = this._editingPeriod;
    await this._act(async () => {
      if (p.isNew) {
        const { isNew, ...data } = p;
        await this._ws(`${DOMAIN}/add_period`, { period: data });
      } else {
        const { id, isNew, ...updates } = p;
        await this._ws(`${DOMAIN}/update_period`, { period_id: id, updates });
      }
    });
    this._editingPeriod = null;
  }
  async _deletePeriod(periodId) {
    if (!confirm(
      "Delete this period? Rules using it will also be deleted."
    )) return;
    await this._act(() =>
      this._ws(`${DOMAIN}/delete_period`, { period_id: periodId })
    );
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  _patch(type, patch) {
    if (type === "area")   this._editingArea   = { ...this._editingArea,   ...patch };
    if (type === "rule")   this._editingRule   = { ...this._editingRule,   ...patch };
    if (type === "period") this._editingPeriod = { ...this._editingPeriod, ...patch };
  }

  _toggle(key) {
    const next = new Set(this._expandedAreas);
    next.has(key) ? next.delete(key) : next.add(key);
    this._expandedAreas = next;
  }

  _toggleDay(day) {
    const days = [...(this._editingPeriod.days ?? [])];
    const idx = days.indexOf(day);
    idx === -1 ? days.push(day) : days.splice(idx, 1);
    this._editingPeriod = { ...this._editingPeriod, days };
  }

  _toggleSensor(entityId, checked) {
    const sensors = [...(this._editingRule.presence_sensors ?? [])];
    if (checked && !sensors.includes(entityId)) sensors.push(entityId);
    if (!checked) { const i = sensors.indexOf(entityId); if (i > -1) sensors.splice(i, 1); }
    this._patch("rule", { presence_sensors: sensors });
  }

  _entitySelect(entities, value, onChange, allowEmpty = false) {
    return html`
      <select @change=${e => onChange(e.target.value)}>
        ${allowEmpty
          ? html`<option value="">— none —</option>`
          : html`<option value="">— select —</option>`}
        ${entities.map(e => html`
          <option value=${e.entity_id} ?selected=${e.entity_id === value}>
            ${e.name}
          </option>`)}
      </select>`;
  }

  _field(label, control) {
    return html`
      <div class="field-label">${label}</div>
      ${control}
    `;
  }

  _ruleSummary(rule) {
    if (rule.temperature_mode === "fixed") {
      return `Fixed ${rule.temperature}°C`;
    }
    const area = this._config?.areas?.find(a => a.id === rule.source_area_id);
    const ref  = TEMP_REF_OPTIONS.find(o => o.value === rule.temperature_reference);
    const off  = rule.offset ?? 0;
    const offStr = off >= 0 ? `+${off}` : `${off}`;
    return `Follow ${area?.name ?? "?"} · ${ref?.label ?? "?"} ${offStr}°C`;
  }

  _formatTime(isoString) {
    if (!isoString) return "never";
    const d    = new Date(isoString);
    const now  = new Date();
    const mins = Math.round((now - d) / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return d.toLocaleDateString();
  }

  // ------------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------------

  static styles = css`
    ha-card { font-family: var(--primary-font-family); overflow: hidden; }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 16px;
      border-bottom: 1px solid var(--divider-color);
    }
    .title { font-size: 1.05em; font-weight: 500; }
    .tabs { display: flex; gap: 4px; }
    .tab {
      background: none; border: none; padding: 5px 10px;
      cursor: pointer; color: var(--secondary-text-color);
      border-radius: 4px; font-size: 0.85em;
    }
    .tab.active {
      color: var(--primary-color);
      background: rgba(var(--rgb-primary-color, 3,169,244), 0.1);
      font-weight: 500;
    }
    .card-content { padding: 12px 16px; }
    .error-bar {
      background: var(--error-color, #db4437); color: white;
      padding: 8px 16px; font-size: 0.85em;
      display: flex; justify-content: space-between; align-items: center;
    }
    .clear-error { background: none; border: none; color: white; cursor: pointer; }
    .loading, .empty {
      text-align: center; padding: 24px;
      color: var(--secondary-text-color); font-size: 0.9em;
    }

    /* Accordion */
    .accordion-list { display: flex; flex-direction: column; gap: 8px; }
    .accordion {
      border: 1px solid var(--divider-color);
      border-radius: 8px; overflow: hidden;
    }
    .accordion-header {
      display: flex; align-items: center; padding: 10px 12px;
      cursor: pointer; gap: 8px;
      background: var(--secondary-background-color, var(--card-background-color));
    }
    .accordion-header:hover {
      background: rgba(var(--rgb-primary-color, 3,169,244), 0.04);
    }
    .accordion-title {
      flex: 1; display: flex; align-items: center;
      gap: 8px; flex-wrap: wrap;
    }
    .accordion-actions { display: flex; gap: 2px; }
    .accordion-temps {
      display: flex; align-items: center; gap: 4px;
      font-size: 0.9em; color: var(--secondary-text-color);
    }
    .arrow { color: var(--secondary-text-color); }
    .accordion-body {
      padding: 12px;
      border-top: 1px solid var(--divider-color);
    }
    .area-name { font-weight: 500; }

    /* Badges */
    .badge-row { display: flex; gap: 4px; flex-wrap: wrap; }
    .badge {
      padding: 2px 7px; border-radius: 10px;
      font-size: 0.75em; font-weight: 500;
    }
    .badge.small { font-size: 0.7em; padding: 1px 5px; }
    .badge.override       { background: #fff3e0; color: #e65100; }
    .badge.period         { background: #e8eaf6; color: #283593; }
    .badge.present        { background: #e8f5e9; color: #2e7d32; }
    .badge.absent         { background: #f5f5f5; color: #616161; }
    .badge.passive        { background: #f3e5f5; color: #6a1b9a; }
    .badge.presence-badge { background: #e3f2fd; color: #1565c0; }

    /* Status */
    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px; margin-bottom: 10px;
    }
    .status-item { display: flex; flex-direction: column; }
    .label { font-size: 0.75em; color: var(--secondary-text-color); margin-bottom: 1px; }
    .value { font-size: 0.9em; }
    .section-label {
      font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--secondary-text-color); margin: 10px 0 5px;
    }
    .presence-row {
      display: flex; align-items: center; gap: 8px;
      padding: 3px 0; flex-wrap: wrap;
    }
    .override-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 10px; background: #fff3e0; border-radius: 4px;
      margin-top: 10px; font-size: 0.85em; color: #e65100;
    }

    /* Area meta */
    .area-meta-grid {
      display: grid; grid-template-columns: auto 1fr;
      gap: 3px 12px; font-size: 0.85em; margin-bottom: 8px;
    }
    .area-meta-grid .label { align-self: center; }
    .passive-note {
      font-size: 0.85em; color: var(--secondary-text-color);
      font-style: italic; padding: 6px 0;
    }

    /* Rules */
    .rules-header {
      display: flex; justify-content: space-between;
      align-items: center; margin-top: 8px;
    }
    .empty-rules {
      font-size: 0.85em; color: var(--secondary-text-color); padding: 6px 0;
    }
    .rule-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 0; border-bottom: 1px solid var(--divider-color);
    }
    .rule-row.disabled { opacity: 0.45; }
    .rule-summary { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .rule-period { font-weight: 500; font-size: 0.9em; }
    .rule-detail { font-size: 0.82em; }
    .rule-actions { display: flex; align-items: center; gap: 2px; }

    /* Periods */
    .period-list { display: flex; flex-direction: column; gap: 8px; }
    .period-row {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding: 10px 12px; border: 1px solid var(--divider-color);
      border-radius: 8px;
    }
    .period-info { display: flex; flex-direction: column; gap: 4px; }
    .period-name { font-weight: 500; }
    .period-time { font-size: 0.85em; }
    .period-actions { display: flex; gap: 2px; }
    .day-chips { display: flex; gap: 3px; flex-wrap: wrap; }
    .day-chip {
      padding: 2px 5px; border-radius: 3px; font-size: 0.72em;
      background: var(--secondary-background-color, #f5f5f5);
      color: var(--secondary-text-color);
    }
    .day-chip.active {
      background: var(--primary-color);
      color: var(--text-primary-color, white);
    }

    /* Editor */
    .editor { display: flex; flex-direction: column; }
    .editor-header {
      display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
    }
    .editor-header h3 { margin: 0; font-size: 1em; }
    .field-label {
      font-size: 0.8em; color: var(--secondary-text-color); margin: 10px 0 3px;
    }
    .editor input[type="text"],
    .editor input[type="number"],
    .editor input[type="time"],
    .editor select {
      width: 100%; padding: 7px 8px;
      border: 1px solid var(--divider-color); border-radius: 4px;
      background: var(--card-background-color);
      color: var(--primary-text-color); font-size: 0.9em;
      box-sizing: border-box;
    }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .bounds-section {
      margin-top: 12px; padding: 10px;
      border: 1px solid var(--divider-color); border-radius: 6px;
    }
    .hint {
      font-size: 0.8em; color: var(--secondary-text-color);
      margin: 4px 0 8px; line-height: 1.4;
    }
    .toggle-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.88em; cursor: pointer; margin: 10px 0 4px;
    }
    .presence-select {
      display: flex; flex-direction: column; gap: 3px;
      max-height: 160px; overflow-y: auto;
      padding: 6px; border: 1px solid var(--divider-color);
      border-radius: 4px;
    }
    .checkbox-label {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.85em; cursor: pointer;
    }
    .day-toggle-row { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0; }
    .day-toggle {
      padding: 4px 8px; border-radius: 4px;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--secondary-text-color); cursor: pointer; font-size: 0.8em;
    }
    .day-toggle.active {
      background: var(--primary-color);
      color: var(--text-primary-color, white);
      border-color: var(--primary-color);
    }
    .editor-actions {
      display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;
    }

    /* Utility */
    .mono  { font-family: monospace; font-size: 0.85em; }
    .small { font-size: 0.82em; }
    .muted { color: var(--secondary-text-color); }

    /* Buttons */
    button {
      padding: 6px 12px; border-radius: 4px;
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
      color: var(--primary-text-color); cursor: pointer; font-size: 0.85em;
    }
    .btn-primary {
      background: var(--primary-color);
      color: var(--text-primary-color, white);
      border-color: var(--primary-color);
    }
    .btn-small { padding: 3px 8px; font-size: 0.78em; }
    .btn-small.danger { color: var(--error-color); border-color: var(--error-color); }
    .btn-icon { padding: 4px; border: none; background: none; color: var(--secondary-text-color); }
    .btn-icon:hover { color: var(--primary-color); }
    .btn-icon.danger:hover { color: var(--error-color); }
    .btn-add {
      width: 100%; margin-top: 10px; padding: 9px;
      border: 1px dashed var(--primary-color);
      color: var(--primary-color); background: none; border-radius: 4px;
    }
    .btn-back {
      background: none; border: none;
      color: var(--primary-color); padding: 0; cursor: pointer; font-size: 0.9em;
    }
    .toggle {
      display: flex; align-items: center; cursor: pointer;
    }
  `;
}

customElements.define("climate-coordinator-card", ClimateCoordinatorCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "climate-coordinator-card",
  name: "HA Climate Coordinator",
  description: "Centrally manage climate devices with schedules and presence",
});
