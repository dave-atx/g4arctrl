'use strict';
'require view';
'require form';

return view.extend({
	render() {
		const m = new form.Map('tmog4ar', _('Cellular gateway'),
			_('Settings for tmog4ar, which samples the T-Mobile TMO-G4AR gateway once a minute. Saving restarts the sampler.'));

		const s = m.section(form.NamedSection, 'main', 'tmog4ar');
		s.addremove = false;
		s.tab('gateway', _('Gateway'));
		s.tab('health', _('Health'));
		s.tab('history', _('History'));

		let o;

		o = s.taboption('gateway', form.Value, 'password', _('Admin password'),
			_('The gateway\'s admin password. Needed for channel width, PCI, ARFCN, CQI and reboot; band and signal work without it. After a failed login with a password, tmog4ar waits 15 minutes before trying that same password again, so the gateway doesn\'t lock it out.'));
		o.password = true;
		o.rmempty = true;

		o = s.taboption('gateway', form.Value, 'username', _('Admin username'));
		o.placeholder = 'admin';
		o.rmempty = true;

		o = s.taboption('gateway', form.Value, 'host', _('Gateway address'));
		o.datatype = 'host';
		o.placeholder = '192.168.12.1';
		o.rmempty = true;

		o = s.taboption('gateway', form.Value, 'port', _('API port'));
		o.datatype = 'port';
		o.placeholder = '8080';
		o.rmempty = true;

		o = s.taboption('gateway', form.Value, 'timeout', _('Request timeout'), _('Seconds.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '10';
		o.rmempty = true;

		o = s.taboption('health', form.DynamicList, 'preferred_band', _('Preferred bands'),
			_('Bands that count as healthy, as the gateway names them (e.g. n41).'));
		o.placeholder = 'n41';
		o.validate = function(section_id, value) {
			return (value == '' || /^[A-Za-z0-9]+$/.test(value)) ? true : _('One band name, letters and digits only');
		};

		o = s.taboption('health', form.Value, 'min_bw', _('Narrowest healthy channel'),
			_('MHz. A preferred band narrower than this counts as unhealthy (only known with the admin password).'));
		o.datatype = 'uinteger';
		o.placeholder = '40';
		o.rmempty = true;

		o = s.taboption('health', form.Value, 'stuck_minutes', _('Reboot after'),
			_('Minutes of unhealthy samples before a reboot is recommended. Shorter drops are normal handovers.'));
		o.datatype = 'range(1,1440)';
		o.placeholder = '30';
		o.rmempty = true;

		o = s.taboption('history', form.Value, 'history_dir', _('History directory'),
			_('One file per day. Only the default is kept across sysupgrade.'));
		o.placeholder = '/root/.tmog4ar';
		o.rmempty = true;

		o = s.taboption('history', form.Value, 'retention_days', _('Keep history for'), _('Days.'));
		o.datatype = 'range(1,365)';
		o.placeholder = '30';
		o.rmempty = true;

		o = s.taboption('history', form.Value, 'flush_minutes', _('Write to flash every'),
			_('Minutes. Samples wait in RAM in between, which saves flash wear; a power cut loses at most this much. 0 writes every sample.'));
		o.datatype = 'range(0,1440)';
		o.placeholder = '60';
		o.rmempty = true;

		o = s.taboption('history', form.ListValue, 'units', _('Distance units'), _('For the distance to named towers.'));
		o.value('imperial', _('Miles'));
		o.value('metric', _('Kilometres'));
		o.default = 'imperial';

		const t = m.section(form.GridSection, 'tower', _('Towers'),
			_('Names for the towers the gateway uses, so the status page and history say "Water tower" rather than a gNB number. With a location you also get the distance and direction from the gateway and a map link. The easiest way to add one is "Name it…" next to the tower on the status page.'));
		t.anonymous = true;
		t.addremove = true;
		t.nodescriptions = true;

		o = t.option(form.ListValue, 'radio', _('Network'));
		o.value('nr', _('5G (gNB)'));
		o.value('lte', _('LTE (eNB)'));
		o.default = 'nr';

		o = t.option(form.Value, 'id', _('Tower ID'));
		o.datatype = 'uinteger';
		o.rmempty = false;

		o = t.option(form.Value, 'name', _('Name'));
		o.rmempty = false;

		o = t.option(form.Value, 'lat', _('Latitude'));
		o.datatype = 'range(-90,90)';
		o.placeholder = '47.6101';

		o = t.option(form.Value, 'lon', _('Longitude'));
		o.datatype = 'range(-180,180)';
		o.placeholder = '-122.2015';

		return m.render();
	}
});
