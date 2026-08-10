// Appearance picker - swaps a complete accent/surface palette on <html>.
// Legacy storage keys remain valid so existing installations migrate cleanly.
(function () {
  var DEFAULT_THEME = 'synthwave';
  var THEMES = {
    outrun: { label: 'Graphite', vars: {} },
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
    iceage: {
      label: 'Ice Age',
      vars: {
        '--bg': '#020a12', '--bg-elevated': '#061520', '--panel': '#0a1c29',
        '--panel-soft': '#102938', '--surface-hover': '#173849', '--surface-active': '#205066',
        '--accent': '#72e6ff', '--accent-2': '#e9fcff', '--accent-3': '#8baeff',
        '--accent-soft': 'rgba(114,230,255,0.14)', '--text': '#f5fdff',
        '--text-soft': '#d9f2f7', '--muted': '#83a8b4', '--muted-strong': '#b2d4dc',
        '--border': 'rgba(134,230,255,0.3)', '--border-soft': 'rgba(188,240,255,0.17)',
        '--success': '#79f0d0', '--success-soft': 'rgba(121,240,208,0.13)',
        '--warning': '#e9f7ad', '--warning-soft': 'rgba(233,247,173,0.13)',
        '--danger': '#ff829d', '--danger-soft': 'rgba(255,130,157,0.13)',
        '--info': '#9adfff', '--shadow': '0 22px 58px rgba(0,12,24,0.54)',
        '--shadow-soft': '0 10px 28px rgba(0,12,24,0.38)',
        '--theme-shell': 'rgba(3,15,24,0.88)', '--theme-panel-glass': 'rgba(7,27,40,0.72)',
        '--theme-card-glass': 'rgba(11,36,50,0.7)', '--theme-player': 'rgba(3,20,30,0.58)',
        '--theme-player-edge': 'rgba(134,230,255,0.36)', '--theme-glow': 'rgba(114,230,255,0.22)'
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
    },
    forest: {
      label: 'Forest',
      vars: {
        '--bg': '#030b08', '--bg-elevated': '#07150f', '--panel': '#0b1d15',
        '--panel-soft': '#112a1e', '--surface-hover': '#183927', '--surface-active': '#215036',
        '--accent': '#78e89f', '--accent-2': '#e4ff9a', '--accent-3': '#55c9a5',
        '--accent-soft': 'rgba(120,232,159,0.14)', '--text': '#f5fff7',
        '--text-soft': '#d7eddd', '--muted': '#82a58d', '--muted-strong': '#accbb4',
        '--border': 'rgba(120,232,159,0.27)', '--border-soft': 'rgba(188,238,159,0.15)',
        '--success': '#78e89f', '--success-soft': 'rgba(120,232,159,0.13)',
        '--warning': '#e4ff9a', '--warning-soft': 'rgba(228,255,154,0.13)',
        '--danger': '#ff7f82', '--danger-soft': 'rgba(255,127,130,0.13)',
        '--info': '#72d7c1', '--shadow': '0 22px 58px rgba(0,18,9,0.52)',
        '--shadow-soft': '0 10px 28px rgba(0,18,9,0.36)',
        '--theme-shell': 'rgba(3,15,10,0.88)', '--theme-panel-glass': 'rgba(8,29,19,0.76)',
        '--theme-card-glass': 'rgba(12,38,25,0.72)', '--theme-player': 'rgba(4,22,14,0.6)',
        '--theme-player-edge': 'rgba(120,232,159,0.32)', '--theme-glow': 'rgba(228,255,154,0.18)'
      }
    },
    ember: {
      label: 'Ember',
      vars: {
        '--bg': '#100402', '--bg-elevated': '#1b0804', '--panel': '#271008',
        '--panel-soft': '#35160c', '--surface-hover': '#472013', '--surface-active': '#5e2a17',
        '--accent': '#ff7b32', '--accent-2': '#ffd36a', '--accent-3': '#ff3d2e',
        '--accent-soft': 'rgba(255,123,50,0.15)', '--text': '#fff8f2',
        '--text-soft': '#f2ddd0', '--muted': '#b18f7e', '--muted-strong': '#d3b09d',
        '--border': 'rgba(255,123,50,0.3)', '--border-soft': 'rgba(255,193,103,0.17)',
        '--success': '#8de19e', '--success-soft': 'rgba(141,225,158,0.13)',
        '--warning': '#ffd36a', '--warning-soft': 'rgba(255,211,106,0.14)',
        '--danger': '#ff5546', '--danger-soft': 'rgba(255,85,70,0.14)',
        '--info': '#ff9d5c', '--shadow': '0 22px 58px rgba(32,5,0,0.56)',
        '--shadow-soft': '0 10px 28px rgba(32,5,0,0.4)',
        '--theme-shell': 'rgba(20,6,3,0.89)', '--theme-panel-glass': 'rgba(38,12,6,0.77)',
        '--theme-card-glass': 'rgba(49,17,8,0.73)', '--theme-player': 'rgba(27,8,3,0.62)',
        '--theme-player-edge': 'rgba(255,123,50,0.36)', '--theme-glow': 'rgba(255,92,38,0.22)'
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
