console.log("🚀 [APP INICIANDO] Script cargado.");

// ==== VARIABLES GLOBALES ====
let shiftsData = JSON.parse(localStorage.getItem('shiftsData') || 'null');
let availableRoles = new Set();
let selectedRoles = new Set();
let allWorkerNames = new Set(); 

// Alertas / Notificaciones
let notifPrefs = JSON.parse(localStorage.getItem('notifPrefs') || 'null');
let checkerInterval = null;
let previewInterval = null; 
let lastNotifiedShiftKey = localStorage.getItem('lastNotifiedShiftKey') || '';

// Motor de Audio Sintetizado
let audioCtx = null;
let alarmInterval = null;

window.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem('saved_sheet_url');
    if (savedUrl) document.getElementById('sheet-url').value = savedUrl;
    document.getElementById('file-upload').addEventListener('change', handleFileUpload);
    
    setupAutocomplete();
    init();
});

// ==== PWA: REGISTRO DE SERVICE WORKER ====
let deferredPrompt;
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('✅ [PWA] Service Worker registrado exitosamente.');
        }).catch(err => console.log('❌ [PWA] Falló el Service Worker:', err));
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btnInstall = document.getElementById('btn-install');
    btnInstall.classList.remove('hidden');
    btnInstall.classList.add('flex');

    btnInstall.addEventListener('click', () => {
        btnInstall.classList.add('hidden');
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') console.log('App instalada');
            deferredPrompt = null;
        });
    });
});

// ==== MOTOR DE AUDIO (ALARMA) ====
function unlockAudio() {
    try {
        if (!audioCtx) {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.001);
    } catch(e) {
        console.error("Audio API no soportada", e);
    }
}

function playBeep() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime); 
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1); 
    
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime); 
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25); 
}

function startAlarmSound() {
    playBeep();
    alarmInterval = setInterval(playBeep, 600); 
}

function stopAlarm() {
    if (alarmInterval) clearInterval(alarmInterval);
    document.getElementById('alarm-modal').classList.add('hidden');
}

// ==== LÓGICA DE ALERTAS Y TEMPORIZADOR PERSONALIZADO ====
function openNotifModal() {
    document.getElementById('notif-modal').classList.remove('hidden');
    if(notifPrefs) {
        document.getElementById('notif-name-input').value = notifPrefs.name;
        document.getElementById('notif-time-value').value = notifPrefs.rawValue;
        document.getElementById('notif-time-unit').value = notifPrefs.unit;
        updateNextShiftPreview(notifPrefs.name);
    }
}

function closeNotifModal() {
    if(previewInterval) clearInterval(previewInterval);
    document.getElementById('notif-modal').classList.add('hidden');
}

function disableNotifications() {
    localStorage.removeItem('notifPrefs');
    notifPrefs = null;
    document.getElementById('notif-badge').classList.add('hidden');
    document.getElementById('next-shift-preview').classList.add('hidden');
    if(checkerInterval) clearInterval(checkerInterval);
    if(previewInterval) clearInterval(previewInterval);
    closeNotifModal();
    alert("Alarma desactivada.");
}

// Calcula los minutos reales de antelación según los campos del Modal
function getOffsetInMinutes() {
    const val = parseFloat(document.getElementById('notif-time-value').value) || 0;
    const unit = document.getElementById('notif-time-unit').value;
    return unit === 'hours' ? Math.round(val * 60) : Math.round(val);
}

async function saveNotificationPrefs() {
    const name = document.getElementById('notif-name-input').value.trim();
    const rawValue = parseFloat(document.getElementById('notif-time-value').value) || 0;
    const unit = document.getElementById('notif-time-unit').value;
    
    if(!name) return alert("Por favor, ingresa tu nombre.");
    if(rawValue < 0) return alert("Por favor, ingresa un valor de tiempo válido (mayor o igual a 0).");
    
    unlockAudio();
    
    let perm = Notification.permission;
    if (perm !== 'granted') perm = await Notification.requestPermission();
    
    const offset = getOffsetInMinutes();
    
    // Guardamos la configuración detallada para recordarla al abrir el modal
    notifPrefs = { name, rawValue, unit, offset };
    localStorage.setItem('notifPrefs', JSON.stringify(notifPrefs));
    document.getElementById('notif-badge').classList.remove('hidden');
    
    closeNotifModal();
    startNotificationChecker();
    
    if (perm === 'granted') {
        const textUnit = unit === 'hours' ? 'hora(s)' : 'minuto(s)';
        new Notification("Alarma Guardada", { body: `Te despertaremos ${rawValue} ${textUnit} antes de tu turno.`, icon: './icon.svg' });
    }
}

