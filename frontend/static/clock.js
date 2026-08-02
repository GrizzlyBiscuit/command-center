// Clock — live neon clock + multi-timezone readout. Pure local, updates every second.
(function () {
  var ZONES = [
    { label: 'Local',     tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { label: 'UTC',       tz: 'UTC' },
    { label: 'New York',  tz: 'America/New_York' },
    { label: 'London',    tz: 'Europe/London' },
    { label: 'Tokyo',     tz: 'Asia/Tokyo' }
  ];
  var timers = [];
  function fmt(d, tz) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZone: tz
      }).format(d);
    } catch (e) { return '--:--:--'; }
  }
  function dateStr(d) {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }).format(d);
  }
  function render() {
    var now = new Date();
    var main = document.getElementById('clock-main');
    var date = document.getElementById('clock-date');
    var zones = document.getElementById('clock-zones');
    if (main) main.textContent = fmt(now, ZONES[0].tz);
    if (date) date.textContent = dateStr(now);
    if (zones) {
      zones.innerHTML = '';
      ZONES.forEach(function (z) {
        var row = document.createElement('div');
        row.className = 'clock-zone';
        var name = document.createElement('span');
        name.className = 'clock-zone-name'; name.textContent = z.label;
        var time = document.createElement('span');
        time.className = 'clock-zone-time'; time.textContent = fmt(now, z.tz);
        row.appendChild(name); row.appendChild(time);
        zones.appendChild(row);
      });
    }
  }
  window.CCClock = {
    onShow: function () {
      render();
      if (timers.length === 0) timers.push(setInterval(render, 1000));
    },
    onHide: function () {
      timers.forEach(clearInterval); timers = [];
    }
  };
  // Self-start: the clock now lives on the Home page (no dedicated tab),
  // so render immediately and keep ticking regardless of tab visibility.
  render();
  if (timers.length === 0) timers.push(setInterval(render, 1000));
})();
