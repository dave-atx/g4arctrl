'use strict';
'require view';
'require dom';
'require poll';
'require ui';
'require tmog4ar';

const RANGES = [
	[ 86400, _('24 hours') ],
	[ 7 * 86400, _('7 days') ],
	[ 30 * 86400, _('30 days') ]
];

// Changes listed before "Show all".
const EVENTS_SHOWN = 25;

// Plain-language meanings, shown under each label. Always visible rather than
// in a tooltip, so they work on touch screens too. The good / poor levels are
// the ones the meters use (tmog4ar.METRICS).
const HINTS = {
	reg: _('Whether the gateway is signed in to T-Mobile\'s network.'),
	mode: _('5G SA is 5G on its own. 5G NSA is 5G added on top of an LTE (4G) connection. LTE is 4G only.'),
	apn: _('The name of the T-Mobile data service the gateway connects through.'),
	ipv6: _('Whether the network gave the gateway an IPv6 address.'),
	uptime: _('Time since the gateway last restarted.'),
	auth: _('Whether tmog4ar can log in to the gateway to read the detailed numbers.'),
	bw: _('How much radio spectrum the connection uses, like lanes on a highway: wider means more capacity. %d MHz or more is good.'),
	rsrp: _('Signal strength: how loud the tower is by the time it reaches you. Closer to zero is stronger; -90 or higher is good, below -105 is poor.'),
	rsrq: _('Signal quality: how much of what the gateway hears is the tower, rather than noise and other people\'s traffic. -10 or higher is good, below -15 is poor.'),
	sinr: _('How clearly the signal stands out from interference. This matters most for speed: 13 or higher is good, 20 or higher is excellent, below 0 is poor.'),
	bars: _('The gateway\'s own 0 to 4 summary, like the bars on a phone.'),
	nb: _('The tower\'s ID number (gNB for 5G, eNB for LTE).'),
	cid: _('Which antenna on the tower is serving you. Towers usually have several, each facing a different direction.'),
	pci: _('A short label that nearby cells use to tell each other apart. Not unique: it repeats across a city.'),
	arfcn: _('The channel number, which pins down the exact radio frequency.'),
	cqi: _('The gateway\'s 0 to 15 rating of the connection, sent to the tower so it can pick a speed. 15 is best.'),
	rssi: _('All the radio energy received, including noise and interference. Less telling than RSRP.'),
	antenna: _('Which of the gateway\'s antennas is in use.')
};

// One label / value row. Plain divs on our own grid rather than a .table:
// themes size table cells their own way, which long hints don't survive.
function row(label, value, hint) {
	return E('div', { 'class': 'tmog4ar-kv-row', 'data-place': 'kv:' + label }, [
		E('div', { 'class': 'tmog4ar-kv-label' }, [
			E('div', { 'class': 'tmog4ar-kv-name' }, [ label ]),
			hint ? E('div', { 'class': 'tmog4ar-hint' }, [ hint ]) : ''
		]),
		E('div', { 'class': 'tmog4ar-kv-value' }, [ value ?? E('em', {}, [ _('n/a') ]) ])
	]);
}

// The centre frequency of a 5G NR channel number (3GPP TS 38.104, 5.4.2.1).
function nrFrequency(arfcn) {
	const n = +arfcn;

	if (!(n >= 0))
		return null;
	if (n < 600000)
		return n * 0.005;
	if (n < 2016667)
		return 3000 + (n - 600000) * 0.015;

	return 24250.08 + (n - 2016667) * 0.06;
}

function table(head, rows, className) {
	return E('table', { 'class': 'table ' + (className || '') }, [
		E('tr', { 'class': 'tr table-titles' }, head.map(h =>
			E('th', { 'class': 'th ' + (h.className || '') }, [ h.label ?? h ])))
	].concat(rows));
}

function cell(content, className, title) {
	return E('td', { 'class': 'td ' + (className || ''), 'data-title': title || null }, [ content ?? '' ]);
}