function setupAutocomplete() {
    const input = document.getElementById('notif-name-input');
    const list = document.getElementById('autocomplete-list');
    
    input.addEventListener('input', function() {
        const val = this.value.toLowerCase();
        list.innerHTML = '';
        if(!val) { list.classList.add('hidden'); return; }
        
        let matches = Array.from(allWorkerNames).filter(n => n.toLowerCase().includes(val)).slice(0, 5);
        if(matches.length > 0) {
            list.classList.remove('hidden');
            matches.forEach(match => {
                const li = document.createElement('li');
                li.className = 'px-4 py-2 text-sm text-slate-200 hover:bg-indigo-600 cursor-pointer border-b border-slate-700/50 last:border-0';
                li.innerText = match;
                li.onclick = () => {
                    input.value = match;
                    list.classList.add('hidden');
                    updateNextShiftPreview(match);
                };
                list.appendChild(li);
            });
        } else {
            list.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target !== input && e.target !== list) list.classList.add('hidden');
    });
}

function getUpcomingShift(workerName) {
    if(!shiftsData) return null;
    const now = new Date();
    const sortedDates = Object.keys(shiftsData).sort();
    
    for (let dateStr of sortedDates) {
        if (new Date(dateStr + 'T23:59:59') < now) continue;
        const shift = shiftsData[dateStr].find(s => s.nombre.toLowerCase() === workerName.toLowerCase());
        
        if (shift) {
            const timeMatch = shift.turno.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                const startHour = parseInt(timeMatch[1]);
                const startMin = parseInt(timeMatch[2]);
                const shiftDate = new Date(dateStr + 'T00:00:00');
                shiftDate.setHours(startHour, startMin, 0, 0);
                
                if (shiftDate > now) return { date: dateStr, shiftTime: shift.turno, startTimeObj: shiftDate };
            }
        }
    }
    return null;
}

function refreshPreviewTimer() {
    const name = document.getElementById('notif-name-input').value.trim();
    if(name) updateNextShiftPreview(name);
}

function updateNextShiftPreview(name) {
    const preview = document.getElementById('next-shift-preview');
    if (previewInterval) clearInterval(previewInterval);
    
    const upcoming = getUpcomingShift(name);
    
    if (upcoming) {
        preview.classList.remove('hidden');
        
        const updateTimerDisplay = () => {
            const offset = getOffsetInMinutes();
            const alarmTimeMs = upcoming.startTimeObj.getTime() - (offset * 60000);
            const nowMs = Date.now();
            const diffMs = alarmTimeMs - nowMs;
            
            let timeText = "";
            
            if (diffMs <= 0) {
                timeText = `<span class="text-red-400 animate-pulse font-bold">¡La alarma está programada para ahora o ya pasó!</span>`;
            } else {
                const totalSecs = Math.floor(diffMs / 1000);
                const d = Math.floor(totalSecs / 86400);
                const h = Math.floor((totalSecs % 86400) / 3600);
                const m = Math.floor((totalSecs % 3600) / 60);
                const s = totalSecs % 60;
                
                const dStr = d > 0 ? `${d}d ` : '';
                const hStr = h > 0 ? `${h}h ` : (d > 0 ? '0h ' : '');
                const mStr = `${m}m `;
                const sStr = `${s}s`;
                
                timeText = `Faltan <span class="font-bold text-amber-400">${dStr}${hStr}${mStr}${sStr}</span> para que suene`;
            }

            preview.innerHTML = `
                <div class="text-center space-y-2">
                    <span class="block text-slate-300">Próximo turno: <strong class="text-white">${upcoming.date} (${upcoming.shiftTime})</strong></span>
                    <div class="text-lg text-amber-200 font-mono bg-slate-900/50 py-2 rounded-lg border border-amber-500/20 shadow-inner">
                        ${timeText}
                    </div>
                </div>
            `;
        };
        
        updateTimerDisplay(); 
        previewInterval = setInterval(updateTimerDisplay, 1000); 
        
    } else {
        preview.innerHTML = `<div class="text-center text-slate-400 py-2">No se encontraron turnos futuros para este nombre.</div>`;
        preview.classList.remove('hidden');
    }
}

