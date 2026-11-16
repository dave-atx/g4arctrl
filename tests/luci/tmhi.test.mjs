// Unit tests for the LuCI module's pure functions (health wording, units,
// towers, tooltip placement). Run with: node --test tests/luci/*.test.mjs
//
// tmhi/common.js is a LuCI module: a function body that returns
// baseclass.extend({...}). It is loaded here with just enough of LuCI around
// it: _() returns the string as is, and String.prototype.format does the
// subset of LuCI's sprintf the module uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../openwrt/luci-app-tmhi/htdocs/luci-static/resources/tmhi/common.js', import.meta.url), 'utf8');

String.prototype.format = function(...args) {
	let i = 0;

	return this.replace(/%(?:\.(\d+))?([sdf%])/g, (m, prec, type) => {
		if (type == '%')
			return '%';

		const v = args[i++];

		if (type == 'd')
			return String(Math.trunc(+v));
		if (type == 'f')
			return (+v).toFixed(prec == null ? 6 : +prec);

		return String(v);
	});
};

const baseclass = { extend: o => o };
const tmhi = new Function('baseclass', 'fs', 'uci', 'ui', 'L', 'E', '_', src)(
	baseclass, {}, {}, {}, {}, () => null, s => s);

// ---- Tooltip placement --------------------------------------------------------

test('tooltip goes right of the cursor when it fits', () => {
	assert.equal(tmhi.tipLeft(100, 200, 1000), 106);
});

// The tooltip near the right edge used to run past the plot and get clipped.
test('tooltip near the right edge goes left of the cursor', () => {
	assert.equal(tmhi.tipLeft(900, 200, 1000), 694);
	assert.equal(tmhi.tipLeft(1000, 200, 1000), 794);
});

test('tooltip stays inside the plot when neither side fits', () => {
	// Phone width: 300 px plot, 250 px tooltip, cursor in the middle.
	assert.equal(tmhi.tipLeft(150, 250, 300), 0);
	assert.equal(tmhi.tipLeft(40, 250, 300), 46);
	assert.equal(tmhi.tipLeft(290, 250, 300), 34);
	// Wider than the plot (it wraps, but just in case): pinned left.
	assert.equal(tmhi.tipLeft(150, 400, 300), 0);
});

// ---- Details popover placement --------------------------------------------------

// Strip segment at 300..328 px in an 800 x 600 viewport, popover 200 x 40.
test('details popover goes below the item, centred on the tap', () => {
	assert.deepEqual(tmhi.popPlace(400, 300, 328, [ 200, 40 ], [ 800, 600 ]), { left: 300, top: 334 });
});

test('details popover goes above the item when there is no room below', () => {
	assert.deepEqual(tmhi.popPlace(400, 560, 588, [ 200, 40 ], [ 800, 600 ]), { left: 300, top: 514 });
});

test('details popover fitting neither side takes the roomier one', () => {
	// 200 px tall in a 300 px viewport: 100 above, 160 below.
	assert.deepEqual(tmhi.popPlace(400, 100, 140, [ 200, 200 ], [ 800, 300 ]), { left: 300, top: 146 });
	// 160 above, 100 below.
	assert.deepEqual(tmhi.popPlace(400, 160, 200, [ 200, 200 ], [ 800, 300 ]), { left: 300, top: -46 });
});

test('details popover stays inside the viewport sideways', () => {
	// Phone width: a tap near either edge.
	assert.equal(tmhi.popPlace(10, 300, 328, [ 250, 40 ], [ 412, 800 ]).left, 6);
	assert.equal(tmhi.popPlace(405, 300, 328, [ 250, 40 ], [ 412, 800 ]).left, 156);
});

// ---- Words -------------------------------------------------------------------

test('dur', () => {
	assert.equal(tmhi.dur(0), '0s');
	assert.equal(tmhi.dur(59), '59s');
	assert.equal(tmhi.dur(60), '1m');
	assert.equal(tmhi.dur(3600 + 120), '1h 2m');
	assert.equal(tmhi.dur(2 * 86400 + 3 * 3600), '2d 3h');
	assert.equal(tmhi.dur(-5), '0s');
});

