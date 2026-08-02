(function(){
  const out = document.getElementById('terminal-output');
  const input = document.getElementById('terminal-input');
  const send = document.getElementById('terminal-send');
  let lineCount = 0;

  function pushLine(text){
    const el = document.createElement('div');
    el.className = 'terminal-line';
    el.textContent = text;
    out.appendChild(el);
    out.scrollTop = out.scrollHeight;
    lineCount += 1;
  }

  function loadLogEntries(){
    fetch('/admin/log').then(r=>r.text()).then(html=>{
      try{
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const items = dom.querySelectorAll('.agent-card, ul.agent-list li, .panel li');
        if(items && items.length){
          items.forEach((it,i)=>{
            const text = it.innerText.replace(/\s+/g,' ').trim();
            setTimeout(()=> pushLine(text), i*120);
          });
        } else {
          pushLine('No recent log entries found.');
        }
      }catch(e){ pushLine('Failed to load log entries.'); }
    }).catch(()=> pushLine('Log fetch failed.'));
  }

  function simulateBoot(){
    const lines = [
      'GlitchGremlin v1.0 initializing...',
      'Loading agents...',
      'Secure store: OK',
      'Encrypted desktop log: OK',
      'UI: Neon renderer online',
      'Ready. Type > run agent-name'
    ];
    lines.forEach((l,i)=> setTimeout(()=> pushLine(l), i*300));
    setTimeout(loadLogEntries, lines.length*300 + 200);
  }

  function connectStream(){
    if(typeof EventSource === 'undefined'){
      pushLine('Live stream not supported by this browser.');
      return;
    }
    const source = new EventSource('/stream');
    source.onmessage = e => {
      if(e.data){
        pushLine('[LIVE] ' + e.data);
      }
    };
    source.onerror = () => {
      pushLine('Live stream disconnected.');
      source.close();
    };
  }

  if (send && input) {
    send.addEventListener('click', ()=>{
      const v = input.value.trim();
      if(!v) return;
      pushLine('> ' + v);
      input.value = '';
      // simple local echo: pretend we ran an agent
      setTimeout(()=> pushLine('Running: ' + v + ' — completed. Result: OK'), 600);
    });

    input.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') send.click(); });
  }

  function setupInstallWizard(){
    const form = document.getElementById('llm-install-form');
    const preview = document.getElementById('install-command-preview');
    const copyButton = document.getElementById('copy-command');
    if(!form || !preview) return;

    form.addEventListener('submit', async (event)=>{
      event.preventDefault();
      const data = new FormData(form);
      try{
        const res = await fetch(form.action, { method: 'POST', body: data });
        const json = await res.json();
        if(json.ok){
          preview.textContent = json.command;
        } else {
          preview.textContent = 'Error: ' + json.error;
        }
      } catch(err){
        preview.textContent = 'Request failed: ' + err.message;
      }
    });

    if(copyButton){
      copyButton.addEventListener('click', ()=>{
        const text = preview.textContent.trim();
        if(!text) return;
        navigator.clipboard.writeText(text).then(()=>{
          copyButton.textContent = 'Copied!';
          setTimeout(()=>copyButton.textContent = 'Copy command', 1200);
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    if (!out) return;  // no terminal on this page (e.g. Setup/Admin) — skip the console
    simulateBoot();
    connectStream();
    setupInstallWizard();
  });
})();