function startNotificationChecker() {
    if(checkerInterval) clearInterval(checkerInterval);
    if(!notifPrefs) return;
    
    document.getElementById('notif-badge').classList.remove('hidden');
    
    checkerInterval = setInterval(() => {
        const upcoming = getUpcomingShift(notifPrefs.name);
        if(!upcoming) return;

        const now = new Date();
        const diffMs = upcoming.startTimeObj.getTime() - now.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        
        const currentShiftKey = upcoming.date + "_" + upcoming.shiftTime;

        // Buscamos si la hora actual coincide con los minutos configurados de antelación
        if (diffMins > 0 && diffMins <= notifPrefs.offset && lastNotifiedShiftKey !== currentShiftKey) {
            triggerFullAlarm(upcoming.shiftTime, diffMins);
            lastNotifiedShiftKey = currentShiftKey;
            localStorage.setItem('lastNotifiedShiftKey', currentShiftKey);
        }
    }, 60000);
}

function triggerFullAlarm(turnoStr, minsLeft) {
    const bodyText = `Tu turno de ${turnoStr} comienza en ${minsLeft} minutos.`;
    
    if (Notification.permission === 'granted') {
        new Notification("¡ALARMA DE TURNO!", { body: bodyText, icon: './icon.svg', vibrate: [500, 200, 500] });
    }
    document.getElementById('alarm-message').innerText = bodyText;
    document.getElementById('alarm-modal').classList.remove('hidden');
    startAlarmSound();
}

// ==== LÓGICA DE DESCARGA ====
function downloadAndLoad() {
    const urlInput = document.getElementById('sheet-url').value.trim();
    if (!urlInput) return alert("Pega el enlace de tu Google Sheets.");
    const match = urlInput.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match || !match[1]) return alert("Enlace no válido.");
    
    localStorage.setItem('saved_sheet_url', urlInput);
    window.open(`https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`, '_blank');
    document.getElementById('step2-modal').classList.remove('hidden');
}

function closeStep2Modal() { document.getElementById('step2-modal').classList.add('hidden'); }

// ==== LÓGICA DE ARCHIVO Y PARSEO ====
function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    closeStep2Modal(); 
    showLoading("Procesando...");
    const reader = new FileReader();
    reader.onload = function(evt) {
        processExcelData(new Uint8Array(evt.target.result));
        document.getElementById('file-upload').value = '';
        hideLoading();
    };
    reader.readAsArrayBuffer(file);
}

