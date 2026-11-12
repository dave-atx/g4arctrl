'use strict';
'require baseclass';
'require tmhi';
'require view.dashboard.lib.charts as charts';

// Widgets for luci-mod-dashboard: a status card and a SINR chart, drawn with
// the dashboard's own chart helpers so they look like the rest of it. Those
// helpers (and the widget slots) arrived in luci-mod-dashboard in September
// 2026; an older dashboard fails to load with this include installed, and
// updating luci-mod-dashboard fixes it.

const SPAN = 6 * 3600;      // chart window, seconds
const BUCKET = 300;         // one point per 5 minutes
const HISTORY_EVERY = 300;  // the dashboard polls every few seconds; history needn't

// SINR runs below zero, and the dashboard's charts start at 0: shift it up.
const SINR_LO = -10, SINR_HI = 40;

let hist = null, histAt = 0, towers = { list: [], units: 'imperial' };

return baseclass.extend({
	title: _('Cellular'),

	widgets: [
		{ id: 'tmhi', slot: 'cards', title: _('Cellular'), order: 25 },
		{ id: 'tmhi-sinr', slot: 'charts', title: _('Cellular signal'), order: 25 }
	],

	load() {
		const now = Date.now() / 1000;
		const wantHistory = (now - histAt >= HISTORY_EVERY);

		if (wantHistory)
			histAt = now;

		return Promise.all([
			tmhi.latest(),
			tmhi.towers().then(t => { towers = t; }),
			wantHistory ? L.resolveDefault(tmhi.history(SPAN, BUCKET), null).then(h => { hist = h ?? hist; }) : null
		]);
	},

	card(s) {
		if (!s)
			return charts.kpi({ icon: 'not-internet', title: this.title, value: [ _('No data') ], sub: [ _('Is the tmhi service running?') ] });

		const health = tmhi.health(s);
		const p = tmhi.primary(s);
		const width = p && s[p + 'bw'] != null ? _('%d MHz').format(s[p + 'bw']) : null;
		const named = p ? tmhi.findTower(towers, p.slice(0, -1), s[p + 'nb']) : null;

		// Short lines: the card is narrow and cuts long ones off. Stacked
		// lines are also title attributes, so they must be strings.
		const node = charts.kpi({
			icon: (health.level == 'down') ? 'not-internet' : 'internet',
			title: this.title,
			value: [ p ? ((p == 'lte_' ? 'LTE ' : '') + s[p + 'bands']) : tmhi.mode(s) ],
			sub: [
				[ width, tmhi.mode(s) ].filter(x => x).join(' · '),
				(named && named.name) ? named.name : null,
				(health.level == 'ok')
					? (p && s[p + 'sinr'] != null ? _('OK · SINR %s dB').format(s[p + 'sinr']) : health.title)
					: '%s: %s'.format(health.title, health.text)
			].filter(x => x != null),
			stacked: true
		});

		node.style.cursor = 'pointer';
		node.setAttribute('title', _('Details and history'));
		node.addEventListener('click', () => { location.href = L.url('admin/status/tmhi'); });

		return node;
	},

	chart(s) {
		const points = [];
		let last = null;

		(hist ? hist.series : []).forEach(b => {
			if (b[4] == null)
				return;
			if (last != null && b[0] - last > BUCKET * 1.5)
				points.push({ t: (last + BUCKET) * 1000, v: null });

			points.push({ t: (b[0] + BUCKET / 2) * 1000, v: Math.max(0, Math.min(SINR_HI, b[4][0]) - SINR_LO) });
			last = b[0];
		});

		const ticks = [];

		for (let v = SINR_LO; v <= SINR_HI; v += 10)
			ticks.push({ value: v - SINR_LO, label: String(v) });

		const p = s ? tmhi.primary(s) : null;

		return charts.card({
			title: _('Cellular signal'),
			desc: _('SINR, dB · 5 minute average'),
			body: points.length ? [
				charts.lines({
					span: SPAN,
					max: SINR_HI - SINR_LO,
					ticks: ticks,
					ariaLabel: _('SINR over the last 6 hours'),
					series: [ { values: points, area: true } ]
				}),
				charts.legend([
					{ className: 'dashboard-series-1', label: _('SINR'), value: (p && s[p + 'sinr'] != null) ? '%s dB'.format(s[p + 'sinr']) : '-' }
				])
			] : charts.empty(hist ? _('No history in the last 6 hours') : _('Collecting data...'))
		});
	},

	render([ s ]) {
		tmhi.loadCSS();

		return {
			cards: [ { id: 'tmhi', node: this.card(s) } ],
			charts: [ { id: 'tmhi-sinr', node: this.chart(s) } ]
		};
	}
});
