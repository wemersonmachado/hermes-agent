/*
 * BROW PWA data bridge v7.
 * Keeps the legacy view markup intact while replacing local-only state with
 * the same authenticated Worker API used by Dashboard and Telegram.
 */
(() => {
  'use strict';

  const api = async (path, options = {}) => {
    const response = await fetch(`/api/hermes/${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  };
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fullId = (value) => String(value ?? '');
  const notify = (message) => window.alert(message);

  const originalLoadChat = window.loadChatMessagesFromStoragePwa;
  window.loadChatMessagesFromStoragePwa = async function loadSharedChat() {
    try {
      const data = await api('chat-history');
      chatHistory = (data.messages || []).map((m) => ({
        id: String(m.id), text: m.text, content: m.text, role: m.role,
        isUser: m.role === 'user', sender: m.role === 'user' ? 'Você' : 'BROW',
        timestamp: new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      }));
      saveChatMessagesToStoragePwa();
      renderAllSavedChatBubbles();
    } catch (_) {
      originalLoadChat();
    }
  };

  window.clearVoiceChatHistoryPwa = function clearLocalProjectionOnly() {
    if (!confirm('Limpar somente a visualização deste aparelho? A memória compartilhada será preservada.')) return;
    chatHistory = [];
    saveChatMessagesToStoragePwa();
    renderAllSavedChatBubbles();
  };

  window.loadGoals = async function loadGoalsFromCloud() {
    const el = document.getElementById('pwa-goals-list');
    try {
      const data = await api('goals');
      globalGoals = (data.rows || []).map((g) => ({ ...g, id: fullId(g.id), targetDate: g.due_date || '', progress: Number(g.target_value) ? Math.round(Number(g.current_value) / Number(g.target_value) * 100) : Number(g.current_value || 0), category: g.unit || 'Pessoal' }));
      document.getElementById('tab-goals-count').textContent = String(globalGoals.length);
      if (!globalGoals.length) { el.innerHTML = '<div class="empty-state">Nenhuma meta cadastrada.</div>'; return; }
      el.innerHTML = globalGoals.map((g) => `<div class="item-card"><div class="item-info"><div class="item-title">🎯 ${escapeHtml(g.title)}</div><div class="item-sub">${escapeHtml(g.category)} · ${escapeHtml(g.targetDate || 'Sem prazo')} · ${g.progress}%</div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${Math.min(100,g.progress)}%"></div></div></div><div><button class="btn-toggle" onclick="updateGoalProgressPwa('${g.id}',10)">+10%</button><button class="btn-delete" onclick="deleteGoalPwa('${g.id}')">Excluir</button></div></div>`).join('');
    } catch (e) { if (el) el.innerHTML = `<div class="error-state">Falha ao carregar metas: ${escapeHtml(e.message)}</div>`; }
  };
  window.addGoalPwa = async function addGoalCloud() {
    const title = document.getElementById('goal-title-input')?.value.trim(); if (!title) return;
    const unit = document.getElementById('goal-cat-input')?.value || 'Pessoal';
    const due_date = document.getElementById('goal-date-input')?.value || null;
    await api('goals', json('POST', { title, unit, target_value: 100, current_value: 0, due_date }));
    document.getElementById('goal-title-input').value = ''; await loadGoals(); await loadOverview();
  };
  window.updateGoalProgressPwa = async function updateGoalCloud(id, delta) { const g = globalGoals.find((x) => x.id === id); if (!g) return; await api(`goals/${id}`, json('PATCH', { current_value: Math.min(100, g.progress + delta) })); await loadGoals(); };
  window.setGoalProgressPwa = async function setGoalCloud(id, value) { await api(`goals/${id}`, json('PATCH', { current_value: value })); await loadGoals(); };
  window.deleteGoalPwa = async function deleteGoalCloud(id) { if (!confirm('Excluir esta meta?')) return; await api(`goals/${id}`, { method: 'DELETE' }); await loadGoals(); };

  window.loadTasks = async function loadTasksCloud() {
    const el = document.getElementById('pwa-tasks-list');
    try {
      const data = await api('tasks');
      globalTasks = (data.rows || []).map((t) => ({ ...t, id: fullId(t.id), dueDate: t.due_date || '', priority: t.priority || 'média' }));
      const filtered = currentTaskPriorityFilter === 'all' ? globalTasks : globalTasks.filter((t) => t.priority === currentTaskPriorityFilter);
      document.getElementById('tab-tasks-count').textContent = String(globalTasks.filter((t) => !t.done).length);
      if (!filtered.length) { el.innerHTML = '<div class="empty-state">Nenhuma tarefa nesta categoria.</div>'; return; }
      el.innerHTML = filtered.map((t) => `<div class="item-card"><div class="item-info"><div class="item-title" style="${t.done?'text-decoration:line-through;opacity:.6':''}">${t.done?'✅':'📌'} ${escapeHtml(t.title)}</div><div class="item-sub">${escapeHtml(t.priority)} · ${escapeHtml(t.dueDate || 'Sem prazo')}</div></div><div><button class="btn-toggle" onclick="toggleTaskPwa('${t.id}')">${t.done?'Reabrir':'Concluir'}</button><button class="btn-delete" onclick="deleteTaskPwa('${t.id}')">Excluir</button></div></div>`).join('');
    } catch (e) { if (el) el.innerHTML = `<div class="error-state">Falha ao carregar tarefas: ${escapeHtml(e.message)}</div>`; }
  };
  window.addTaskPwa = async function addTaskCloud() { const title=document.getElementById('task-title-input')?.value.trim(); if(!title)return; await api('tasks',json('POST',{title,due_date:document.getElementById('task-date-input')?.value||null,done:false})); document.getElementById('task-title-input').value=''; await loadTasks(); await loadOverview(); };
  window.toggleTaskPwa = async function toggleTaskCloud(id) { const t=globalTasks.find((x)=>x.id===id); if(!t)return; await api(`tasks/${id}`,json('PATCH',{done:!t.done})); await loadTasks(); await loadOverview(); };
  window.deleteTaskPwa = async function deleteTaskCloud(id) { if(!confirm('Excluir esta tarefa?'))return; await api(`tasks/${id}`,{method:'DELETE'}); await loadTasks(); await loadOverview(); };

  window.loadContacts = async function loadContactsCloud() { const el=document.getElementById('pwa-contacts-list'); try{const d=await api('contacts'); globalContacts=(d.rows||[]).map((c)=>({...c,id:fullId(c.id)})); if(!globalContacts.length){el.innerHTML='<div class="empty-state">Nenhum contato registrado.</div>';return;} el.innerHTML=globalContacts.map((c)=>`<div class="item-card"><div class="item-info"><div class="item-title">👤 ${escapeHtml(c.name)}</div><div class="item-sub">${escapeHtml(c.phone||'Sem telefone')} ${c.email?'· '+escapeHtml(c.email):''}</div></div><button class="btn-delete" onclick="deleteContactPwa('${c.id}')">Excluir</button></div>`).join('');}catch(e){el.innerHTML=`<div class="error-state">Falha ao carregar contatos: ${escapeHtml(e.message)}</div>`;} };
  window.addContactPwa = async function addContactCloud() {const name=document.getElementById('contact-name-input')?.value.trim();if(!name)return;await api('contacts',json('POST',{name,phone:document.getElementById('contact-phone-input')?.value.trim()||'',email:'',notes:''}));document.getElementById('contact-name-input').value='';document.getElementById('contact-phone-input').value='';await loadContacts();};
  window.deleteContactPwa = async function deleteContactCloud(id){if(!confirm('Excluir contato?'))return;await api(`contacts/${id}`,{method:'DELETE'});await loadContacts();};

  window.loadSkills = async function loadSkillsCloud(){const el=document.getElementById('pwa-skills-container');const summary=document.getElementById('pwa-skills-summary');try{const d=await api('skills');const skills=d.skills||d.items||[];if(summary)summary.textContent=`${skills.filter((s)=>s.enabled).length} ativas · ${skills.length} disponíveis`;el.innerHTML=skills.map((s)=>`<div class="item-card"><div class="item-info"><div class="item-title">🧩 ${escapeHtml(s.label||s.name||s.key)}</div><div class="item-sub">${escapeHtml(s.description||'Habilidade do BROW')}</div></div><button class="btn-toggle" onclick="toggleSkillPwa('${escapeHtml(s.key||s.id)}',${!s.enabled})">${s.enabled?'Desativar':'Ativar'}</button></div>`).join('');}catch(e){el.innerHTML=`<div class="error-state">Falha ao carregar skills: ${escapeHtml(e.message)}</div>`;}};
  window.toggleSkillPwa=async function toggleSkillCloud(key,enabled){await api(`skills/${encodeURIComponent(key)}`,json('PATCH',{enabled,label:key}));await loadSkills();};
  window.submitNewSkillPwa=async function submitSkillCloud(){const name=document.getElementById('pwa-new-skill-name')?.value.trim(),description=document.getElementById('pwa-new-skill-desc')?.value.trim();if(!name||!description)return;await api('skills',json('POST',{name,description}));document.getElementById('pwa-new-skill-name').value='';document.getElementById('pwa-new-skill-desc').value='';await loadSkills();};

  window.loadAutomations=async function loadAutomationsCloud(){const d=await api('automations');globalAutomations=d.rows||[];globalScheduledBriefings=globalAutomations.filter((a)=>a.action_type==='briefing').map((a)=>({id:fullId(a.id),topic:a.action_config?.topic||a.name,time:a.trigger_config?.time||'08:00',freq:a.trigger_config?.frequency||'Diário',enabled:a.enabled}));renderScheduledBriefingsPwa();loadSystemStatusPwa();};
  window.addScheduledBriefingPwa=async function addBriefingCloud(event){event?.preventDefault();const topic=document.getElementById('briefing-topic-input')?.value.trim();if(!topic)return;const time=document.getElementById('briefing-time-input')?.value||'08:00';const frequency=document.getElementById('briefing-freq-input')?.value||'Diário';await api('automations',json('POST',{name:`Briefing: ${topic}`,trigger_type:'daily',trigger_config:{time,frequency},action_type:'briefing',action_config:{topic,channel:'telegram'},enabled:true}));document.getElementById('briefing-topic-input').value='';await loadAutomations();notify('Briefing salvo no servidor.');};
  window.deleteScheduledBriefingPwa=async function deleteBriefingCloud(index){const item=globalScheduledBriefings[index];if(!item||!confirm('Excluir este briefing programado?'))return;await api(`automations/${item.id}`,{method:'DELETE'});await loadAutomations();};

  window.renderScheduledBriefingsPwa=function renderBriefingsCloud(){const el=document.getElementById('scheduled-briefings-list'),badge=document.getElementById('scheduled-briefings-count');if(badge)badge.textContent=`${globalScheduledBriefings.length} ativos`;if(!el)return;el.innerHTML=globalScheduledBriefings.length?globalScheduledBriefings.map((b,i)=>`<div class="item-card"><div class="item-info"><div class="item-title">📡 ${escapeHtml(b.topic)}</div><div class="item-sub">${escapeHtml(b.time)} · ${escapeHtml(b.freq)} · servidor</div></div><button class="btn-delete" onclick="deleteScheduledBriefingPwa(${i})">Excluir</button></div>`).join(''):'<div class="empty-state">Nenhum briefing programado.</div>';};

  const legacyOpenEdit = window.openEditModalPwa;
  window.openEditModalPwa = function openCloudEdit(type, id, title, sub) {
    legacyOpenEdit(type, id, title, sub);
  };
  window.saveEditModalPwa = async function saveCloudEdit() {
    if (!editingItemTarget) return;
    const title = document.getElementById('edit-modal-title')?.value.trim();
    const sub = document.getElementById('edit-modal-sub')?.value.trim() || '';
    if (!title) return notify('Título não pode ser vazio.');
    const { type, id } = editingItemTarget;
    if (type === 'memory') await api(`memories/${id}`, json('PATCH', { title, summary: sub }));
    else if (type === 'agenda') await api(`agenda/${id}`, json('PATCH', { text: title }));
    else if (type === 'goal') await api(`goals/${id}`, json('PATCH', { title, current_value: Math.min(100, Math.max(0, Number(sub) || 0)) }));
    else if (type === 'task') await api(`tasks/${id}`, json('PATCH', { title }));
    else if (type === 'contact') await api(`contacts/${id}`, json('PATCH', { name: title, phone: sub }));
    closeEditModalPwa();
    if (type === 'memory') await loadMemories();
    if (type === 'agenda') await loadAgenda();
    if (type === 'goal') await loadGoals();
    if (type === 'task') await loadTasks();
    if (type === 'contact') await loadContacts();
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadChatMessagesFromStoragePwa();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadChatMessagesFromStoragePwa(); });
  });
})();