test('bandOf and mode', () => {
	const s = { nr_bands: 'n41', nr_bw: 100, lte_bands: 'b66', lte_bw: null };

	assert.equal(tmhi.bandOf(s, 'nr_'), 'n41 100 MHz');
	assert.equal(tmhi.bandOf(s, 'lte_'), 'LTE b66');
	assert.equal(tmhi.bandOf({}, 'nr_'), null);
	assert.equal(tmhi.mode(s), '5G NSA');
	assert.equal(tmhi.mode({ nr_bands: 'n41' }), '5G SA');
	assert.equal(tmhi.mode({ lte_bands: 'b66' }), 'LTE');
	assert.equal(tmhi.mode({}), 'No signal');
	assert.equal(tmhi.primary({ lte_bands: 'b66' }), 'lte_');
});

test('quality and fill', () => {
	assert.equal(tmhi.quality('sinr', 20), 'good');
	assert.equal(tmhi.quality('sinr', 5), 'fair');
	assert.equal(tmhi.quality('sinr', -2), 'poor');
	assert.equal(tmhi.quality('sinr', null), null);
	// Width: good from twice min_bw, fair from min_bw.
	assert.equal(tmhi.quality('bw', 100, 40), 'good');
	assert.equal(tmhi.quality('bw', 40, 40), 'fair');
	assert.equal(tmhi.quality('bw', 20, 40), 'poor');
	assert.equal(tmhi.fill('rsrp', -95), 50);
	assert.equal(tmhi.fill('rsrp', -200), 0);
	assert.equal(tmhi.fill('bw', 150), 100);
});

// ---- Health -------------------------------------------------------------------

const now = 1793836800;

function sample(health, extra) {
	return Object.assign({ ts: now, health: Object.assign({ history: true, stuck_minutes: 30, preferred: [ 'n41' ] }, health) }, extra);
}

test('health: ok and down', () => {
	assert.deepEqual(tmhi.health(sample({ level: 'ok', key: 'n41 100 MHz' })),
		{ level: 'ok', title: 'OK', text: 'On n41 100 MHz.' });

	const down = tmhi.health(sample({ level: 'down' }, { error: 'gateway 192.168.12.1:8080 unreachable' }));

	assert.equal(down.title, 'Unreachable');
	assert.equal(down.text, 'gateway 192.168.12.1:8080 unreachable');
	assert.equal(tmhi.health(sample({ level: 'down' })).text, 'The gateway did not answer.');
});

test('health: degraded says when to reboot', () => {
	const h = tmhi.health(sample({ level: 'degraded', why: 'on n25 20 MHz, not n41', since: now - 600, seen: true, first: now - 86400 * 3 }));

	assert.equal(h.level, 'degraded');
	assert.equal(h.text, 'on n25 20 MHz, not n41 for 10m. Reboot if this lasts past 30m.');
});

test('health: degraded with no good sample this week says a reboot won\'t help', () => {
	const h = tmhi.health(sample({ level: 'degraded', why: 'on n25 20 MHz, not n41', since: now - 600, seen: false, first: now - 86400 * 2 }));

	assert.match(h.text, /No good samples in the past 7 days/);
});

test('health: degraded without history says so', () => {
	const h = tmhi.health(sample({ level: 'degraded', why: 'on n25 20 MHz, not n41', history: false }));

	assert.match(h.text, /History logging is off/);
});

test('health: reboot, and a gateway that restarted into the bad band', () => {
	const h = tmhi.health(sample({ level: 'reboot', why: 'on n25 20 MHz, not n41', since: now - 7200, lastgood: now - 7300 }, { uptime: 1800 }));

	assert.equal(h.title, 'Reboot recommended');
	assert.equal(h.text, 'on n25 20 MHz, not n41 for 2h 0m (last good 2h 1m ago). The gateway restarted 30m ago and came back degraded; the n41 cell may be down.');
});

