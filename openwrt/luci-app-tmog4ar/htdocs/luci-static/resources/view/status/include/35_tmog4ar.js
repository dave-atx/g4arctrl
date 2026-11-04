'use strict';
'require baseclass';
'require tmog4ar';

// A card on Status > Overview. It reads the sample the tmog4ar service keeps,
// so the page's polling never reaches the gateway.

return baseclass.extend({
	title: _('Cellular'),

	load() {
		tmog4ar.loadCSS();

		return Promise.all([ tmog4ar.latest(), tmog4ar.towers() ]);
	},

	render([ s, towers ]) {
		if (!s)
			return null;

		const health = tmog4ar.health(s);
		const p = tmog4ar.primary(s);
		const fields = [
			_('Health'), E('span', {}, [ tmog4ar.badge(health), ' ', health.text ]),
			_('Band'), p ? '%s · %s'.format(tmog4ar.mode(s), [ tmog4ar.bandOf(s, 'nr_'), tmog4ar.bandOf(s, 'lte_') ].filter(x => x).join(' + ')) : tmog4ar.mode(s),
			_('Tower'), (p && s[p + 'nb'] != null) ? (() => {
				const radio = p.slice(0, -1), t = tmog4ar.findTower(towers, radio, s[p + 'nb']);
				const dir = t ? tmog4ar.direction(s, t, towers.units) : null;

				return E('span', {}, [ tmog4ar.towerName(towers, radio, s[p + 'nb']), dir ? ' · ' : '', dir || '' ]);
			})() : null,
			_('Signal'), p ? _('RSRP %s dBm · SINR %s dB').format(s[p + 'rsrp'] ?? '-', s[p + 'sinr'] ?? '-') : null,
			_('Updated'), E('span', {}, [
				tmog4ar.ago(s.ts), ' · ',
				E('a', { 'href': L.url('admin/status/tmog4ar') }, [ _('Details and history') ])
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