function showLoading(text) {
    document.getElementById('loading-text').innerText = text;
    document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

function parseExcelDate(dateKey) {
    if (!dateKey) return null;
    if (dateKey instanceof Date) {
        if (isNaN(dateKey.getTime())) return null;
        return `${dateKey.getUTCFullYear()}-${String(dateKey.getUTCMonth() + 1).padStart(2, '0')}-${String(dateKey.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof dateKey === 'number') {
        const parsed = new Date(Math.round((dateKey - 25569) * 86400 * 1000));
        if (isNaN(parsed.getTime())) return null;
        return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof dateKey === 'string') {
        const str = dateKey.trim();
        let match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); 
        if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        match = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); 
        if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        const parsedNative = new Date(str);
        if (!isNaN(parsedNative.getTime())) {
            return `${parsedNative.getUTCFullYear()}-${String(parsedNative.getUTCMonth() + 1).padStart(2, '0')}-${String(parsedNative.getUTCDate()).padStart(2, '0')}`;
        }
    }
    return null;
}

function processExcelData(dataBuffer) {
    try {
        const workbook = XLSX.read(dataBuffer, {type: 'array', cellDates: true});
        let parsedShifts = {};
        let turnosGuardados = 0;
        allWorkerNames.clear(); 
        
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: null});
            if (sheetData.length < 3) return; 
            
            let datesRowIndex = -1;
            for (let i = 0; i < Math.min(15, sheetData.length); i++) {
                let validDatesInRow = 0;
                if (sheetData[i]) {
                    for (let c = 0; c < sheetData[i].length; c++) {
                        if (parseExcelDate(sheetData[i][c])) validDatesInRow++;
                    }
                }
                if (validDatesInRow >= 2) { datesRowIndex = i; break; }
            }
            if (datesRowIndex === -1) return; 
            
            const datesRow = sheetData[datesRowIndex];
            let firstDateCol = -1;
            for (let c = 0; c < datesRow.length; c++) {
                if (parseExcelDate(datesRow[c])) { firstDateCol = c; break; }
            }
            
            const nombreIndex = firstDateCol > 0 ? firstDateCol - 1 : 1;
            const puestoIndex = firstDateCol > 1 ? firstDateCol - 2 : 0;
            let lastPuesto = 'No definido';
            
            for (let r = datesRowIndex + 1; r < sheetData.length; r++) {
                const row = sheetData[r];
                if (!row || row.length < nombreIndex + 1) continue; 
                if (row[puestoIndex] !== null && String(row[puestoIndex]).trim() !== "") { lastPuesto = String(row[puestoIndex]).trim(); }
                const puesto = lastPuesto;
                const nombre = row[nombreIndex] !== null && row[nombreIndex] !== undefined ? String(row[nombreIndex]).trim() : '';
                
                if (!nombre || nombre === "") continue; 
                allWorkerNames.add(nombre);
                
                for (let c = firstDateCol; c < datesRow.length; c++) {
                    let formattedDate = parseExcelDate(datesRow[c]);
                    if (formattedDate) {
                        const turno = row[c] !== null && row[c] !== undefined ? String(row[c]).trim() : 'Libre';
                        const turnoLower = turno.toLowerCase();
                        const descansa = turnoLower === 'libre' || turnoLower.includes('vacaciones') || turnoLower.includes('incapaci') || turnoLower.includes('descanso');
                        
                        if (!descansa) {
                            if (!parsedShifts[formattedDate]) parsedShifts[formattedDate] = [];
                            parsedShifts[formattedDate].push({ puesto, nombre, turno });
                            turnosGuardados++;
                        }
                    }
                }
            }
        });
        
        if(turnosGuardados === 0) return alert("El archivo se leyó pero no se encontraron turnos válidos."); 
        
        shiftsData = parsedShifts;
        localStorage.setItem('shiftsData', JSON.stringify(shiftsData));
        selectedRoles.clear();
        init();
        
    } catch (err) {
        console.error(err);
        alert('Error técnico leyendo el Excel. Revisa el log de la consola.');
    }
}

// ==== UTILIDADES DE TIEMPO ====
function formatLocalDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function getAdjustedToday() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    return now;
}
function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T12:00:00'); 
    d.setDate(d.getDate() + days);
    return formatLocalDate(d);
}

// ==== INTERFAZ (UI) ====
function init() {
    const formattedToday = formatLocalDate(getAdjustedToday());
    if(!document.getElementById('date-picker').value) document.getElementById('date-picker').value = formattedToday;
    document.getElementById('ref-time-label').innerText = `${formattedToday} (Corte 6:00 AM)`;

    if (shiftsData && Object.keys(shiftsData).length > 0) {
        document.getElementById('empty-state').classList.add('hidden');
        document.getElementById('data-state').classList.remove('hidden');
        extractRoles();
        renderRoleFilters();
        renderShifts(document.getElementById('date-picker').value);
        if(notifPrefs) startNotificationChecker();
    } else {
        document.getElementById('empty-state').classList.remove('hidden');
        document.getElementById('data-state').classList.add('hidden');
    }
}

function extractRoles() {
    availableRoles.clear(); allWorkerNames.clear();
    if(!shiftsData) return;
    for(let date in shiftsData) { 
        shiftsData[date].forEach(item => { 
            if(item.puesto) availableRoles.add(item.puesto); 
            if(item.nombre) allWorkerNames.add(item.nombre);
        }); 
    }
}

function renderRoleFilters() {
    const container = document.getElementById('role-filters');
    container.innerHTML = '';
    Array.from(availableRoles).sort().forEach(role => {
        const btn = document.createElement('button');
        btn.className = `px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${selectedRoles.has(role) ? 'bg-indigo-600 border-indigo-500 text-white shadow-md' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`;
        btn.innerText = role;
        btn.onclick = () => { selectedRoles.has(role) ? selectedRoles.delete(role) : selectedRoles.add(role); renderRoleFilters(); renderShifts(document.getElementById('date-picker').value); };
        container.appendChild(btn);
    });
    if(selectedRoles.size > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all flex items-center gap-1 ml-2';
        clearBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>Limpiar Filtros`;
        clearBtn.onclick = () => { selectedRoles.clear(); renderRoleFilters(); renderShifts(document.getElementById('date-picker').value); };
        container.appendChild(clearBtn);
    }
}

function handleDateChange(e) { if(shiftsData) renderShifts(e.target.value); }

function clearData() {
    if(confirm('¿Seguro que deseas borrar los turnos almacenados?')) {
        localStorage.removeItem('shiftsData');
        shiftsData = null; selectedRoles.clear(); availableRoles.clear(); allWorkerNames.clear();
        document.getElementById('date-picker').value = ''; init(); disableNotifications();
    }
}

function renderShifts(refDateStr) {
    const ayerStr = addDays(refDateStr, -1);
    const mananaStr = addDays(refDateStr, 1);
    document.getElementById('label-ayer').innerText = ayerStr;
    document.getElementById('label-hoy').innerText = refDateStr;
    document.getElementById('label-manana').innerText = mananaStr;
    
    const filterFn = (arr) => {
        if(!arr) return [];
        return selectedRoles.size === 0 ? arr : arr.filter(i => selectedRoles.has(i.puesto));
    };
    renderList('list-ayer', filterFn(shiftsData[ayerStr]));
    renderList('list-hoy', filterFn(shiftsData[refDateStr]));
    renderList('list-manana', filterFn(shiftsData[mananaStr]));
}

function renderList(elementId, data) {
    const container = document.getElementById(elementId);
    container.innerHTML = '';
    if (!data || data.length === 0) {
        container.innerHTML = `<div class="h-full flex flex-col items-center justify-center text-slate-500/70 p-4 text-center mt-10"><svg class="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg><p class="text-sm">Sin turnos</p></div>`;
        return;
    }
    const grouped = {};
    data.forEach(item => { if(!grouped[item.turno]) grouped[item.turno] = []; grouped[item.turno].push(item); });
    
    Object.keys(grouped).sort().forEach(turno => {
        const block = document.createElement('div');
        block.className = 'bg-slate-900/30 rounded-xl p-3 border border-slate-700/50 relative overflow-hidden';
        const cardsHTML = grouped[turno].map(p => `<div class="bg-slate-800/80 p-2.5 rounded-lg border border-slate-700 hover:border-indigo-500/50 transition-all flex flex-col"><span class="text-sm font-semibold text-slate-200 truncate" title="${p.nombre}">${p.nombre}</span><span class="text-xs text-indigo-300/80 font-medium truncate mt-0.5" title="${p.puesto}">${p.puesto}</span></div>`).join('');
        block.innerHTML = `<div class="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50"></div><div class="text-xs font-bold text-indigo-400 mb-3 pl-2 flex items-center bg-slate-900/50 py-1.5 rounded uppercase tracking-wider"><svg class="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>${turno}</div><div class="grid grid-cols-1 gap-2 pl-2">${cardsHTML}</div>`;
        container.appendChild(block);
    });
}
