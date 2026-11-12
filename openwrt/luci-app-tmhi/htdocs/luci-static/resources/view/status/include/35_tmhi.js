'use strict';
'require baseclass';
'require tmhi';

// A card on Status > Overview. It reads the sample the tmhi service keeps,
// so the page's polling never reaches the gateway.

return baseclass.extend({
	title: _('Cellular'),

	load() {
		tmhi.loadCSS();

		return Promise.all([ tmhi.latest(), tmhi.towers() ]);
	},

	render([ s, towers ]) {
		if (!s)
			return null;

		const health = tmhi.health(s);
		const p = tmhi.primary(s);
		const fields = [
			_('Health'), E('span', {}, [ tmhi.badge(health), ' ', health.text ]),
			_('Band'), p ? '%s · %s'.format(tmhi.mode(s), [ tmhi.bandOf(s, 'nr_'), tmhi.bandOf(s, 'lte_') ].filter(x => x).join(' + ')) : tmhi.mode(s),
			_('Tower'), (p && s[p + 'nb'] != null) ? (() => {
				const radio = p.slice(0, -1), t = tmhi.findTower(towers, radio, s[p + 'nb']);
				const dir = t ? tmhi.direction(s, t, towers.units) : null;

				return E('span', {}, [ tmhi.towerName(towers, radio, s[p + 'nb']), dir ? ' · ' : '', dir || '' ]);
			})() : null,
			_('Signal'), p ? _('RSRP %s dBm · SINR %s dB').format(s[p + 'rsrp'] ?? '-', s[p + 'sinr'] ?? '-') : null,
			_('Updated'), E('span', {}, [
				tmhi.ago(s.ts), ' · ',
				E('a', { 'href': L.url('admin/status/tmhi') }, [ _('Details and history') ])
			])
		];

		const table = E('table', { 'class': 'table' });

		for (let i = 0; i < fields.length; i += 2) {
			if (fields[i + 1] == null)
				continue;

			table.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, [ fields[i] ]),
				E('td', { 'class': 'td left' }, [ fields[i + 1] ])
			]));
		}

		return table;
	}
});
