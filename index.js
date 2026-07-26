js_code = """/* ============================================================
   index.js — Motor de Evaluación Automatizada (Memoria Optimizada)
   Procesamiento estricto en "Fila India", recolección de basura (RAM)
   y micro-barras de carga para evitar bloqueos silenciosos.
   ============================================================ */

// ─── Verificación de Dependencias CDN ───
const REQUIRED_LIBS = {
    pdfjsLib:  'PDF.js',
    jspdf:    'jsPDF',
    mammoth:  'Mammoth.js',
    JSZip:    'JSZip'
};

function checkDependencies() {
    const missing = [];
    for (const [globalName, label] of Object.entries(REQUIRED_LIBS)) {
        if (typeof window[globalName] === 'undefined') {
            missing.push(label);
        }
    }
    const alertEl = document.getElementById('cdn-alert');
    const alertText = document.getElementById('cdn-alert-text');
    if (!alertEl || !alertText) return false;
    if (missing.length > 0) {
        alertEl.classList.remove('hidden');
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ');
        return false;
    }
    alertEl.classList.add('hidden');
    return true;
}

function configurePDFJS() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ─── Micro-pausa para forzar el redibujado de la UI y liberar la RAM ───
// Usamos 15ms para asegurar que el motor gráfico del navegador renderice la barra
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

// ─── Diccionarios de Evaluación ───
const DIC_LEY = [{ word: 'ley', weight: 1.2 }, { word: 'norma', weight: 1.0 }, { word: 'decreto', weight: 1.1 }, { word: 'derecho', weight: 0.8 }, { word: 'mtpe', weight: 1.3 }, { word: 'artículo', weight: 1.0 }, { word: 'reglamento', weight: 1.0 }, { word: '29381', weight: 1.5 }, { word: '27942', weight: 1.5 }, { word: '28518', weight: 1.5 }, { word: 'beneficio', weight: 0.7 }, { word: 'acoso', weight: 1.0 }, { word: 'flexibilidad', weight: 0.7 }];
const DIC_EVIDENCIA = [{ word: 'sunafil', weight: 1.5 }, { word: 'resolución', weight: 1.2 }, { word: 'noticia', weight: 0.9 }, { word: 'empresa', weight: 0.7 }, { word: 'reportaje', weight: 1.0 }, { word: 'fuente', weight: 1.0 }, { word: 'http', weight: 1.3 }, { word: 'https', weight: 1.3 }, { word: 'caso real', weight: 1.4 }, { word: 'evidencia', weight: 1.1 }, { word: 'multa', weight: 1.0 }, { word: 'denuncia', weight: 1.0 }];
const DIC_RRHH = [{ word: 'recursos humanos', weight: 1.3 }, { word: 'rr.hh', weight: 1.3 }, { word: 'rrhh', weight: 1.3 }, { word: 'ética', weight: 1.2 }, { word: 'código de ética', weight: 1.4 }, { word: 'postura', weight: 0.8 }, { word: 'protocolo', weight: 1.0 }, { word: 'capacitación', weight: 1.1 }, { word: 'prevención', weight: 1.0 }, { word: 'estrategia', weight: 0.9 }, { word: 'compromiso', weight: 0.8 }];
const CONECTORES = ['en primer lugar', 'a continuación', 'primero', 'para terminar', 'finalmente', 'por otra parte', 'en cuanto a', 'acerca de', 'con relación a', 'por tanto', 'por consiguiente', 'como resultado', 'por lo cual', 'de ahí que', 'sin embargo', 'no obstante', 'en cambio', 'por el contrario', 'en mi opinión', 'desde mi perspectiva', 'considero', 'es decir', 'en efecto', 'dicho de otra manera', 'en conclusión', 'en resumen'];

// ─── Estado Global ───
let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let sortColumn = null;
let sortDirection = 'asc';
let isProcessing = false;

// ─── Referencias al DOM ───
const DOM = {};
function cacheDOM() {
    const ids = ['drop-zone', 'file-input', 'folder-input', 'btn-folder', 'folder-fallback-msg', 'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip', 'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count', 'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 'btn-cancel', 'cdn-alert', 'cdn-alert-text'];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function formatFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
function getFileTypeIcon(type) { if (type === 'pdf') return '📄'; if (type === 'docx') return '📝'; if (type === 'zip') return '📦'; return '📎'; }
function detectFileType(file) { const name = file.name.toLowerCase(); if (name.endsWith('.pdf')) return 'pdf'; if (name.endsWith('.docx')) return 'docx'; if (name.endsWith('.zip')) return 'zip'; return 'other'; }

function updateFileListUI() {
    const listEl = DOM['file-list-items'];
    const fileList = DOM['file-list'];
    listEl.innerHTML = '';
    if (archivosDetectados.length === 0) {
        fileList.classList.add('hidden');
        DOM['status-text'].innerHTML = 'Esperando archivos...';
        return;
    }
    fileList.classList.remove('hidden');
    DOM['file-count'].textContent = archivosDetectados.length;
    DOM['status-text'].innerHTML = `${archivosDetectados.length} archivo(s) listos para evaluar.`;
    
    let cPDF = 0, cDOCX = 0, cZIP = 0;
    archivosDetectados.forEach(f => { if(f.type === 'pdf') cPDF++; else if(f.type === 'docx') cDOCX++; else if(f.type === 'zip') cZIP++; });
    const ts = (el, c) => { if (c > 0) { el.classList.remove('hidden'); el.textContent = el.textContent.replace(/\\d+/, c); } else el.classList.add('hidden'); };
    ts(DOM['stat-pdf'], cPDF); ts(DOM['stat-docx'], cDOCX); ts(DOM['stat-zip'], cZIP);

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li'); chip.className = 'file-chip';
        chip.innerHTML = `<span class="chip-icon">${getFileTypeIcon(f.type)}</span> <span title="${escapeHTML(f.name)}">${escapeHTML(f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name)}</span> <button class="chip-remove" data-index="${i}">&times;</button>`;
        listEl.appendChild(chip);
    });
    listEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); if (isProcessing) return;
            archivosDetectados.splice(parseInt(btn.dataset.index), 1);
            updateFileListUI();
        });
    });
}

async function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({ name: files[i].name, type, file: files[i], size: files[i].size });
            added++;
        }
    }
    if (added > 0) updateFileListUI();
}

// ─── EXTRACCIÓN OPTIMIZADA CON LIMPIEZA DE RAM Y MICRO-BARRAS ───
async function extractTextFromPDF(file) {
    let arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + ' ';
        
        // FORZAR LIMPIEZA DE MEMORIA DE LA PÁGINA
        page.cleanup(); 
        
        // DIBUJAR MICRO-BARRA DE CARGA
        DOM['status-text'].innerHTML = `
            <div style="display:flex; flex-direction:column; gap:4px; margin-top:5px; font-size:0.9em;">
                <span>Leyendo: <strong>${file.name.substring(0,25)}...</strong></span>
                <span>Página ${i} de ${pdf.numPages}</span>
                <progress value="${i}" max="${pdf.numPages}" style="width:100%; height:6px; border-radius:3px;"></progress>
            </div>
        `;
        await yieldUI(); // Respira el navegador
    }
    
    // DESTRUIR EL PDF EN RAM
    await loadingTask.destroy();
    arrayBuffer = null; 
    return fullText.toLowerCase();
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    DOM['status-text'].innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px; margin-top:5px; font-size:0.9em;">
            <span>Leyendo: <strong>${file.name.substring(0,25)}...</strong></span>
            <span>Extrayendo DOCX...</span>
            <progress style="width:100%; height:6px; border-radius:3px;"></progress>
        </div>
    `;
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer });
    let text = result.value.toLowerCase();
    
    // LIMPIEZA DE RAM
    arrayBuffer = null; 
    result = null; 
    return text;
}

async function extractFilesFromZip(zipFile) {
    let extracted = [];
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);

    for (let i = 0; i < entries.length; i++) {
        const zipEntry = entries[i];
        const lower = zipEntry.name.toLowerCase();
        if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
            let blob = await zipEntry.async('blob');
            let file = new File([blob], zipEntry.name.split('/').pop(), { type: lower.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            extracted.push({ name: file.name, type: lower.endsWith('.pdf') ? 'pdf' : 'docx', file, size: blob.size });
            blob = null; // Limpiar blob
        }
        if (i % 3 === 0) await yieldUI();
    }
    return extracted;
}

function computeWeightedScore(dict, text) {
    let score = 0;
    for (const entry of dict) {
        const regex = new RegExp(`\\\\b${entry.word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\\\b`, 'gi');
        score += ((text.match(regex) || []).length) * entry.weight;
    }
    return score;
}

function evaluateContent(fileName, text) {
    let c1 = 1, c2 = 1, c3 = 1, conectores = 0;
    const obs = [];
    CONECTORES.forEach(c => { if (text.includes(c)) conectores++; });
    
    let sLey = computeWeightedScore(DIC_LEY, text);
    if (sLey >= 8) c1 = 5; else if (sLey >= 4) { c1 = 3; obs.push('Falta profundizar marco legal.'); } else { c1 = Math.max(1, Math.round(sLey/2)); obs.push('Omitió normas legales.'); }

    let sEvid = computeWeightedScore(DIC_EVIDENCIA, text);
    if (sEvid >= 6 && (text.includes('sunafil') || text.includes('http'))) c2 = 7; else if (sEvid >= 3) { c2 = 4; obs.push('Falta precisar fuentes.'); } else { c2 = Math.max(1, Math.round(sEvid/2)); obs.push('Faltan casos reales.'); }

    let sRRHH = computeWeightedScore(DIC_RRHH, text);
    if (sRRHH >= 6) c3 = 8; else if (sRRHH >= 3) { c3 = 4; obs.push('Propuesta RRHH genérica.'); } else { c3 = Math.max(1, Math.round(sRRHH/2)); obs.push('No fundamenta RRHH.'); }
    if (conectores < 3) obs.push('Faltan conectores lógicos.');

    return { estudiante: fileName.replace(/\\.(pdf|docx)$/i, ''), c1, c2, c3, notaFinal: c1 + c2 + c3, conectoresHallados: conectores, observacion: obs.join(' ') || '¡Excelente!' };
}

function addError(archivo, mensaje) {
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li'); li.textContent = `[${archivo}] ${mensaje}`;
    DOM['error-list'].appendChild(li);
}

// ─── PROCESAMIENTO ESTRICTO EN FILA INDIA (SECUENCIAL) ───
async function processAllFiles() {
    if (isProcessing) return;
    if (archivosDetectados.length === 0) return;

    isProcessing = true;
    abortController = new AbortController();
    const signal = abortController.signal;
    
    resultadosEvaluacion = [];
    DOM['table-body'].innerHTML = '';
    DOM['error-list'].innerHTML = '';
    DOM['error-panel'].classList.add('hidden');
    DOM['progress-bar'].classList.remove('hidden');
    DOM['progress-bar'].value = 0;
    
    DOM['loading-overlay'].classList.remove('hidden');
    DOM['btn-cancel'].classList.remove('hidden');

    try {
        // Hacemos una copia para procesarla como una cola (Queue)
        let cola = [...archivosDetectados];
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;
            
            // Sacamos 1 archivo de la cola (Fila India)
            let item = cola.shift();

            if (item.type === 'zip') {
                DOM['loading-detail'].textContent = `Extrayendo ZIP: ${item.name}...`;
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    cola.unshift(...extracted); // Añadimos al inicio de la cola
                    total += extracted.length - 1; // Ajustamos el total
                } catch(e) { addError(item.name, 'Error ZIP: ' + e.message); }
                item.file = null; item = null; // Liberar RAM
                continue;
            }

            procesados++;
            DOM['loading-detail'].textContent = `Procesando archivo ${procesados} de ${total}`;
            DOM['overlay-progress'].value = Math.round((procesados / total) * 100);
            DOM['overlay-percent'].textContent = `${Math.round((procesados / total) * 100)}%`;
            DOM['progress-bar'].value = Math.round((procesados / total) * 100);

            try {
                let text = '';
                if (item.type === 'pdf') { text = await extractTextFromPDF(item.file); } 
                else if (item.type === 'docx') { text = await extractTextFromDOCX(item.file); }

                if (!text || text.trim().length < 50) { addError(item.name, 'Documento vacío o ilegible.'); } 
                else { resultadosEvaluacion.push(evaluateContent(item.name, text)); }
                
                // DESTRUCCIÓN ESTRICTA DE LA VARIABLE DE TEXTO (Evita el colapso de RAM)
                text = null; 
            } catch (err) { addError(item.name, 'Error: ' + err.message); }
            
            item.file = null; item = null; // Liberar RAM
            await yieldUI();
        }
    } finally {
        isProcessing = false;
        DOM['loading-overlay'].classList.add('hidden');
        DOM['progress-bar'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            DOM['status-text'].textContent = `¡Completado! Evaluados ${resultadosEvaluacion.length} de ${archivosDetectados.length} archivos.`;
            DOM['btn-export-pdf'].disabled = false; DOM['btn-export-csv'].disabled = false; DOM['btn-clear'].disabled = false;
            renderTable();
        } else { DOM['status-text'].textContent = 'Ocurrió un error general o no hubo archivos válidos.'; }
    }
}

// ─── Render y UI (Minificado por espacio) ───
function renderTable(fText = '') {
    const tbody = DOM['table-body']; tbody.innerHTML = '';
    let sorted = [...resultadosEvaluacion];
    if (sortColumn) sorted.sort((a,b) => { let vA = a[sortColumn], vB = b[sortColumn]; if(typeof vA==='string') vA=vA.toLowerCase(); if(typeof vB==='string') vB=vB.toLowerCase(); if(vA<vB) return sortDirection==='asc'?-1:1; if(vA>vB) return sortDirection==='asc'?1:-1; return 0;});
    let fil = fText ? sorted.filter(r => r.estudiante.toLowerCase().includes(fText.toLowerCase())) : sorted;
    if (fil.length === 0) { tbody.innerHTML = `<tr><td colspan="8" class="empty-msg">Sin datos.</td></tr>`; DOM['results-count'].classList.add('hidden'); return; }
    DOM['results-count'].classList.remove('hidden'); DOM['results-count'].textContent = `Mostrando ${fil.length} de ${resultadosEvaluacion.length}`;
    fil.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${resultadosEvaluacion.indexOf(r)+1}</td><td><strong>${escapeHTML(r.estudiante)}</strong></td><td>${r.c1} / 5</td><td>${r.c2} / 7</td><td>${r.c3} / 8</td><td><span class="badge ${r.notaFinal>=14?'badge-success':(r.notaFinal>=11?'badge-warning':'badge-danger')}">${r.notaFinal}</span></td><td>${r.conectoresHallados}</td><td style="font-size:0.82rem;">${escapeHTML(r.observacion)}</td>`;
        tbody.appendChild(tr);
    });
}

function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false; resultadosEvaluacion = []; archivosDetectados = [];
    DOM['table-body'].innerHTML = '<tr><td colspan="8" class="empty-msg">Sube archivos.</td></tr>';
    DOM['error-list'].innerHTML = ''; DOM['error-panel'].classList.add('hidden');
    DOM['progress-bar'].classList.add('hidden'); DOM['btn-export-pdf'].disabled = true; DOM['btn-export-csv'].disabled = true; DOM['btn-clear'].disabled = true;
    DOM['file-input'].value = ''; DOM['folder-input'].value = ''; updateFileListUI();
}

function setupEvents() {
    ['dragenter','dragover','dragleave','drop'].forEach(ev => DOM['drop-zone'].addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    DOM['drop-zone'].addEventListener('dragover', () => DOM['drop-zone'].classList.add('dragover'));
    DOM['drop-zone'].addEventListener('dragleave', () => DOM['drop-zone'].classList.remove('dragover'));
    DOM['drop-zone'].addEventListener('drop', async (e) => {
        DOM['drop-zone'].classList.remove('dragover');
        if (isProcessing) return;
        await addFilesToList(Array.from(e.dataTransfer.files));
        if (archivosDetectados.length > 0) processAllFiles();
    });
    DOM['file-input'].addEventListener('change', async (e) => {
        let f = Array.from(e.target.files); e.target.value = '';
        if (f.length > 0) { await addFilesToList(f); processAllFiles(); }
    });
    DOM['drop-zone'].addEventListener('click', (e) => { if(e.target===DOM['drop-zone']) DOM['file-input'].click(); });
    DOM['btn-clear'].addEventListener('click', clearAll);
    DOM['btn-cancel'].addEventListener('click', () => { if(abortController) abortController.abort(); isProcessing=false; DOM['loading-overlay'].classList.add('hidden'); });
}

function init() { cacheDOM(); if(checkDependencies()) { configurePDFJS(); setupEvents(); } }
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
"""

with open('index_memoria_optimizada.js', 'w', encoding='utf-8') as f:
    f.write(js_code)
print("Archivo generado exitosamente.")
