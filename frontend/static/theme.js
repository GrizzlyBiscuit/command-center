// Appearance picker - swaps a complete accent/surface palette on <html>.
// Legacy storage keys remain valid so existing installations migrate cleanly.
(function () {
  var DEFAULT_THEME = 'synthwave';
  var THEMES = {
    outrun: { label: 'Graphite', vars: {} },
    vaporwave: {
      label: 'Indigo',
      vars: {
        '--accent': '#8b7cf6', '--accent-2': '#b2a9ff', '--accent-3': '#8b7cf6',
        '--accent-soft': 'rgba(139,124,246,0.13)'
      }
    },
    cyberpunk: {
      label: 'Sage',
      vars: {
        '--accent': '#5fa887', '--accent-2': '#83c4a5', '--accent-3': '#5fa887',
        '--accent-soft': 'rgba(95,168,135,0.13)'
      }
    },
    bloodmoon: {
      label: 'Clay',
      vars: {
        '--accent': '#c98267', '--accent-2': '#e2a28b', '--accent-3': '#c98267',
        '--accent-soft': 'rgba(201,130,103,0.13)'
      }
    },
    ice: {
      label: 'Glacier',
      vars: {
        '--accent': '#559bd6', '--accent-2': '#7eb7e6', '--accent-3': '#559bd6',
        '--accent-soft': 'rgba(85,155,214,0.13)'
      }
    },
    midnight: {
      label: 'Ink',
      vars: {
        '--bg': '#070a0f', '--bg-elevated': '#0c1118', '--panel': '#10161f',
        '--panel-soft': '#151d28', '--surface-hover': '#192331',
        '--accent': '#7483df', '--accent-2': '#9da8f2', '--accent-3': '#7483df',
        '--accent-soft': 'rgba(116,131,223,0.13)', '--border': '#222d3b'
      }
    },
    neon: {
      label: 'Ocean',
      vars: {
        '--bg': '#081015', '--bg-elevated': '#0d171e', '--panel': '#101c25',
        '--panel-soft': '#162530', '--surface-hover': '#1a2c38',
        '--accent': '#4c9faf', '--accent-2': '#76bdca', '--accent-3': '#4c9faf',
        '--accent-soft': 'rgba(76,159,175,0.13)', '--border': '#243742'
      }
    },
    synthwave: {
      label: 'Synthwave',
      vars: {
        '--bg': '#080315', '--bg-elevated': '#100722', '--panel': '#170b30',
        '--panel-soft': '#21103d', '--surface-hover': '#2b174b', '--surface-active': '#38205f',
        '--accent': '#ff4fb7', '--accent-2': '#43e7ff', '--accent-3': '#a56dff',
        '--accent-soft': 'rgba(255,79,183,0.14)', '--text': '#fff7ff',
        '--text-soft': '#eadff3', '--muted': '#aa9cbd', '--muted-strong': '#c8b9d7',
        '--border': 'rgba(67,231,255,0.28)', '--border-soft': 'rgba(193,119,255,0.18)',
        '--success': '#58efaa', '--success-soft': 'rgba(88,239,170,0.13)',
        '--warning': '#ffd166', '--warning-soft': 'rgba(255,209,102,0.14)',
        '--danger': '#ff6685', '--danger-soft': 'rgba(255,102,133,0.13)',
        '--info': '#43e7ff', '--shadow': '0 22px 58px rgba(20,2,48,0.42)',
        '--shadow-soft': '0 10px 28px rgba(20,2,48,0.32)'
      }
    }
  };

  function apply(name) {
    var root = document.documentElement;
    var selected = THEMES[name] ? name : DEFAULT_THEME;
    // clear old theme vars
    Object.keys(THEMES).forEach(function (k) {
      var v = THEMES[k].vars;
      if (v) Object.keys(v).forEach(function (p) { root.style.removeProperty(p); });
    });
    var t = THEMES[selected];
    if (t.vars) Object.keys(t.vars).forEach(function (p) { root.style.setProperty(p, t.vars[p]); });
    root.setAttribute('data-theme', selected);
    try { localStorage.setItem('cc_theme', selected); } catch (e) {}
    // refresh active state in the picker if present
    document.querySelectorAll('.theme-swatch').forEach(function (s) {
      var active = s.dataset.theme === selected;
      s.classList.toggle('active', active);
      s.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var out = document.getElementById('theme-current');
    if (out) out.textContent = t.label;
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem('cc_theme'); } catch (e) {}
    var selected = THEMES[saved] ? saved : DEFAULT_THEME;
    // build swatches if the picker exists
    var wrap = document.getElementById('theme-swatches');
    if (wrap && !wrap.dataset.built) {
      wrap.dataset.built = '1';
      Object.keys(THEMES).forEach(function (k) {
        var t = THEMES[k];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-swatch';
        b.dataset.theme = k;
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('data-tip', t.label + ' palette');
        b.style.setProperty('--sw1', (t.vars && t.vars['--accent']) || '#7c8cff');
        b.style.setProperty('--sw2', (t.vars && t.vars['--accent-2']) || '#98a5ff');
        b.innerHTML = '<span class="theme-dot"></span><span class="theme-name">' + t.label + '</span>';
        b.onclick = function () { apply(k); };
        wrap.appendChild(b);
      });
    }
    apply(selected);
  }

  window.CCTheme = { apply: apply, list: function () { return Object.keys(THEMES); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