// Redraw without moving what the reader is looking at. Rows and headings
// carry a data-place key that stays the same across redraws: note where the
// first one in view sits, redraw, then scroll by however far it moved. A new
// hour row, or a line that wraps differently, above the reader would
// otherwise push the page around (and Safari has no scroll anchoring).
function keepPlace(redraw) {
	const top = el => el.getBoundingClientRect().top;
	const marks = Array.from(document.querySelectorAll('[data-place]'));
	const i = marks.findIndex(el => top(el) >= 0);

	if (i < 0) {
		redraw();
		return;
	}

	const key = marks[i].getAttribute('data-place');
	const nth = marks.slice(0, i).filter(el => el.getAttribute('data-place') == key).length;
	const before = top(marks[i]);

	redraw();

	const again = Array.from(document.querySelectorAll('[data-place]')).filter(el => el.getAttribute('data-place') == key)[nth];
	const moved = again ? top(again) - before : 0;

	if (Math.abs(moved) >= 1)
		window.scrollBy(0, moved);
}

function pctClass(share) {
	return (share >= 0.99) ? 'tmog4ar-good-text' : ((share >= 0.9) ? 'tmog4ar-fair-text' : 'tmog4ar-poor-text');
}

function fmtNum(v) {
	return (v == null) ? '-' : String(Math.round(v));
}