test('health: words the reason code from the CLI', () => {
	const degraded = (health, extra) => tmhi.health(sample(Object.assign({ level: 'degraded', since: now - 600, seen: true, first: now - 86400 * 3, why: 'english from the CLI' }, health), extra)).text;

	assert.equal(degraded({ reason: 'band', key: 'n25 20 MHz' }), 'On n25 20 MHz, not n41 for 10m. Reboot if this lasts past 30m.');
	assert.equal(degraded({ reason: 'band', key: 'n25 20 MHz', preferred: [ 'n41', 'n77' ] }), 'On n25 20 MHz, not n41/n77 for 10m. Reboot if this lasts past 30m.');
	assert.equal(degraded({ reason: 'narrow', key: 'n41 20 MHz', min_bw: 40 }), 'On n41 20 MHz, narrower than 40 MHz for 10m. Reboot if this lasts past 30m.');
	assert.equal(degraded({ reason: 'unregistered', key: '(searching)', since: now - 30 }, { reg: 'searching' }), 'Not registered (searching). Reboot if this lasts past 30m.');
	assert.equal(degraded({ reason: 'unreachable' }), 'Gateway unreachable for 10m. Reboot if this lasts past 30m.');
	// A CLI from before the reason codes.
	assert.equal(degraded({}), 'english from the CLI for 10m. Reboot if this lasts past 30m.');
	assert.equal(degraded({ why: null }), 'Not on a preferred band for 10m. Reboot if this lasts past 30m.');
});

test('health: words why the gateway did not answer', () => {
	const down = extra => tmhi.health(sample({ level: 'down' }, Object.assign({ error: 'english from the CLI' }, extra))).text;

	assert.equal(down({ error_kind: 'unreachable' }), 'The gateway did not answer.');
	assert.equal(down({ error_kind: 'unparseable' }), 'The gateway sent an answer tmhi could not read.');
	assert.equal(down({ error_kind: 'http', http_status: 503 }), 'The gateway answered with HTTP error 503.');
	assert.equal(down({}), 'english from the CLI');
});

test('regWords', () => {
	assert.equal(tmhi.regWords('registered'), 'Registered');
	assert.equal(tmhi.regWords('unreachable'), 'Unreachable');
	assert.equal(tmhi.regWords(undefined), 'Unknown');
	assert.equal(tmhi.regWords('searching'), 'searching');
});

// The module again, with a _() that brackets what it translates and keeps
// the contexts it was given: anything outside the brackets is text a
// translator can't reach.
const seen = [];
const marked = new Function('baseclass', 'fs', 'uci', 'ui', 'L', 'E', '_', src)(
	baseclass, {}, {}, {}, {}, () => null, (s, ctx) => { seen.push([ s, ctx ]); return '«' + s + '»'; });

test('health text is whole translated sentences', () => {
	const texts = [
		marked.health(sample({ level: 'degraded', reason: 'band', key: 'n25 20 MHz', since: now - 600, seen: true, first: now - 86400 * 3 })).text,
		marked.health(sample({ level: 'degraded', reason: 'narrow', key: 'n41 20 MHz', min_bw: 40, history: false })).text,
		marked.health(sample({ level: 'reboot', reason: 'band', key: 'n25 20 MHz', since: now - 7200, lastgood: now - 7300 }, { uptime: 1800 })).text,
		marked.health(sample({ level: 'down' }, { error_kind: 'http', http_status: 503 })).text
	];

	// Sentences may only be joined by a space; nested words (the reason,
	// durations) sit inside their own brackets.
	for (const t of texts) {
		let depth = 0, outside = '';

		for (const c of t) {
			if (c == '«') depth++;
			else if (c == '»') depth--;
			else if (depth == 0) outside += c;
		}

		assert.match(outside, /^ *$/, t);
	}
});

