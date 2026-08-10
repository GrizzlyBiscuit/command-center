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
    },
    starlight: {
      label: 'Starlight',
      vars: {
        '--bg': '#030712', '--bg-elevated': '#07101f', '--panel': '#0a1528',
        '--panel-soft': '#101d33', '--surface-hover': '#162743', '--surface-active': '#203657',
        '--accent': '#8dbbff', '--accent-2': '#edf5ff', '--accent-3': '#b39cff',
        '--accent-soft': 'rgba(141,187,255,0.14)', '--text': '#f7faff',
        '--text-soft': '#dce7f7', '--muted': '#8fa2bd', '--muted-strong': '#b8c9df',
        '--border': 'rgba(141,187,255,0.26)', '--border-soft': 'rgba(184,211,255,0.15)',
        '--success': '#72e5bd', '--success-soft': 'rgba(114,229,189,0.13)',
        '--warning': '#f4d98a', '--warning-soft': 'rgba(244,217,138,0.13)',
        '--danger': '#ff829c', '--danger-soft': 'rgba(255,130,156,0.13)',
        '--info': '#8dbbff', '--shadow': '0 22px 58px rgba(0,7,24,0.54)',
        '--shadow-soft': '0 10px 28px rgba(0,7,24,0.38)',
        '--theme-shell': 'rgba(4,10,23,0.86)', '--theme-panel-glass': 'rgba(8,18,37,0.76)',
        '--theme-card-glass': 'rgba(12,25,47,0.72)', '--theme-player': 'rgba(4,11,25,0.58)',
        '--theme-player-edge': 'rgba(141,187,255,0.3)', '--theme-glow': 'rgba(141,187,255,0.18)'
      }
    },
    matrix: {
      label: 'Matrix',
      vars: {
        '--bg': '#020704', '--bg-elevated': '#061009', '--panel': '#08140c',
        '--panel-soft': '#0c1d12', '--surface-hover': '#11291a', '--surface-active': '#173923',
        '--accent': '#39ff78', '--accent-2': '#b4ffca', '--accent-3': '#13c95a',
        '--accent-soft': 'rgba(57,255,120,0.13)', '--text': '#eaffef',
        '--text-soft': '#c7e9d0', '--muted': '#76a884', '--muted-strong': '#9ccdaa',
        '--border': 'rgba(57,255,120,0.28)', '--border-soft': 'rgba(117,222,147,0.16)',
        '--success': '#39ff78', '--success-soft': 'rgba(57,255,120,0.13)',
        '--warning': '#d6ff65', '--warning-soft': 'rgba(214,255,101,0.13)',
        '--danger': '#ff6278', '--danger-soft': 'rgba(255,98,120,0.13)',
        '--info': '#73ff9c', '--shadow': '0 22px 58px rgba(0,18,6,0.5)',
        '--shadow-soft': '0 10px 28px rgba(0,18,6,0.36)',
        '--theme-shell': 'rgba(2,10,5,0.9)', '--theme-panel-glass': 'rgba(5,18,10,0.82)',
        '--theme-card-glass': 'rgba(8,24,14,0.78)', '--theme-player': 'rgba(2,12,6,0.64)',
        '--theme-player-edge': 'rgba(57,255,120,0.32)', '--theme-glow': 'rgba(57,255,120,0.18)'
      }
    },
    verse: {
      label: 'Verse',
      vars: {
        '--bg': '#060713', '--bg-elevated': '#0c0d20', '--panel': '#11132a',
        '--panel-soft': '#181b38', '--surface-hover': '#20254a', '--surface-active': '#2a315b',
        '--accent': '#ff365f', '--accent-2': '#3fe7ff', '--accent-3': '#a56cff',
        '--accent-soft': 'rgba(255,54,95,0.14)', '--text': '#fff8fb',
        '--text-soft': '#e8e5f2', '--muted': '#9b9bb5', '--muted-strong': '#c1bfd1',
        '--border': 'rgba(63,231,255,0.3)', '--border-soft': 'rgba(255,54,95,0.18)',
        '--success': '#5cf0ad', '--success-soft': 'rgba(92,240,173,0.13)',
        '--warning': '#ffd35c', '--warning-soft': 'rgba(255,211,92,0.14)',
        '--danger': '#ff365f', '--danger-soft': 'rgba(255,54,95,0.14)',
        '--info': '#3fe7ff', '--shadow': '0 22px 58px rgba(2,4,26,0.52)',
        '--shadow-soft': '0 10px 28px rgba(2,4,26,0.38)',
        '--theme-shell': 'rgba(7,8,24,0.9)', '--theme-panel-glass': 'rgba(12,14,36,0.82)',
        '--theme-card-glass': 'rgba(18,21,48,0.78)', '--theme-player': 'rgba(7,8,25,0.64)',
        '--theme-player-edge': 'rgba(63,231,255,0.32)', '--theme-glow': 'rgba(255,54,95,0.2)'
      }
    },
    aurora: {
      label: 'Aurora',
      vars: {
        '--bg': '#041014', '--bg-elevated': '#08191e', '--panel': '#0d2026',
        '--panel-soft': '#132b32', '--surface-hover': '#193740', '--surface-active': '#214650',
        '--accent': '#65f5bf', '--accent-2': '#8eb8ff', '--accent-3': '#c493ff',
        '--accent-soft': 'rgba(101,245,191,0.13)', '--text': '#f3fffc',
        '--text-soft': '#d7ece9', '--muted': '#89aaa9', '--muted-strong': '#afd0cd',
        '--border': 'rgba(101,245,191,0.25)', '--border-soft': 'rgba(142,184,255,0.16)',
        '--success': '#65f5bf', '--success-soft': 'rgba(101,245,191,0.13)',
        '--warning': '#ffe07c', '--warning-soft': 'rgba(255,224,124,0.13)',
        '--danger': '#ff7e9d', '--danger-soft': 'rgba(255,126,157,0.13)',
        '--info': '#8eb8ff', '--shadow': '0 22px 58px rgba(1,18,24,0.5)',
        '--shadow-soft': '0 10px 28px rgba(1,18,24,0.34)',
        '--theme-shell': 'rgba(4,17,22,0.88)', '--theme-panel-glass': 'rgba(8,27,33,0.8)',
        '--theme-card-glass': 'rgba(12,35,42,0.76)', '--theme-player': 'rgba(4,18,23,0.62)',
        '--theme-player-edge': 'rgba(101,245,191,0.3)', '--theme-glow': 'rgba(142,184,255,0.2)'
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