return view.extend({
	range: RANGES[0][0],
	sample: null,
	hist: null,
	histError: null,
	allEvents: false,
	towers: { list: [], units: 'imperial' },

	load() {
		return Promise.all([
			tmog4ar.latest(),
			tmog4ar.history(this.range).catch(e => { this.histError = e.message; return null; }),
			tmog4ar.towers()
		]);
	},

	// ---- Status ----------------------------------------------------------

	handleRefresh() {
		return tmog4ar.refresh().then(s => {
			this.sample = s;
			this.renderStatus();
		}).catch(e => {
			ui.addNotification(null, E('p', [ _('Could not refresh: %s').format(e.message) ]), 'danger');
		});
	},

	handleReboot() {
		const health = tmog4ar.health(this.sample);

		ui.showModal(_('Reboot the gateway?'), [
			E('p', [ _('The internet connection drops for a few minutes while the gateway restarts.') ]),
			E('p', [ _('Current health:'), ' ', tmog4ar.badge(health), ' ', health.text ]),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', {
					'class': 'cbi-button cbi-button-negative important',
					'click': ui.createHandlerFn(this, 'handleRebootConfirm')
				}, [ _('Reboot gateway') ])
			])
		]);
	},

	handleRebootConfirm() {
		return tmog4ar.reboot().then(res => {
			ui.hideModal();

			if (res.code == 0)
				ui.addNotification(null, E('p', [ _('Reboot requested. The gateway usually takes a few minutes to come back.') ]), 'info');
			else
				ui.addNotification(_('Reboot failed'), E('pre', [ (res.stderr || res.stdout || '').trim() ]), 'danger');
		}).catch(e => {
			ui.hideModal();
			ui.addNotification(_('Reboot failed'), E('p', [ e.message ]), 'danger');
		});
	},

	renderRat(s, prefix, title) {
		const bands = s[prefix + 'bands'];

		if (!bands)
			return null;

		const minBw = (s.health || {}).min_bw || 40;
		let width;

		if (s[prefix + 'bw'] != null)
			width = tmog4ar.meter('bw', s[prefix + 'bw'], _('MHz'), minBw);
		else
			width = E('em', {}, [ {
				nocreds: _('n/a (needs the admin password, see Settings)'),
				failed: _('n/a (admin login failed)')
			}[s.auth] || _('n/a') ]);

		const arfcn = s[prefix + 'arfcn'];
		const freq = (prefix == 'nr_' && arfcn != null) ? nrFrequency(arfcn) : null;

		const cellInfo = [
			[ prefix == 'nr_' ? _('gNB') : _('eNB'), s[prefix + 'nb'] != null ? tmog4ar.towerInfo(s, prefix.slice(0, -1), this.towers) : null, HINTS.nb ],
			[ _('Cell ID'), s[prefix + 'cid'], HINTS.cid ],
			[ _('PCI'), s[prefix + 'pci'], HINTS.pci ],
			[ _('ARFCN'), arfcn != null ? (freq ? _('%s (%.2f MHz)').format(arfcn, freq) : arfcn) : null, HINTS.arfcn ],
			[ _('CQI'), s[prefix + 'cqi'] != null ? '%s / 15'.format(s[prefix + 'cqi']) : null, HINTS.cqi ],
			[ _('RSSI'), s[prefix + 'rssi'] != null ? '%s %s'.format(s[prefix + 'rssi'], _('dBm')) : null, HINTS.rssi ],
			[ _('Antenna'), s[prefix + 'antenna'], HINTS.antenna ]
		].filter(x => x[1] != null);

		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ '%s · %s'.format(title, bands) ]),
			E('div', { 'class': 'tmog4ar-kv' }, [
				row(_('Channel width'), width, HINTS.bw.format(minBw * 2)),
				row(_('RSRP'), tmog4ar.meter('rsrp', s[prefix + 'rsrp'], _('dBm')), HINTS.rsrp),
				row(_('RSRQ'), tmog4ar.meter('rsrq', s[prefix + 'rsrq'], _('dB')), HINTS.rsrq),
				row(_('SINR'), tmog4ar.meter('sinr', s[prefix + 'sinr'], _('dB')), HINTS.sinr),
				row(_('Bars'), tmog4ar.meter('bars', s[prefix + 'bars'], '/ 4'), HINTS.bars)
			].concat(cellInfo.map(x => row(x[0], (x[1] instanceof Node) ? x[1] : String(x[1]), x[2]))))
		]);
	},

	renderStatus() {
		const s = this.sample;

		if (!s) {
			dom.content(this.statusNode, E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [ E('em', {}, [ _('No sample yet. The tmog4ar service takes one a minute; check that it is running (System > Startup).') ]) ]),
				E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleRefresh') }, [ _('Ask the gateway now') ])
			]));
			return;
		}

		const health = tmog4ar.health(s);
		const canReboot = (s.auth != 'nocreds');

		const banner = E('div', { 'class': 'tmog4ar-health tmog4ar-' + health.level, 'data-place': 'banner' }, [
			tmog4ar.badge(health),
			E('span', { 'class': 'tmog4ar-health-text' }, [ health.text ]),
			E('span', { 'class': 'tmog4ar-health-actions' }, [
				E('span', { 'class': 'tmog4ar-updated', 'title': new Date(s.ts * 1000).toLocaleString() }, [ _('Updated %s').format(tmog4ar.ago(s.ts)) ]),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'title': _('Asks the gateway unless the last sample is under %d seconds old').format(tmog4ar.REFRESH_AGE),
					'click': ui.createHandlerFn(this, 'handleRefresh')
				}, [ _('Refresh') ]),
				E('button', {
					'class': 'cbi-button cbi-button-negative',
					'disabled': canReboot ? null : '',
					'title': canReboot ? null : _('Needs the admin password (Settings)'),
					'click': ui.createHandlerFn(this, 'handleReboot')
				}, [ _('Reboot gateway…') ])
			])
		]);

		const auth = {
			ok: _('Logged in'),
			nocreds: _('No password set (Settings): no channel width, PCI, ARFCN or CQI'),
			failed: _('Login failed: check the password in Settings')
		}[s.auth];

		const conn = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Connection') ]),
			E('div', { 'class': 'tmog4ar-kv' }, [
				row(_('Registration'), s.reg, HINTS.reg),
				row(_('Mode'), tmog4ar.mode(s), HINTS.mode),
				row(_('APN'), s.apn, HINTS.apn),
				row(_('IPv6'), s.ipv6 == null ? null : (s.ipv6 ? _('yes') : _('no')), HINTS.ipv6),
				row(_('Gateway'), s.model ? '%s · %s'.format(s.model, s.firmware || '?') : null),
				row(_('Gateway uptime'), s.uptime != null ? tmog4ar.dur(s.uptime) : null, HINTS.uptime),
				row(_('Admin login'), auth, HINTS.auth)
			])
		]);

		const cards = [ conn, this.renderRat(s, 'nr_', _('5G')), this.renderRat(s, 'lte_', _('LTE')) ].filter(x => x);

		dom.content(this.statusNode, [
			banner,
			E('div', { 'class': 'tmog4ar-cards', 'style': 'margin-top:1em' }, cards)
		]);
	},

	// ---- History ---------------------------------------------------------

	loadHistory() {
		return tmog4ar.history(this.range).then(h => {
			this.hist = h;
			this.histError = null;
		}).catch(e => {
			this.histError = e.message;
		}).then(() => keepPlace(() => this.renderHistory()));
	},

	handleRange(range) {
		this.range = range;
		this.allEvents = false;
		this.rangeNode.querySelectorAll('button').forEach(b =>
			b.classList.toggle('active', +b.getAttribute('data-range') == range));
		dom.content(this.historyNode, E('p', {}, [ E('em', { 'class': 'spinning' }, [ _('Loading history…') ]) ]));

		return this.loadHistory();
	},

	// Runs of bad samples, with touching bad segments merged.
	badStretches(h) {
		const out = [];

		h.segments.forEach(([ a, b, key, good ]) => {
			if (good)
				return;

			const last = out[out.length - 1];

			if (last && last.end == a)
				last.end = b;
			else
				out.push({ start: a, end: b });
		});

		return out;
	},

	renderSummary(h, t0) {
		const good = h.hours.reduce((sum, hr) => sum + hr.good, 0);
		const share = good / h.samples;
		const changes = h.events.filter(e => e.type == 'band').length;
		const towers = h.events.filter(e => e.type == 'tower' || e.nb_from).length;
		const bad = this.badStretches(h);
		const longest = bad.reduce((max, b) => Math.max(max, b.end - b.start), 0);
		const stuck = bad.filter(b => b.end - b.start >= h.stuck_minutes * 60).length;
		const parts = [
			E('span', {}, [ N_(h.samples, '%d sample', '%d samples').format(h.samples) ]),
			E('span', {}, [ E('b', { 'class': pctClass(share) }, [ '%.1f%%'.format(share * 100) ]), ' ', _('good') ]),
			E('span', {}, [ N_(changes, '%d band change', '%d band changes').format(changes) ]),
			E('span', {}, [ N_(towers, '%d tower change', '%d tower changes').format(towers) ])
		];

		if (longest)
			parts.push(E('span', {}, [ _('longest bad stretch %s').format(tmog4ar.dur(longest)) ]));
		if (stuck)
			parts.push(E('span', { 'class': 'tmog4ar-poor-text' }, [ N_(stuck, '%d stretch longer than %dm', '%d stretches longer than %dm').format(stuck, h.stuck_minutes) ]));
		if (h.first > h.since + 3600)
			parts.push(E('span', {}, [ _('history starts %s').format(tmog4ar.dateTime(h.first, h.tzoff)) ]));

		return E('div', { 'class': 'tmog4ar-summary' }, parts.flatMap((p, i) => i ? [ ' · ', p ] : [ p ]));
	},

	renderBands(h, colours) {
		return table([
			_('Band'),
			{ label: _('Share'), className: 'tmog4ar-num' },
			{ label: _('Time'), className: 'tmog4ar-num' },
			{ label: _('RSRP'), className: 'tmog4ar-num' },
			{ label: _('SINR'), className: 'tmog4ar-num' }
		], h.bands.map(b => E('tr', { 'class': 'tr' }, [
			cell(E('span', {}, [ E('i', { 'class': 'tmog4ar-swatch', 'style': 'display:inline-block;width:.8em;height:.8em;border-radius:2px;margin-right:.4em;background:' + colours[b.key] }), b.key ]), b.good ? '' : 'tmog4ar-poor-text', _('Band')),
			cell('%.1f%%'.format(b.samples / h.samples * 100), 'tmog4ar-num', _('Share')),
			cell(tmog4ar.dur(b.samples * h.interval), 'tmog4ar-num', _('Time')),
			cell(fmtNum(b.rsrp), 'tmog4ar-num', _('RSRP')),
			cell(fmtNum(b.sinr), 'tmog4ar-num', _('SINR'))
		])));
	},

	// Per hour for a day, per day for longer ranges: the same table the CLI prints.
	renderPeriods(h) {
		const DAY = 86400;
		const daily = this.range > DAY;
		let periods = h.hours;

		if (daily) {
			const days = {};

			periods = [];
			h.hours.forEach(hr => {
				const d = Math.floor((hr.t + h.tzoff) / DAY);
				let p = days[d];

				if (!p) {
					p = days[d] = { t: d * DAY - h.tzoff, n: 0, good: 0, keys: {}, rsrp: null, sinr: null, rs: 0, rn: 0, ss: 0, sn: 0, smin: null };
					periods.push(p);
				}

				p.n += hr.n;
				p.good += hr.good;
				for (const k in hr.keys)
					p.keys[k] = (p.keys[k] || 0) + hr.keys[k];
				// Hourly averages, weighted by samples.
				if (hr.rsrp) { p.rs += hr.rsrp[0] * hr.n; p.rn += hr.n; }
				if (hr.sinr) {
					p.ss += hr.sinr[0] * hr.n; p.sn += hr.n;
					p.smin = (p.smin == null) ? hr.sinr[1] : Math.min(p.smin, hr.sinr[1]);
				}
			});
			periods.forEach(p => {
				p.rsrp = p.rn ? [ p.rs / p.rn ] : null;
				p.sinr = p.sn ? [ p.ss / p.sn, p.smin ] : null;
			});
		}

		return table([
			daily ? _('Day') : _('Hour'),
			_('Mostly on'),
			{ label: _('Good'), className: 'tmog4ar-num' },
			{ label: _('RSRP'), className: 'tmog4ar-num' },
			{ label: _('SINR avg / min'), className: 'tmog4ar-num' }
		], periods.slice().reverse().map(p => {
			const top = Object.keys(p.keys).sort((a, b) => p.keys[b] - p.keys[a])[0];
			const share = p.good / p.n;

			return E('tr', { 'class': 'tr', 'data-place': 'p:' + p.t }, [
				cell(daily ? tmog4ar.day(p.t, h.tzoff) : tmog4ar.dateTime(p.t, h.tzoff), '', daily ? _('Day') : _('Hour')),
				cell(top, '', _('Mostly on')),
				cell('%d%%'.format(Math.floor(share * 100)), 'tmog4ar-num ' + pctClass(share), _('Good')),
				cell(fmtNum(p.rsrp && p.rsrp[0]), 'tmog4ar-num', _('RSRP')),
				cell(p.sinr ? '%s / %s'.format(fmtNum(p.sinr[0]), fmtNum(p.sinr[1])) : '-', 'tmog4ar-num', _('SINR avg / min'))
			]);
		}));
	},

	// Time on each tower. Any tower in the history can be named from here,
	// not just the one the gateway is on now.
	renderTowers(h) {
		const s = this.sample || {};

		return table([
			_('Tower'),
			_('Where'),
			{ label: _('Share'), className: 'tmog4ar-num' },
			{ label: _('Good'), className: 'tmog4ar-num' },
			{ label: _('RSRP'), className: 'tmog4ar-num' },
			{ label: _('SINR'), className: 'tmog4ar-num' }
		], h.towers.map(tw => {
			const t = tmog4ar.findTower(this.towers, tw.radio, tw.id);
			const id = '%s %s'.format(tw.radio == 'lte' ? _('eNB') : _('gNB'), tw.id);
			const share = tw.good / tw.samples;
			const named = t && t.name;
			const edit = E('a', { 'href': '#', 'click': ev => {
				ev.preventDefault();
				tmog4ar.nameTowerDialog(s, tw.radio, tw.id, this.towers);
			} }, [ named ? _('Edit') : _('Name it…') ]);
			const where = [];

			if (named && t.lat != null && t.lon != null) {
				const dir = tmog4ar.direction(s, t, this.towers.units);

				if (dir)
					where.push(dir, ' · ');
				where.push(E('a', { 'href': tmog4ar.appleMaps(t), 'target': '_blank', 'rel': 'noopener' }, [ _('Map') ]), ' · ');
			}
			where.push(edit);

			return E('tr', { 'class': 'tr', 'data-place': 'tw:' + tw.radio + tw.id }, [
				cell(named ? E('span', {}, [ t.name, ' ', E('span', { 'class': 'tmog4ar-muted' }, [ '(%s)'.format(id) ]) ]) : id, '', _('Tower')),
				cell(E('span', {}, where), '', _('Where')),
				cell('%.1f%%'.format(tw.samples / h.samples * 100), 'tmog4ar-num', _('Share')),
				cell('%d%%'.format(Math.floor(share * 100)), 'tmog4ar-num ' + pctClass(share), _('Good')),
				cell(fmtNum(tw.rsrp), 'tmog4ar-num', _('RSRP')),
				cell(fmtNum(tw.sinr), 'tmog4ar-num', _('SINR'))
			]);
		}));
	},

	renderEvents(h, colours) {
		const moved = e => _('tower %s → %s').format(
			tmog4ar.towerName(this.towers, e.radio_from || 'nr', e.nb_from),
			tmog4ar.towerName(this.towers, e.radio_to || 'nr', e.nb_to));
		const events = h.events.slice().reverse();
		const shown = this.allEvents ? events : events.slice(0, EVENTS_SHOWN);
		const band = (key, good) => E('span', { 'class': good ? '' : 'tmog4ar-poor-text' }, [
			E('i', { 'style': 'display:inline-block;width:.7em;height:.7em;border-radius:2px;margin-right:.3em;background:' + (colours[key] || '#999') }), key
		]);

		const rows = shown.map(e => {
			let what;

			if (e.type == 'gap')
				what = E('span', { 'class': 'tmog4ar-muted' }, [ _('No samples for %s').format(tmog4ar.dur(e.dur)) ]);
			else if (e.type == 'tower')
				what = E('span', {}, [ band(e.to, e.to_good), E('span', { 'class': 'tmog4ar-muted' }, [ ' · ', moved(e) ]) ]);
			else
				what = E('span', {}, [
					band(e.from, e.from_good), ' → ', band(e.to, e.to_good),
					e.nb_from ? E('span', { 'class': 'tmog4ar-muted' }, [ ' · ', moved(e) ]) : ''
				]);

			return E('tr', { 'class': 'tr', 'data-place': 'e:' + e.t + e.type }, [
				cell(tmog4ar.dateTime(e.t, h.tzoff), 'tmog4ar-muted', _('Time')),
				cell(what, '', _('Change'))
			]);
		});

		const out = [ table([ _('Time'), _('Change') ], rows, 'tmog4ar-events') ];

		if (!events.length)
			return E('p', {}, [ E('em', {}, [ _('No band or tower changes in this period.') ]) ]);

		if (events.length > shown.length)
			out.push(E('button', {
				'class': 'cbi-button',
				'click': () => { this.allEvents = true; this.renderHistory(); }
			}, [ _('Show all %d').format(events.length) ]));

		return E('div', {}, out);
	},

	renderHistory() {
		const h = this.hist;

		if (this.histError) {
			dom.content(this.historyNode, E('p', { 'class': 'alert-message warning' }, [ _('Could not load history: %s').format(this.histError) ]));
			return;
		}

		if (!h) {
			dom.content(this.historyNode, E('p', {}, [ E('em', { 'class': 'spinning' }, [ _('Loading history…') ]) ]));
			return;
		}

		if (!h.samples) {
			dom.content(this.historyNode, E('p', {}, [ E('em', {}, [ _('No history in this period yet. The tmog4ar service logs a sample a minute.') ]) ]));
			return;
		}

		const t1 = h.now;
		const t0 = Math.max(h.since, h.first);
		const colours = tmog4ar.palette(h.bands);

		dom.content(this.historyNode, [
			this.renderSummary(h, t0),

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:strip' }, [ _('Band over time') ]),
			tmog4ar.bandStrip(h, t0, t1, colours),
			tmog4ar.legend(h.bands.map(b => ({ colour: colours[b.key], label: b.key, value: '%.1f%%'.format(b.samples / h.samples * 100) }))),

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:signal' }, [ _('Signal'), ' ', E('small', { 'class': 'tmog4ar-muted' }, [
				_('line: average per %s; shaded: min to max; dashed: good and fair levels').format(tmog4ar.dur(h.bucket))
			]) ]),
			E('div', { 'class': 'tmog4ar-charts' }, [
				tmog4ar.lineChart({ h: h, t0: t0, t1: t1, index: 4, metric: 'sinr', unit: _('dB'), label: _('SINR') }),
				tmog4ar.lineChart({ h: h, t0: t0, t1: t1, index: 3, metric: 'rsrp', unit: _('dBm'), label: _('RSRP') })
			]),

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:heat' }, [ _('Good samples by hour') ]),
			tmog4ar.heatmap(h),
			tmog4ar.legend([
				{ colour: tmog4ar.goodColour(1), label: _('99% or more') },
				{ colour: tmog4ar.goodColour(0.95), label: _('90–99%') },
				{ colour: tmog4ar.goodColour(0.6), label: _('50–90%') },
				{ colour: tmog4ar.goodColour(0), label: _('under 50%') }
			]),

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:bands' }, [ _('Time on each band') ]),
			this.renderBands(h, colours),

			(h.towers && h.towers.length) ? E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:towers' }, [ _('Time on each tower') ]) : '',
			(h.towers && h.towers.length) ? this.renderTowers(h) : '',

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:periods' }, [ this.range > 86400 ? _('By day') : _('By hour') ]),
			this.renderPeriods(h),

			E('div', { 'class': 'tmog4ar-sub', 'data-place': 'sub:changes' }, [ _('Changes') ]),
			this.renderEvents(h, colours)
		]);
	},

	// ---- Page ------------------------------------------------------------

	render([ sample, hist, towers ]) {
		tmog4ar.loadCSS();

		this.sample = sample;
		this.hist = hist;
		this.towers = towers;
		this.statusNode = E('div');
		this.historyNode = E('div');
		this.rangeNode = E('div', { 'class': 'tmog4ar-range' }, RANGES.map(([ secs, label ]) =>
			E('button', {
				'class': 'cbi-button' + (secs == this.range ? ' active' : ''),
				'data-range': secs,
				'click': ui.createHandlerFn(this, 'handleRange', secs)
			}, [ label ])));

		this.renderStatus();
		this.renderHistory();

		// The cached sample is free to read; history is a few hundred ms of awk.
		poll.add(() => tmog4ar.latest().then(s => {
			if (s && (!this.sample || s.ts >= this.sample.ts)) {
				this.sample = s;
				keepPlace(() => this.renderStatus());
			}
		}), 10);
		poll.add(() => this.loadHistory(), 300);

		return E([], [
			E('h2', {}, [ _('Cellular') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('The T-Mobile gateway\'s band, channel width and signal, as sampled once a minute by tmog4ar. A sample is good when the gateway is on a preferred band and wide enough; a reboot is recommended once it has been bad for a while.')
			]),
			this.statusNode,
			E('div', { 'class': 'cbi-section', 'style': 'margin-top:1.5em' }, [
				E('h3', {}, [ _('History') ]),
				this.rangeNode,
				this.historyNode
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