test('compass points and the distance format carry a context', () => {
	seen.length = 0;
	marked.distance({ gps_lat: 47.6101, gps_lon: -122.2015 }, { lat: '47.6201', lon: '-122.1865' }, 'imperial');

	for (const d of [ 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW' ])
		assert.deepEqual(seen.find(x => x[0] == d), [ d, 'compass direction' ]);

	assert.ok(seen.find(x => x[0] == '%.1f %s %s (%d°)')[1]);
});

// ---- Towers -------------------------------------------------------------------

const towers = { list: [ { radio: 'nr', id: '1234567', name: 'Water tower', lat: '47.6201', lon: '-122.1865' }, { id: '7654321' } ] };
const gw = { gps_lat: 47.6101, gps_lon: -122.2015 };

test('findTower and towerName', () => {
	assert.equal(tmhi.findTower(towers, 'nr', 1234567).name, 'Water tower');
	assert.equal(tmhi.findTower(towers, 'lte', 1234567), null);
	assert.equal(tmhi.towerName(towers, 'nr', '1234567'), 'Water tower');
	assert.equal(tmhi.towerName(towers, 'nr', '7654321'), 'gNB 7654321');
	assert.equal(tmhi.towerName(towers, 'lte', '123456'), 'eNB 123456');
});

test('distance and direction to a tower', () => {
	assert.equal(tmhi.distance(gw, towers.list[0], 'imperial'), '1.0 mi NE (45°)');
	assert.equal(tmhi.distance(gw, towers.list[0], 'metric'), '1.6 km NE (45°)');
	assert.equal(tmhi.distance(gw, towers.list[1], 'imperial'), null);
	assert.equal(tmhi.distance({}, towers.list[0], 'imperial'), null);
});

test('parsePosition', () => {
	assert.deepEqual(tmhi.parsePosition('47.6101, -122.2015'), [ '47.6101', '-122.2015' ]);
	assert.deepEqual(tmhi.parsePosition(' 47.6101 -122.2015 '), [ '47.6101', '-122.2015' ]);
	assert.deepEqual(tmhi.parsePosition('https://www.cellmapper.net/map?MCC=310&MNC=260&type=NR&latitude=47.61012345678&longitude=-122.2015&zoom=15'),
		[ '47.610123', '-122.2015' ]);
	assert.deepEqual(tmhi.parsePosition('https://maps.apple.com/?ll=47.6101,-122.2015&q=Tower'), [ '47.6101', '-122.2015' ]);
	assert.deepEqual(tmhi.parsePosition('https://maps.apple.com/?q=47.6101%2C-122.2015'), [ '47.6101', '-122.2015' ]);
	assert.deepEqual(tmhi.parsePosition('https://www.google.com/maps/@47.6101,-122.2015,15z'), [ '47.6101', '-122.2015' ]);
	assert.equal(tmhi.parsePosition('91, 10'), null);
	assert.equal(tmhi.parsePosition('somewhere'), null);
	assert.equal(tmhi.parsePosition(''), null);
});

test('cellMapper link', () => {
	assert.equal(tmhi.cellMapper(Object.assign({ nr_mcc: '310', nr_mnc: '260' }, gw), 'nr'),
		'https://www.cellmapper.net/map?MCC=310&MNC=260&type=NR&latitude=47.6101&longitude=-122.2015&zoom=14');
	assert.equal(tmhi.cellMapper({}, 'lte'), 'https://www.cellmapper.net/map?MCC=310&MNC=260&type=LTE');
});

// ---- Scroll position ------------------------------------------------------------

// Safari lost the place on a reload: the view is drawn after its data loads.
test('restoreTo: back to the saved place after a reload or back / forward', () => {
	const t = 1793836800000;

	const saved = { y: 1500, mark: { key: 'sub:signal', nth: 0, off: 120 }, t: t - 5000 };

	assert.equal(tmhi.restoreTo('reload', saved, t), saved);
	assert.equal(tmhi.restoreTo('back_forward', saved, t), saved);
});

test('restoreTo: not on a new visit, at the top, or for an old or bad entry', () => {
	const t = 1793836800000;

	assert.equal(tmhi.restoreTo('navigate', { y: 1500, t: t - 5000 }, t), null);
	assert.equal(tmhi.restoreTo(undefined, { y: 1500, t: t - 5000 }, t), null);
	assert.equal(tmhi.restoreTo('reload', { y: 0, t: t - 5000 }, t), null);
	assert.equal(tmhi.restoreTo('reload', { y: 1500, t: t - 2 * 3600000 }, t), null);
	assert.equal(tmhi.restoreTo('reload', { y: 1500, t: t + 60000 }, t), null);
	assert.equal(tmhi.restoreTo('reload', null, t), null);
	assert.equal(tmhi.restoreTo('reload', { y: 'x', t: t }, t), null);
});
