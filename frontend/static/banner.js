// Small banner helper: wraps title letters and rotates subtitle lines
(function(){
  function prefersReducedMotion(){
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  function wrapLetters(el){
    if(!el) return;
    if(prefersReducedMotion()) return;
    const text = el.textContent.trim();
    el.innerHTML = '';
    for(const ch of text){
      const span = document.createElement('span');
      span.className = 'neon-glint';
      span.textContent = ch;
      el.appendChild(span);
    }
  }

  function rotateSubtitle(el, lines, interval){
    if(!el || !lines || !lines.length) return;
    let i = 0;
    el.textContent = lines[0];
    if(prefersReducedMotion()) return;
    setInterval(()=>{
      i = (i + 1) % lines.length;
      el.style.opacity = 0;
      setTimeout(()=>{ el.textContent = lines[i]; el.style.opacity = 1; }, 350);
    }, interval || 4500);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    const title = document.querySelector('.neon-banner .title');
    const sub = document.querySelector('.neon-banner .subtitle');
    if(title) wrapLetters(title);
    const lines = [
      'One-stop setup for LLMs & agents',
      'Silent launcher • Encrypted desktop logs',
      'Run agents • Install models • Manage creds'
    ];
    rotateSubtitle(sub, lines, 4800);
  });
})();
