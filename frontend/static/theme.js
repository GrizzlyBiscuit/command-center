// Theme Switcher — swaps the synthwave palette by setting data-theme on <html>.
// Each theme overrides the :root CSS variables. Preference saved to localStorage.
(function () {
  var THEMES = {
    outrun:    { label: 'Outrun',     vars: {} }, // default, uses :root
    vaporwave: {
      label: 'Vaporwave',
      vars: {
        '--accent': '#ff71ce', '--accent-2': '#b967ff', '--accent-3': '#01cdfe',
        '--sun-1': '#fff200', '--sun-2': '#ff9ff3', '--sun-3': '#ff2d95',
        '--muted': '#c8b6ff', '--border': 'rgba(255,113,206,0.5)',
        '--shadow': '0 25px 80px rgba(185,103,255,0.5)'
      }
    },
    cyberpunk: {
      label: 'Cyberpunk',
      vars: {
        '--accent': '#39ff14', '--accent-2': '#ffb000', '--accent-3': '#00e5ff',
        '--sun-1': '#e8ff00', '--sun-2': '#ffb000', '--sun-3': '#ff3c00',
        '--muted': '#a8ffcf', '--border': 'rgba(57,255,20,0.45)',
        '--shadow': '0 25px 80px rgba(0,180,90,0.45)'
      }
    },
    bloodmoon: {
      label: 'Blood Moon',
      vars: {
        '--accent': '#ff2d55', '--accent-2': '#ff6b3d', '--accent-3': '#ffd24a',
        '--sun-1': '#ffd24a', '--sun-2': '#ff6b3d', '--sun-3': '#b3001b',
        '--muted': '#ffb3a7', '--border': 'rgba(255,45,85,0.5)',
        '--shadow': '0 25px 80px rgba(150,0,30,0.6)'
      }
    },
    ice: {
      label: 'Ice',
      vars: {
        '--accent': '#35c4ff', '--accent-2': '#5d7bff', '--accent-3': '#b6f0ff',
        '--sun-1': '#eaffff', '--sun-2': '#7fd8ff', '--sun-3': '#2a7bff',
        '--muted': '#b6e6ff', '--border': 'rgba(53,196,255,0.5)',
        '--shadow': '0 25px 80px rgba(40,120,200,0.5)'
      }
    },
    // --- Dark Mode page presets: two synthwave looks, not a light/dark invert ---
    midnight: {
      label: 'Midnight',
      vars: {
        '--bg': '#05010f',
        '--panel': 'rgba(12, 4, 30, 0.82)',
        '--panel-soft': 'rgba(18, 7, 42, 0.92)',
        '--accent': '#ff2d95', '--accent-2': '#7b3fff', '--accent-3': '#2bd4ff',
        '--sun-1': '#ffd24a', '--sun-2': '#ff6b9d', '--sun-3': '#7a1bff',
        '--text': '#e9d8ff', '--muted': '#9a7fd6', '--border': 'rgba(123,63,255,0.32)',
        '--shadow': '0 18px 60px rgba(40,0,90,0.5)'
      }
    },
    neon: {
      label: 'Neon',
      vars: {
        '--bg': '#0c0220',
        '--panel': 'rgba(28, 8, 56, 0.8)',
        '--panel-soft': 'rgba(40, 12, 72, 0.9)',
        '--accent': '#ff2d95', '--accent-2': '#b957ff', '--accent-3': '#35f0ff',
        '--sun-1': '#fff200', '--sun-2': '#ff8a3c', '--sun-3': '#ff2d00',
        '--text': '#fff0ff', '--muted': '#ffb3f0', '--border': 'rgba(255,45,149,0.6)',
        '--shadow': '0 25px 90px rgba(255,45,149,0.55)'
      }
    }
  };

  function apply(name) {
    var root = document.documentElement;
    // clear old theme vars
    Object.keys(THEMES).forEach(function (k) {
      var v = THEMES[k].vars;
      if (v) Object.keys(v).forEach(function (p) { root.style.removeProperty(p); });
    });
    var t = THEMES[name] || THEMES.outrun;
    if (t.vars) Object.keys(t.vars).forEach(function (p) { root.style.setProperty(p, t.vars[p]); });
    root.setAttribute('data-theme', name);
    try { localStorage.setItem('cc_theme', name); } catch (e) {}
    // refresh active state in the picker if present
    document.querySelectorAll('.theme-swatch').forEach(function (s) {
      s.classList.toggle('active', s.dataset.theme === name);
    });
    var out = document.getElementById('theme-current');
    if (out) out.textContent = t.label;
  }

  function init() {
    var saved = null;
    try { saved = localStorage.getItem('cc_theme'); } catch (e) {}
    if (THEMES[saved]) apply(saved);
    // build swatches if the picker exists
    var wrap = document.getElementById('theme-swatches');
    if (wrap && !wrap.dataset.built) {
      wrap.dataset.built = '1';
      Object.keys(THEMES).forEach(function (k) {
        var t = THEMES[k];
        var b = document.createElement('button');
        b.className = 'theme-swatch';
        b.dataset.theme = k;
        b.setAttribute('data-tip', t.label + ' palette');
        b.style.setProperty('--sw1', (t.vars && t.vars['--accent']) || '#ff2d95');
        b.style.setProperty('--sw2', (t.vars && t.vars['--accent-3']) || '#35c4ff');
        b.innerHTML = '<span class="theme-dot"></span><span class="theme-name">' + t.label + '</span>';
        b.onclick = function () { apply(k); };
        wrap.appendChild(b);
      });
      apply(THEMES[saved] ? saved : 'outrun');
    }
  }

  window.CCTheme = { apply: apply, list: function () { return Object.keys(THEMES); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
