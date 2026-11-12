'use strict';
'require baseclass';
'require fs';
'require uci';
'require ui';

// Shared by the Cellular page, the Status > Overview card and the dashboard
// widget: reading samples and history from the tmhi CLI, putting health
// into words, and drawing the history charts.

const CLI = '/usr/bin/tmhi';

// The daemon rewrites this every minute. Reading it costs the gateway nothing.
const LATEST = '/var/run/tmhi/latest.json';

// "Refresh" asks the gateway only if the newest sample is older than this.
const REFRESH_AGE = 15;

// Quality bands per metric, as the CLI draws them: [lo, hi, good, fair].
// Higher is better for all of them.
const METRICS = {
	rsrp: [ -120, -70, -90, -105 ],
	rsrq: [ -20, -3, -10, -15 ],
	sinr: [ -5, 30, 13, 0 ],
	bars: [ 0, 4, 3, 2 ]
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// Colours follow the theme's variables where it has them.
const CSS = `
:root {
	--tmhi-good: var(--success-color-high, #2e9e5b);
	--tmhi-fair: var(--warn-color-high, #e0a800);
	--tmhi-poor: var(--error-color-high, #d9534f);
	--tmhi-muted: var(--text-color-medium, #6b7280);
	--tmhi-line: var(--border-color-medium, rgba(127, 127, 127, 0.25));
	--tmhi-accent: var(--primary-color-high, #1976d2);
	--tmhi-surface: var(--background-color-medium, rgba(127, 127, 127, 0.08));
}

/* ---- Health -------------------------------------------------------- */

.tmhi-badge {
	display: inline-block;
	padding: 0.1em 0.6em;
	border-radius: 999px;
	font-size: 90%;
	font-weight: bold;
	color: #fff;
	white-space: nowrap;
}
.tmhi-badge.tmhi-ok { background: var(--tmhi-good); }
.tmhi-badge.tmhi-degraded { background: var(--tmhi-fair); color: #222; }
.tmhi-badge.tmhi-reboot,
.tmhi-badge.tmhi-down { background: var(--tmhi-poor); }

.tmhi-health {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5em 1em;
	padding: 0.75em 1em;
	border-left: 4px solid var(--tmhi-muted);
	background: var(--tmhi-surface);
	border-radius: 4px;
}
.tmhi-health.tmhi-ok { border-left-color: var(--tmhi-good); }
.tmhi-health.tmhi-degraded { border-left-color: var(--tmhi-fair); }
.tmhi-health.tmhi-reboot,
.tmhi-health.tmhi-down { border-left-color: var(--tmhi-poor); }
.tmhi-health-text { flex: 1 1 20em; }
.tmhi-health-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75em; }
.tmhi-updated { color: var(--tmhi-muted); font-size: 90%; }

/* ---- Meters -------------------------------------------------------- */

.tmhi-meter {
	display: flex;
	align-items: center;
	gap: 0.6em;
}
.tmhi-meter-value {
	min-width: 5.5em;
	text-align: right;
	white-space: nowrap;
	font-variant-numeric: tabular-nums;
}
.tmhi-meter-bar {
	flex: 0 1 10em;
	min-width: 3em;
	height: 0.6em;
	border-radius: 0.3em;
	background: var(--tmhi-line);
	overflow: hidden;
}
.tmhi-meter-bar > span { display: block; height: 100%; border-radius: 0.3em; }
.tmhi-meter.tmhi-good .tmhi-meter-bar > span { background: var(--tmhi-good); }
.tmhi-meter.tmhi-fair .tmhi-meter-bar > span { background: var(--tmhi-fair); }
.tmhi-meter.tmhi-poor .tmhi-meter-bar > span { background: var(--tmhi-poor); }
.tmhi-meter-word { font-size: 85%; color: var(--tmhi-muted); white-space: nowrap; min-width: 2.5em; }

.tmhi-cards {
	display: flex;
	flex-wrap: wrap;
	gap: 1em;
}
.tmhi-cards > .cbi-section {
	flex: 1 1 22em;
	margin: 0;
}

/* ---- History controls and summary ------------------------------------ */

.tmhi-range { display: flex; flex-wrap: wrap; gap: 0.5em; margin-bottom: 1em; }
.tmhi-range .cbi-button.active { font-weight: bold; text-decoration: underline; }
.tmhi-summary { color: var(--tmhi-muted); margin-bottom: 1em; }
.tmhi-summary b { color: inherit; }
.tmhi-sub { margin: 1.5em 0 0.5em; font-size: 1em; font-weight: bold; }
.tmhi-sub small { font-weight: normal; margin-left: 0.5em; }
.tmhi-chart { min-width: 0; overflow: hidden; }

/* ---- Band strip ---------------------------------------------------- */

.tmhi-stripbox { margin: 0.25em 0 0.5em; }
.tmhi-strip {
	position: relative;
	height: 28px;
	border-radius: 4px;
	/* Hatching where there are no samples. */
	background: repeating-linear-gradient(135deg, transparent 0 4px, var(--tmhi-line) 4px 6px);
	overflow: hidden;
}
.tmhi-strip > span {
	position: absolute;
	top: 0;
	bottom: 0;
}
.tmhi-strip > span.bad { top: 0; bottom: 0; box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.25); }

.tmhi-axis {
	position: relative;
	height: 1.4em;
	font-size: 80%;
	color: var(--tmhi-muted);
}
/* Narrow screens: every other time label, so they don't run together. */
@media (max-width: 600px) {
	.tmhi-axis > span:nth-child(even) { display: none; }
	.tmhi-heat { display: block; }
	.tmhi-heat-row { grid-template-columns: 5.5em repeat(24, minmax(0, 1fr)); gap: 1px; }
	.tmhi-heat-hour { font-size: 90%; }
}
.tmhi-axis > span {
	position: absolute;
	transform: translateX(-50%);
	white-space: nowrap;
}

.tmhi-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 0.25em 1.25em;
	font-size: 90%;
}
.tmhi-legend i {
	display: inline-block;
	width: 0.8em;
	height: 0.8em;
	margin-right: 0.35em;
	border-radius: 2px;
	vertical-align: -0.05em;
}
.tmhi-legend small { color: var(--tmhi-muted); }

/* ---- Line charts --------------------------------------------------- */

.tmhi-charts {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(22em, 1fr));
	gap: 1em 2em;
}
.tmhi-chart-title { font-weight: bold; margin-bottom: 0.25em; }
.tmhi-chart-title small { font-weight: normal; color: var(--tmhi-muted); }
.tmhi-chart-body { display: flex; height: 140px; }
.tmhi-yaxis {
	position: relative;
	width: 3em;
	font-size: 80%;
	color: var(--tmhi-muted);
}
.tmhi-yaxis > span {
	position: absolute;
	right: 0.5em;
	transform: translateY(-50%);
}
.tmhi-chart > .tmhi-axis { margin-left: 3em; }
.tmhi-plot {
	position: relative;
	flex: 1;
	border-left: 1px solid var(--tmhi-line);
	border-bottom: 1px solid var(--tmhi-line);
}
.tmhi-plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.tmhi-minmax { fill: var(--tmhi-accent); fill-opacity: 0.18; stroke: none; }
.tmhi-avg { fill: none; stroke: var(--tmhi-accent); stroke-width: 1.5; }
.tmhi-dot { fill: var(--tmhi-accent); }
.tmhi-guide { stroke-width: 1; stroke-dasharray: 4 4; opacity: 0.6; }
.tmhi-guide.tmhi-good { stroke: var(--tmhi-good); }
.tmhi-guide.tmhi-fair { stroke: var(--tmhi-fair); }
.tmhi-cursor {
	position: absolute;
	top: 0;
	bottom: 0;
	border-left: 1px dashed var(--tmhi-muted);
	pointer-events: none;
}
.tmhi-tip {
	position: absolute;
	top: 0.25em;
	margin-left: 0.5em;
	padding: 0.2em 0.5em;
	font-size: 80%;
	white-space: nowrap;
	background: var(--background-color-high, #fff);
	border: 1px solid var(--tmhi-line);
	border-radius: 3px;
	pointer-events: none;
}

/* ---- Heatmap ------------------------------------------------------- */

.tmhi-heat { display: inline-block; max-width: 100%; overflow-x: auto; font-size: 80%; }
.tmhi-heat-row {
	display: grid;
	grid-template-columns: 7.5em repeat(24, minmax(6px, 1.6em));
	gap: 2px;
	margin-bottom: 2px;
}
.tmhi-heat-day { white-space: nowrap; color: var(--tmhi-muted); align-self: center; }
.tmhi-heat-hour { color: var(--tmhi-muted); }
.tmhi-heat-cell { height: 1.3em; border-radius: 2px; }
.tmhi-heat-cell.tmhi-empty { background: var(--tmhi-line); opacity: 0.4; }

/* ---- Tables -------------------------------------------------------- */

.tmhi-good-text { color: var(--tmhi-good); }
.tmhi-fair-text { color: var(--tmhi-fair); }
.tmhi-poor-text { color: var(--tmhi-poor); }
.tmhi-num { text-align: right; font-variant-numeric: tabular-nums; }
.tmhi-events .td { vertical-align: top; }
.tmhi-muted { color: var(--tmhi-muted); }
.tmhi-dir { white-space: nowrap; }
.tmhi-arrow { vertical-align: -0.2em; color: var(--tmhi-accent); }

/* ---- Label hints --------------------------------------------------- */

/* Label / value rows: our own grid, so every theme lays them out alike. */
.tmhi-kv-row {
	display: grid;
	grid-template-columns: minmax(0, 11fr) minmax(0, 9fr);
	gap: 1em;
	align-items: center;
	padding: 0.6em 0;
	border-top: 1px solid var(--tmhi-line);
}
.tmhi-kv-row:first-child { border-top: none; }
.tmhi-kv-name { font-weight: bold; }
.tmhi-kv-value { min-width: 0; overflow-wrap: anywhere; font-family: monospace; }
.tmhi-kv-value .tmhi-meter { font-family: inherit; }
@media (max-width: 480px) {
	.tmhi-kv-row { grid-template-columns: 1fr; gap: 0.3em; }
}
.tmhi-hint {
	margin-top: 0.2em;
	font-size: 85%;
	font-weight: normal;
	line-height: 1.35;
	color: var(--tmhi-muted);
}
`;

function svg(tag, attrs, children) {
	const node = document.createElementNS(SVG_NS, tag);

	for (const key in (attrs || {}))
		if (attrs[key] != null)
			node.setAttribute(key, attrs[key]);

	(children || []).forEach(child => {
		if (child != null)
			node.appendChild(typeof(child) == 'string' ? document.createTextNode(child) : child);
	});

	return node;
}

function parseJSON(res) {
	let data = null;

	try {
		data = JSON.parse(res.stdout);
	}
	catch {
		throw new Error((res.stderr || '').trim() || _('tmhi returned no data (exit code %d)').format(res.code));
	}

	return data;
}

// Times are drawn in the router's time zone, as the history buckets are:
// shift by its UTC offset and read the result as UTC.
function shifted(t, tzoff) {
	return new Date((t + (tzoff || 0)) * 1000);
}

const fmtCache = {};

function formatter(opts) {
	const key = JSON.stringify(opts);

	if (!fmtCache[key])
		fmtCache[key] = new Intl.DateTimeFormat(undefined, Object.assign({ timeZone: 'UTC' }, opts));

	return fmtCache[key];
}

return baseclass.extend({
	REFRESH_AGE: REFRESH_AGE,
	METRICS: METRICS,
	svg: svg,

	// The styles ship inside this module rather than as a separate .css
	// file: one request fewer, and nothing for a cache or content blocker to
	// keep from the page.
	loadCSS() {
		if (document.getElementById('tmhi-css'))
			return;

		document.head.appendChild(E('style', { 'id': 'tmhi-css' }, [ CSS ]));
	},

	// ---- Data ------------------------------------------------------------

	// The daemon's newest sample, or null when there is none (yet).
	latest() {
		return L.resolveDefault(fs.read_direct(LATEST, 'json'), null);
	},

	// A sample at most REFRESH_AGE seconds old. Only then does the CLI ask the
	// gateway, however many browsers press the button.
	refresh() {
		return fs.exec(CLI, [ 'status', '--json', '--max-age', String(REFRESH_AGE) ]).then(parseJSON);
	},

	history(since, bucket) {
		const args = [ 'history', '--json', '-s', String(since) ];

		if (bucket)
			args.push('-b', String(bucket));

		return fs.exec(CLI, args).then(parseJSON);
	},

	reboot() {
		return fs.exec(CLI, [ 'reboot', '--force' ]);
	},

	// ---- Words -----------------------------------------------------------

	dur(s) {
		s = Math.max(0, Math.round(s || 0));

		if (s >= 86400)
			return _('%dd %dh').format(Math.floor(s / 86400), Math.floor(s % 86400 / 3600));
		if (s >= 3600)
			return _('%dh %dm').format(Math.floor(s / 3600), Math.floor(s % 3600 / 60));
		if (s >= 60)
			return _('%dm').format(Math.floor(s / 60));

		return _('%ds').format(s);
	},

	ago(t) {
		return _('%s ago').format(this.dur(Date.now() / 1000 - t));
	},

	time(t, tzoff) {
		return formatter({ hour: '2-digit', minute: '2-digit' }).format(shifted(t, tzoff));
	},

	// Short, for axis ticks on the hour: "3 AM" or "15" depending on locale.
	hour(t, tzoff) {
		return formatter({ hour: 'numeric' }).format(shifted(t, tzoff));
	},

	day(t, tzoff) {
		return formatter({ weekday: 'short', month: 'short', day: 'numeric' }).format(shifted(t, tzoff));
	},

	dateTime(t, tzoff) {
		return formatter({ month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(shifted(t, tzoff));
	},

	// What the gateway is on, e.g. "n41 100 MHz" or "LTE b66 20 MHz".
	bandOf(s, prefix) {
		const bands = s[prefix + 'bands'];

		if (!bands)
			return null;

		return (prefix == 'lte_' ? 'LTE ' : '') + bands + (s[prefix + 'bw'] != null ? ' ' + _('%d MHz').format(s[prefix + 'bw']) : '');
	},

	mode(s) {
		if (s.nr_bands && s.lte_bands)
			return _('5G NSA');
		if (s.nr_bands)
			return _('5G SA');
		if (s.lte_bands)
			return _('LTE');

		return _('No signal');
	},

	// The serving RAT's prefix: 5G when there is any, else LTE.
	primary(s) {
		return s.nr_bands ? 'nr_' : (s.lte_bands ? 'lte_' : null);
	},

	// good | fair | poor for one reading, or null when there is none.
	quality(metric, value, minBw) {
		if (value == null)
			return null;

		const m = (metric == 'bw') ? [ 0, 100, minBw * 2, minBw ] : METRICS[metric];

		return (value >= m[2]) ? 'good' : ((value >= m[3]) ? 'fair' : 'poor');
	},

	// 0..100: where the value sits between the metric's lo and hi.
	fill(metric, value) {
		const m = (metric == 'bw') ? [ 0, 100 ] : METRICS[metric];

		return Math.max(0, Math.min(100, (value - m[0]) / (m[1] - m[0]) * 100));
	},

	// { level, title, text } for a sample's health; level is
	// ok | degraded | reboot | down.
	health(s) {
		const h = s.health || {};
		const now = s.ts || Date.now() / 1000;
		const since = h.since ? now - h.since : 0;
		const prefs = (h.preferred || []).join('/');
		let text;

		switch (h.level) {
		case 'ok':
			return { level: 'ok', title: _('OK'), text: _('On %s.').format(h.key) };

		case 'down':
			return { level: 'down', title: _('Unreachable'), text: s.error || _('The gateway did not answer.') };

		case 'reboot':
			text = _('%s for %s (last good %s ago).').format(h.why, this.dur(since), this.dur(now - (h.lastgood || now)));

			if (s.uptime != null && s.uptime < since)
				text += ' ' + _('The gateway restarted %s ago and came back degraded; the %s cell may be down.').format(this.dur(s.uptime), prefs);

			return { level: 'reboot', title: _('Reboot recommended'), text: text };

		default:
			text = h.why || _('Not on a preferred band.');

			if (since >= 60)
				text = _('%s for %s').format(text, this.dur(since));

			if (!h.history)
				text += '. ' + _('History logging is off, so a passing handover looks the same as a stuck gateway.');
			else if (!h.seen && h.first && now - h.first >= 86400)
				text += '. ' + _('No good samples in the past 7 days, so a reboot probably won\'t help.');
			else
				text += '. ' + _('Reboot if this lasts past %dm.').format(h.stuck_minutes || 30);

			return { level: 'degraded', title: _('Degraded'), text: text };
		}
	},

	badge(health) {
		return E('span', { 'class': 'tmhi-badge tmhi-' + health.level }, [ health.title ]);
	},

	// A meter like the CLI's bars: value, unit, a bar and a quality word.
	meter(metric, value, unit, minBw) {
		const q = this.quality(metric, value, minBw);

		if (q == null)
			return E('em', {}, [ _('n/a') ]);

		return E('div', { 'class': 'tmhi-meter tmhi-' + q }, [
			E('span', { 'class': 'tmhi-meter-value' }, [ '%s %s'.format(value, unit) ]),
			E('span', { 'class': 'tmhi-meter-bar' }, [
				E('span', { 'style': 'width:%.1f%%'.format(this.fill(metric, value)) })
			]),
			E('span', { 'class': 'tmhi-meter-word' }, [ { good: _('good'), fair: _('fair'), poor: _('poor') }[q] ])
		]);
	},

	// ---- Towers ----------------------------------------------------------
	//
	// Named towers are UCI "tower" sections in /etc/config/tmhi: radio
	// (nr = 5G gNB, lte = 4G eNB), id, name, lat, lon. The CLI reads the same
	// sections.

	// { list, units } from UCI; an empty list when tmhi's config can't be read.
	towers() {
		return L.resolveDefault(uci.load('tmhi'), null).then(() => ({
			list: uci.sections('tmhi', 'tower') || [],
			units: uci.get('tmhi', 'main', 'units') || 'imperial'
		})).catch(() => ({ list: [], units: 'imperial' }));
	},

	findTower(towers, radio, id) {
		return ((towers && towers.list) || []).find(t =>
			(t.radio || 'nr') == radio && String(t.id) == String(id)) || null;
	},

	// "Water tower" when named, else "gNB 1234567".
	towerName(towers, radio, id) {
		const t = this.findTower(towers, radio, id);

		return (t && t.name) ? t.name : '%s %s'.format(radio == 'lte' ? _('eNB') : _('gNB'), id);
	},

	// "1.3 mi NE (42°)" from the gateway's reported position to the tower, or
	// null when either position is unknown.
	// { d, unit, dir, deg }: distance and bearing (degrees from true north)
	// from the gateway's reported position to the tower, or null when either
	// position is unknown.
	bearing(s, t, units) {
		const lat1 = +s.gps_lat, lon1 = +s.gps_lon, lat2 = +(t || {}).lat, lon2 = +(t || {}).lon;

		if (s.gps_lat == null || s.gps_lon == null || !t || t.lat == null || t.lon == null || [ lat1, lon1, lat2, lon2 ].some(isNaN))
			return null;

		const rad = Math.PI / 180;
		const r1 = lat1 * rad, r2 = lat2 * rad, dl = (lon2 - lon1) * rad;
		const a = Math.sin((r2 - r1) / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dl / 2) ** 2;
		const metric = (units == 'metric');
		const y = Math.sin(dl) * Math.cos(r2);
		const x = Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dl);
		const deg = (Math.atan2(y, x) / rad + 360) % 360;
		const dirs = [ _('N'), _('NE'), _('E'), _('SE'), _('S'), _('SW'), _('W'), _('NW') ];

		return {
			d: 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * (metric ? 6371 : 3958.8),
			unit: metric ? _('km') : _('mi'),
			dir: dirs[Math.floor((deg + 22.5) / 45) % 8],
			deg: deg
		};
	},

	// "1.3 mi NE (42°)", or null.
	distance(s, t, units) {
		const b = this.bearing(s, t, units);

		return b ? '%.1f %s %s (%d°)'.format(b.d, b.unit, b.dir, Math.round(b.deg) % 360) : null;
	},

	// An arrow pointing at the tower, with north up, then the distance and
	// direction in words; null when the position isn't known.
	direction(s, t, units) {
		const b = this.bearing(s, t, units);

		if (!b)
			return null;

		return E('span', { 'class': 'tmhi-dir', 'title': _('Direction from the gateway to the tower, with north up') }, [
			svg('svg', { 'class': 'tmhi-arrow', 'viewBox': '-8 -8 16 16', 'width': '1.1em', 'height': '1.1em', 'aria-hidden': 'true' }, [
				svg('circle', { 'r': 7.25, 'fill': 'none', 'stroke': 'currentColor', 'stroke-opacity': 0.35 }),
				svg('path', { 'd': 'M0,-6 L4,4 L0,2 L-4,4 Z', 'fill': 'currentColor', 'transform': 'rotate(%.1f)'.format(b.deg) })
			]),
			' %.1f %s %s (%d°)'.format(b.d, b.unit, b.dir, Math.round(b.deg) % 360)
		]);
	},

	appleMaps(t) {
		return 'https://maps.apple.com/?ll=%s,%s&q=%s'.format(t.lat, t.lon, encodeURIComponent(t.name || ''));
	},

	// CellMapper's map of this network's 5G or LTE towers, centred on the
	// gateway's reported position when there is one. CellMapper labels each
	// tower with its gNB / eNB number.
	cellMapper(s, radio) {
		const p = radio + '_';
		let url = 'https://www.cellmapper.net/map?MCC=%s&MNC=%s&type=%s'.format(
			s[p + 'mcc'] || '310', s[p + 'mnc'] || '260', radio == 'lte' ? 'LTE' : 'NR');

		if (s.gps_lat != null && s.gps_lon != null)
			url += '&latitude=%s&longitude=%s&zoom=14'.format(s.gps_lat, s.gps_lon);

		return url;
	},

	// A position from what people paste: "47.61, -122.20" (or a space instead
	// of the comma), or a map link. A CellMapper link after clicking a tower
	// is centred on it (latitude=..&longitude=..); Apple Maps links carry
	// ll= or q=, Google Maps ones @lat,lon. -> [lat, lon] rounded to 6
	// places (about 10 cm), or null.
	parsePosition(text) {
		const num = '(-?\\d+(?:\\.\\d+)?)';
		const t = String(text || '').trim();
		const patterns = [
			new RegExp('^' + num + '\\s*[,\\s]\\s*' + num + '$'),
			new RegExp('[?&]latitude=' + num + '.*[?&]longitude=' + num),
			new RegExp('[?&](?:ll|q|sll)=' + num + '(?:,|%2C)' + num, 'i'),
			new RegExp('@' + num + ',' + num)
		];
		let m = null;

		for (const re of patterns)
			if ((m = t.match(re)) != null)
				break;

		if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180)
			return null;

		return [ String(+(+m[1]).toFixed(6)), String(+(+m[2]).toFixed(6)) ];
	},

	// The dialog to name (or rename, move, forget) one tower. Saving applies
	// the config, which restarts the sampler and reloads the page.
	nameTowerDialog(s, radio, id, towers) {
		const t = this.findTower(towers, radio, id);
		const name = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': (t && t.name) || '', 'placeholder': _('e.g. Water tower') });
		const pos = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'value': (t && t.lat != null) ? '%s, %s'.format(t.lat, t.lon) : '', 'placeholder': _('CellMapper link, or 47.6101, -122.2015') });
		const error = E('div', { 'class': 'tmhi-poor-text', 'style': 'min-height:1.4em' });
		const label = '%s %s'.format(radio == 'lte' ? _('eNB') : _('gNB'), id);

		const save = () => {
			const n = name.value.trim();
			const p = pos.value.trim() ? this.parsePosition(pos.value) : [];

			if (!n) {
				error.textContent = _('Give the tower a name.');
				return;
			}
			if (p == null) {
				error.textContent = _('Paste a CellMapper or map link, or latitude, longitude (e.g. 47.6101, -122.2015).');
				return;
			}

			const sid = t ? t['.name'] : uci.add('tmhi', 'tower');

			uci.set('tmhi', sid, 'radio', radio);
			uci.set('tmhi', sid, 'id', String(id));
			uci.set('tmhi', sid, 'name', n);
			uci.set('tmhi', sid, 'lat', p[0] ?? null);
			uci.set('tmhi', sid, 'lon', p[1] ?? null);

			return uci.save().then(() => ui.changes.apply(true));
		};

		const forget = () => {
			uci.remove('tmhi', t['.name']);
			return uci.save().then(() => ui.changes.apply(true));
		};

		ui.showModal(t ? _('Edit %s').format(label) : _('Name %s').format(label), [
			E('p', {}, [
				_('On CellMapper, click the tower labelled %s and copy the page\'s link (the map centres on the tower). Or long-press the spot in Apple Maps and copy its coordinates.').format(id), ' ',
				E('a', { 'href': this.cellMapper(s, radio), 'target': '_blank', 'rel': 'noopener' }, [ _('Open CellMapper') ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Name') ]),
				E('div', { 'class': 'cbi-value-field' }, [ name ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Location') ]),
				E('div', { 'class': 'cbi-value-field' }, [
					pos,
					E('div', { 'class': 'cbi-value-description' }, [ _('The CellMapper link, an Apple or Google Maps link, or latitude, longitude. Optional; with it you get the distance, direction and a map link.') ])
				])
			]),
			error,
			E('div', { 'class': 'right' }, [
				t ? E('button', { 'class': 'cbi-button cbi-button-negative', 'style': 'float:left', 'click': ui.createHandlerFn(this, forget) }, [ _('Forget') ]) : '',
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', { 'class': 'cbi-button cbi-button-positive important', 'click': ui.createHandlerFn(this, save) }, [ _('Save') ])
			])
		]);

		name.focus();
	},

	// A tower as the status page shows it: the name, distance, direction and
	// map link when it is named; the number and ways to name it when not.
	towerInfo(s, radio, towers) {
		const id = s[radio + '_nb'];
		const t = this.findTower(towers, radio, id);
		const link = (href, text) => E('a', { 'href': href, 'target': '_blank', 'rel': 'noopener' }, [ text ]);
		const action = (text, fn) => E('a', { 'href': '#', 'click': ev => { ev.preventDefault(); fn(); } }, [ text ]);
		const dialog = () => this.nameTowerDialog(s, radio, id, towers);
		const parts = [];

		if (t && t.name) {
			const dist = this.direction(s, t, towers.units);

			parts.push(E('strong', {}, [ t.name ]), ' · ', String(id));
			if (dist)
				parts.push(' · ', dist);
			if (t.lat != null && t.lon != null)
				parts.push(' · ', link(this.appleMaps(t), _('Map')));
			parts.push(' · ', action(_('Edit'), dialog));
		}
		else {
			parts.push(String(id), ' · ', link(this.cellMapper(s, radio), _('Find on CellMapper')), ' · ', action(_('Name it…'), dialog));
		}

		return E('span', {}, parts);
	},

	// ---- Colours ---------------------------------------------------------

	// One colour per band key, in the order of `bands` (most time first):
	// greens for healthy ones, warm colours for the rest.
	palette(bands) {
		const good = [ 'var(--tmhi-good)', '#4fb37a', '#2f7d50', '#8fcfa8' ];
		const bad = [ 'var(--tmhi-poor)', '#ef8a3c', '#b0367c', '#8e5bd8', '#c9a227' ];
		const colours = {};
		let g = 0, b = 0;

		(bands || []).forEach(band => {
			if (band.key == '(unreachable)')
				colours[band.key] = '#6b7280';
			else if (band.key.charAt(0) == '(')
				colours[band.key] = '#9ca3af';
			else if (band.good)
				colours[band.key] = good[g++ % good.length];
			else
				colours[band.key] = bad[b++ % bad.length];
		});

		return colours;
	},

	// Colour for a share of good samples, 0..1.
	goodColour(share) {
		if (share >= 0.99)
			return 'var(--tmhi-good)';
		if (share >= 0.9)
			return '#9acd5a';
		if (share >= 0.5)
			return 'var(--tmhi-fair)';

		return 'var(--tmhi-poor)';
	},

	// ---- Charts ----------------------------------------------------------

	// Tick times for an axis from t0 to t1, on round local hours or days.
	ticks(t0, t1, tzoff) {
		const span = t1 - t0;
		const steps = [ 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 2 * 86400, 7 * 86400 ];
		const step = steps.find(s => span / s <= 8) || 7 * 86400;
		const ticks = [];

		for (let t = Math.ceil((t0 + tzoff) / step) * step - tzoff; t <= t1; t += step)
			ticks.push({ t: t, label: (step >= 86400) ? this.day(t, tzoff) : this.hour(t, tzoff) });

		return ticks;
	},

	axis(t0, t1, tzoff) {
		// Labels are centred on their tick; skip ticks so close to an edge
		// that half the label would be cut off.
		return E('div', { 'class': 'tmhi-axis' }, this.ticks(t0, t1, tzoff)
			.map(tick => ({ label: tick.label, at: (tick.t - t0) / (t1 - t0) * 100 }))
			.filter(tick => tick.at >= 4 && tick.at <= 96)
			.map(tick => E('span', { 'style': 'left:%.2f%%'.format(tick.at) }, [ tick.label ])));
	},

	// A strip of coloured runs, one per band segment, over [t0, t1].
	bandStrip(h, t0, t1, colours) {
		const strip = E('div', { 'class': 'tmhi-strip' });

		h.segments.forEach(([ a, b, key, good ]) => {
			a = Math.max(a, t0);
			b = Math.min(b, t1);

			if (b <= a)
				return;

			strip.appendChild(E('span', {
				'class': good ? 'good' : 'bad',
				'style': 'left:%.3f%%;width:%.3f%%;background:%s'.format((a - t0) / (t1 - t0) * 100, Math.max(0.15, (b - a) / (t1 - t0) * 100), colours[key] || '#999'),
				'title': '%s\n%s – %s (%s)'.format(key, this.dateTime(a, h.tzoff), this.dateTime(b, h.tzoff), this.dur(b - a))
			}));
		});

		return E('div', { 'class': 'tmhi-stripbox' }, [ strip, this.axis(t0, t1, h.tzoff) ]);
	},

	// A line chart of one metric from history buckets: the average as a line
	// and min..max as a band behind it. Missing buckets leave gaps.
	//   opts: { h, t0, t1, index (3 rsrp, 4 sinr), metric, unit, label }
	lineChart(opts) {
		const h = opts.h, t0 = opts.t0, t1 = opts.t1;
		const m = METRICS[opts.metric];
		const points = h.series.filter(p => p[opts.index] != null);
		let lo = m[0], hi = m[1];

		points.forEach(p => {
			lo = Math.min(lo, p[opts.index][1]);
			hi = Math.max(hi, p[opts.index][2]);
		});

		const step = (hi - lo > 40) ? 20 : ((hi - lo > 20) ? 10 : 5);

		lo = Math.floor(lo / step) * step;
		hi = Math.ceil(hi / step) * step;

		const W = 1000, H = 100;
		const x = t => ((t - t0) / (t1 - t0) * W).toFixed(1);
		const y = v => ((hi - v) / (hi - lo) * H).toFixed(1);
		const shapes = [];

		// Guide lines at the good and fair thresholds.
		[ [ m[2], 'good' ], [ m[3], 'fair' ] ].forEach(([ v, cls ]) => {
			if (v > lo && v < hi)
				shapes.push(svg('line', { 'class': 'tmhi-guide tmhi-' + cls, 'stroke': (cls == 'good') ? '#2e9e5b' : '#e0a800', 'stroke-dasharray': '4 4', 'x1': 0, 'x2': W, 'y1': y(v), 'y2': y(v), 'vector-effect': 'non-scaling-stroke' }));
		});

		// Split into runs at missing buckets, then draw each run.
		const runs = [];
		let run = [];

		points.forEach((p, i) => {
			if (run.length && p[0] - run[run.length - 1][0] > h.bucket * 1.5) {
				runs.push(run);
				run = [];
			}
			run.push(p);
		});
		if (run.length)
			runs.push(run);

		runs.forEach(run => {
			const mid = p => p[0] + h.bucket / 2;
			const top = run.map(p => x(mid(p)) + ',' + y(p[opts.index][2]));
			const bottom = run.slice().reverse().map(p => x(mid(p)) + ',' + y(p[opts.index][1]));

			if (run.length == 1) {
				shapes.push(svg('circle', { 'class': 'tmhi-dot', 'fill': '#3b82f6', 'cx': x(mid(run[0])), 'cy': y(run[0][opts.index][0]), 'r': 3, 'vector-effect': 'non-scaling-stroke' }));
				return;
			}

			shapes.push(svg('polygon', { 'class': 'tmhi-minmax', 'fill': '#3b82f6', 'fill-opacity': 0.18, 'stroke': 'none', 'points': top.concat(bottom).join(' ') }));
			shapes.push(svg('polyline', {
				'class': 'tmhi-avg',
				'fill': 'none',
				'stroke': '#3b82f6',
				'stroke-width': 1.5,
				'points': run.map(p => x(mid(p)) + ',' + y(p[opts.index][0])).join(' '),
				'vector-effect': 'non-scaling-stroke'
			}));
		});

		const yLabels = [];

		for (let v = lo; v <= hi; v += step)
			yLabels.push(E('span', { 'style': 'top:%.2f%%'.format((hi - v) / (hi - lo) * 100) }, [ String(v) ]));

		const tip = E('div', { 'class': 'tmhi-tip', 'style': 'display:none' });
		const cursor = E('div', { 'class': 'tmhi-cursor', 'style': 'display:none' });
		const plot = E('div', { 'class': 'tmhi-plot' }, [
			svg('svg', { 'viewBox': '0 0 %d %d'.format(W, H), 'preserveAspectRatio': 'none', 'role': 'img', 'aria-label': opts.label }, shapes),
			cursor, tip
		]);

		// Hover shows the nearest bucket.
		plot.addEventListener('mousemove', ev => {
			const rect = plot.getBoundingClientRect();
			const t = t0 + (ev.clientX - rect.left) / rect.width * (t1 - t0);
			let best = null;

			points.forEach(p => {
				if (best == null || Math.abs(p[0] + h.bucket / 2 - t) < Math.abs(best[0] + h.bucket / 2 - t))
					best = p;
			});

			if (best == null || Math.abs(best[0] + h.bucket / 2 - t) > h.bucket * 2) {
				tip.style.display = cursor.style.display = 'none';
				return;
			}

			const v = best[opts.index];
			const left = (best[0] + h.bucket / 2 - t0) / (t1 - t0) * 100;

			cursor.style.display = tip.style.display = '';
			cursor.style.left = '%.2f%%'.format(left);
			tip.style.left = '%.2f%%'.format(Math.min(left, 75));
			tip.textContent = _('%s: avg %s, min %s, max %s %s').format(this.dateTime(best[0], h.tzoff), v[0], v[1], v[2], opts.unit);
		});
		plot.addEventListener('mouseleave', () => { tip.style.display = cursor.style.display = 'none'; });

		return E('div', { 'class': 'tmhi-chart' }, [
			E('div', { 'class': 'tmhi-chart-title' }, [ opts.label, ' ', E('small', {}, [ '(%s)'.format(opts.unit) ]) ]),
			E('div', { 'class': 'tmhi-chart-body' }, [
				E('div', { 'class': 'tmhi-yaxis' }, yLabels),
				plot
			]),
			this.axis(t0, t1, h.tzoff)
		]);
	},

	// Good share by hour of day (columns) and day (rows).
	heatmap(h) {
		const DAY = 86400;
		const days = {};
		const order = [];

		h.hours.forEach(hr => {
			const d = Math.floor((hr.t + h.tzoff) / DAY);
			const hour = Math.floor(((hr.t + h.tzoff) % DAY) / 3600);

			if (!days[d]) {
				days[d] = [];
				order.push(d);
			}

			days[d][hour] = hr;
		});

		const head = [ E('span') ];

		for (let i = 0; i < 24; i++)
			head.push(E('span', { 'class': 'tmhi-heat-hour' }, [ (i % 3 == 0) ? String(i) : '' ]));

		const rows = [ E('div', { 'class': 'tmhi-heat-row tmhi-heat-head' }, head) ];

		order.forEach(d => {
			const cells = [ E('span', { 'class': 'tmhi-heat-day' }, [ this.day(d * DAY - h.tzoff, h.tzoff) ]) ];

			for (let i = 0; i < 24; i++) {
				const hr = days[d][i];

				if (!hr) {
					cells.push(E('span', { 'class': 'tmhi-heat-cell tmhi-empty' }));
					continue;
				}

				const share = hr.good / hr.n;
				const top = Object.keys(hr.keys).sort((a, b) => hr.keys[b] - hr.keys[a])[0];

				cells.push(E('span', {
					'class': 'tmhi-heat-cell',
					'style': 'background:' + this.goodColour(share),
					'title': _('%s, %02d:00: %d%% good, mostly %s').format(this.day(hr.t, h.tzoff), i, Math.floor(share * 100), top)
				}));
			}

			rows.push(E('div', { 'class': 'tmhi-heat-row' }, cells));
		});

		return E('div', { 'class': 'tmhi-heat' }, rows);
	},

	legend(items) {
		return E('div', { 'class': 'tmhi-legend' }, items.map(item =>
			E('span', {}, [ E('i', { 'style': 'background:' + item.colour }), item.label, item.value != null ? E('small', {}, [ ' ', item.value ]) : '' ])));
	}
});
