console.log("🚀 [APP INICIANDO] Script cargado.");

// ==== PWA: REGISTRO DE SERVICE WORKER E INSTALACIÓN ====
let deferredPrompt;
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            console.log('✅ [PWA] Service Worker registrado exitosamente.', reg.scope);
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

// ==== VARIABLES GLOBALES ====
let shiftsData = JSON.parse(localStorage.getItem('shiftsData') || 'null');
let availableRoles = new Set();
let selectedRoles = new Set();

window.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem('saved_sheet_url');
    if (savedUrl) document.getElementById('sheet-url').value = savedUrl;
    document.getElementById('file-upload').addEventListener('change', handleFileUpload);
    init();
});

// ==== LÓGICA DE DESCARGA ====
function downloadAndLoad() {
    const urlInput = document.getElementById('sheet-url').value.trim();
    if (!urlInput) return alert("Pega el enlace de tu archivo de Google Sheets.");
    
    const match = urlInput.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match || !match[1]) return alert("Enlace no válido.");
    
    localStorage.setItem('saved_sheet_url', urlInput);
    const exportUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
    
    window.open(exportUrl, '_blank');
    document.getElementById('step2-modal').classList.remove('hidden');
}

function closeStep2Modal() {
    document.getElementById('step2-modal').classList.add('hidden');
}

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
function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function processExcelData(dataBuffer) {
    try {
        const workbook = XLSX.read(dataBuffer, {type: 'array', cellDates: true});
        let parsedShifts = {};
        let turnosGuardados = 0;
        
        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const sheetData = XLSX.utils.sheet_to_json(worksheet, {header: 1, defval: null});
            if (sheetData.length < 3) return; 
            
            let datesRowIndex = -1;
            for (let i = 0; i < Math.min(10, sheetData.length); i++) {
                if (sheetData[i] && parseExcelDate(sheetData[i][2])) { datesRowIndex = i; break; }
            }
            if (datesRowIndex === -1) return; 
            
            const datesRow = sheetData[datesRowIndex];
            let lastPuesto = 'No definido';
            
            for (let r = datesRowIndex + 1; r < sheetData.length; r++) {
                const row = sheetData[r];
                if (!row || row.length < 2) continue; 
                
                if (row[0] !== null && String(row[0]).trim() !== "") { lastPuesto = String(row[0]).trim(); }
                const puesto = lastPuesto;
                const nombre = row[1] !== null ? String(row[1]).trim() : '';
                if (!nombre) continue; 
                
                for (let c = 2; c < datesRow.length; c++) {
                    let formattedDate = parseExcelDate(datesRow[c]);
                    if (formattedDate) {
                        const turno = row[c] !== null ? String(row[c]).trim() : 'Libre';
                        const turnoLower = turno.toLowerCase();
                        const descansa = turnoLower === 'libre' || turnoLower.includes('vacaciones') || turnoLower.includes('incapacidad') || turnoLower.includes('descanso');
                        
                        if (!descansa) {
                            if (!parsedShifts[formattedDate]) parsedShifts[formattedDate] = [];
                            parsedShifts[formattedDate].push({ puesto, nombre, turno });
                            turnosGuardados++;
                        }
                    }
                }
            }
        });
        
        if(turnosGuardados === 0) { alert("Se leyó el archivo pero no hay turnos."); return; }
        
        shiftsData = parsedShifts;
        localStorage.setItem('shiftsData', JSON.stringify(shiftsData));
        selectedRoles.clear();
        init();
    } catch (err) {
        console.error(err);
        alert('Error técnico leyendo el Excel.');
    }
}

// ==== UTILIDADES DE TIEMPO ====
function formatLocalDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function parseExcelDate(dateKey) {
    if (!dateKey) return null;
    if (dateKey instanceof Date) return `${dateKey.getUTCFullYear()}-${String(dateKey.getUTCMonth() + 1).padStart(2, '0')}-${String(dateKey.getUTCDate()).padStart(2, '0')}`;
    if (typeof dateKey === 'number') {
        const parsed = new Date(Math.round((dateKey - 25569) * 86400 * 1000));
        return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }
    if (typeof dateKey === 'string') {
        const match = dateKey.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
        if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    }
    return null;
}
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
    } else {
        document.getElementById('empty-state').classList.remove('hidden');
        document.getElementById('data-state').classList.add('hidden');
    }
}

function extractRoles() {
    availableRoles.clear();
    if(!shiftsData) return;
    for(let date in shiftsData) { shiftsData[date].forEach(item => { if(item.puesto) availableRoles.add(item.puesto); }); }
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
        shiftsData = null; selectedRoles.clear(); availableRoles.clear();
        document.getElementById('date-picker').value = ''; init();
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
