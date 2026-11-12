// Unit tests for the LuCI module's pure functions (health wording, units,
// towers, tooltip placement). Run with: node --test tests/luci/*.test.mjs
//
// tmhi.js is a LuCI module: a function body that returns
// baseclass.extend({...}). It is loaded here with just enough of LuCI around
// it: _() returns the string as is, and String.prototype.format does the
// subset of LuCI's sprintf the module uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../openwrt/luci-app-tmhi/htdocs/luci-static/resources/tmhi.js', import.meta.url), 'utf8');

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
