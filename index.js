/* ============================================================
   index.js — Motor de Evaluación Automatizada (Versión Fortalecida)
   Optimizado para procesamiento masivo (30+ archivos), prevención
   de congelamiento mediante asincronía y actualización dinámica de UI.
   ============================================================ */

// ─── Verificación de Dependencias CDN ───
const REQUIRED_LIBS = {
    pdfjsLib:  'PDF.js (procesamiento de PDF)',
    jspdf:    'jsPDF (exportación de reportes)',
    mammoth:  'Mammoth.js (lectura de DOCX)',
    JSZip:    'JSZip (descompresión de archivos ZIP)'
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
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ') + '. Verifica tu conexión a internet y recarga la página.';
        console.error('[CDN] Librerías faltantes:', missing);
        return false;
    }
    alertEl.classList.add('hidden');
    return true;
}

// ─── Configuración de PDF.js Worker ───
function configurePDFJS() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ─── Auxiliar de Liberación de Hilo Principal (Evita el congelamiento de UI) ───
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

// ─── Diccionarios de Evaluación ───
const DIC_LEY = [
    { word: 'ley', weight: 1.2 }, { word: 'norma', weight: 1.0 }, { word: 'decreto', weight: 1.1 },
    { word: 'derecho', weight: 0.8 }, { word: 'mtpe', weight: 1.3 }, { word: 'artículo', weight: 1.0 },
    { word: 'reglamento', weight: 1.0 }, { word: '29381', weight: 1.5 }, { word: '27942', weight: 1.5 },
    { word: '28518', weight: 1.5 }, { word: 'beneficio', weight: 0.7 }, { word: 'acoso', weight: 1.0 },
    { word: 'flexibilidad', weight: 0.7 }
];
const DIC_EVIDENCIA = [
    { word: 'sunafil', weight: 1.5 }, { word: 'resolución', weight: 1.2 }, { word: 'noticia', weight: 0.9 },
    { word: 'empresa', weight: 0.7 }, { word: 'reportaje', weight: 1.0 }, { word: 'fuente', weight: 1.0 },
    { word: 'http', weight: 1.3 }, { word: 'https', weight: 1.3 }, { word: 'caso real', weight: 1.4 },
    { word: 'evidencia', weight: 1.1 }, { word: 'multa', weight: 1.0 }, { word: 'denuncia', weight: 1.0 }
];
const DIC_RRHH = [
    { word: 'recursos humanos', weight: 1.3 }, { word: 'rr.hh', weight: 1.3 }, { word: 'rrhh', weight: 1.3 },
    { word: 'ética', weight: 1.2 }, { word: 'código de ética', weight: 1.4 }, { word: 'postura', weight: 0.8 },
    { word: 'protocolo', weight: 1.0 }, { word: 'capacitación', weight: 1.1 }, { word: 'prevención', weight: 1.0 },
    { word: 'estrategia', weight: 0.9 }, { word: 'compromiso', weight: 0.8 }
];
const CONECTORES = [
    'en primer lugar', 'a continuación', 'primero', 'para terminar', 'finalmente', 'por otra parte',
    'en cuanto a', 'acerca de', 'con relación a', 'por tanto', 'por consiguiente', 'como resultado',
    'por lo cual', 'de ahí que', 'sin embargo', 'no obstante', 'en cambio', 'por el contrario',
    'en mi opinión', 'desde mi perspectiva', 'considero', 'es decir', 'en efecto', 'dicho de otra manera',
    'en conclusión', 'en resumen'
];

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
    const ids = [
        'drop-zone', 'file-input', 'folder-input', 'btn-folder', 'folder-fallback-msg',
        'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip',
        'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv',
        'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count',
        'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent',
        'btn-cancel', 'cdn-alert', 'cdn-alert-text'
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

// ─── Utilidades ───
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}
function getFileTypeIcon(type) {
    if (type === 'pdf') return '📄';
    if (type === 'docx') return '📝';
    if (type === 'zip') return '📦';
    return '📎';
}
function detectFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.zip')) return 'zip';
    return 'other';
}

// ─── Sincronización DOM ↔ Estado ───
function updateFileListUI() {
    const listEl = DOM['file-list-items'];
    const fileList = DOM['file-list'];
    listEl.innerHTML = '';

    if (archivosDetectados.length === 0) {
        fileList.classList.add('hidden');
        DOM['status-text'].textContent = 'Esperando archivos...';
        return;
    }
    fileList.classList.remove('hidden');
    DOM['file-count'].textContent = archivosDetectados.length;
    DOM['status-text'].textContent = `${archivosDetectados.length} archivo(s) listos para evaluar.`;

    let countPDF = 0, countDOCX = 0, countZIP = 0;
    archivosDetectados.forEach(f => {
        if (f.type === 'pdf') countPDF++;
        else if (f.type === 'docx') countDOCX++;
        else if (f.type === 'zip') countZIP++;
    });

    const toggleStat = (el, count) => {
        if (count > 0) { el.classList.remove('hidden'); el.textContent = el.textContent.replace(/\d+/, count); }
        else el.classList.add('hidden');
    };
    toggleStat(DOM['stat-pdf'], countPDF);
    toggleStat(DOM['stat-docx'], countDOCX);
    toggleStat(DOM['stat-zip'], countZIP);

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        chip.innerHTML = `
            <span class="chip-icon">${getFileTypeIcon(f.type)}</span>
            <span title="${escapeHTML(f.name)} (${formatFileSize(f.size)})">${escapeHTML(f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name)}</span>
            <button class="chip-remove" data-index="${i}" aria-label="Quitar ${escapeHTML(f.name)}">&times;</button>
        `;
        listEl.appendChild(chip);
    });

    listEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isProcessing) return;
            const idx = parseInt(btn.dataset.index);
            archivosDetectados.splice(idx, 1);
            updateFileListUI();
        });
    });
}

async function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
        const file = files[i];
        const type = detectFileType(file);
        if (!validTypes.includes(type)) continue;

        const exists = archivosDetectados.some(f => f.name === file.name && f.size === file.size);
        if (!exists) {
            archivosDetectados.push({ name: file.name, type, file, size: file.size });
            added++;
        }

        // Carga dinámica: libera la UI cada 5 archivos reconocidos
        if (i % 5 === 0) {
            DOM['status-text'].textContent = `Reconociendo archivo ${i + 1} de ${totalFiles}...`;
            await yieldUI();
        }
    }

    if (added > 0) updateFileListUI();
    return added;
}

// ─── Extracción de Texto No Bloqueante ───
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + ' ';
        if (i % 2 === 0) await yieldUI(); // Libera el hilo cada 2 páginas
    }
    return fullText.toLowerCase();
}

async function extractTextFromDOCX(file) {
    const arrayBuffer = await file.arrayBuffer();
    await yieldUI();
    const result = await mammoth.extractRawText({ arrayBuffer });
    await yieldUI();
    return result.value.toLowerCase();
}

async function extractFilesFromZip(zipFile) {
    const extracted = [];
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);

    for (let i = 0; i < entries.length; i++) {
        const zipEntry = entries[i];
        const name = zipEntry.name.split('/').pop();
        const lower = name.toLowerCase();

        if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
            const type = lower.endsWith('.pdf') ? 'pdf' : 'docx';
            const blob = await zipEntry.async('blob');
            const file = new File([blob], name, {
                type: type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
            extracted.push({ name, type, file, size: blob.size });
        }
        if (i % 3 === 0) await yieldUI();
    }
    return extracted;
}

// ─── Motor de Evaluación Ponderado ───
function computeWeightedScore(dict, text) {
    let score = 0;
    for (const entry of dict) {
        const safeWord = entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${safeWord}\\b`, 'gi');
        const matches = (text.match(regex) || []).length;
        score += matches * entry.weight;
    }
    return score;
}

function evaluateContent(fileName, text) {
    let c1 = 1, c2 = 1, c3 = 1;
    let conectoresHallados = 0;
    const observaciones = [];

    CONECTORES.forEach(c => {
        if (text.includes(c)) conectoresHallados++;
    });

    const scoreLey = computeWeightedScore(DIC_LEY, text);
    if (scoreLey >= 8) { c1 = 5; } 
    else if (scoreLey >= 4) { c1 = 3; observaciones.push('Falta profundizar en la precisión del marco legal peruano.'); } 
    else { c1 = Math.max(1, Math.round(scoreLey / 2)); observaciones.push('Explicación muy general. Omitió citar normas legales específicas.'); }

    const scoreEvid = computeWeightedScore(DIC_EVIDENCIA, text);
    const hasSource = text.includes('sunafil') || text.includes('http') || text.includes('resolución');
    if (scoreEvid >= 6 && hasSource) { c2 = 7; } 
    else if (scoreEvid >= 3) { c2 = 4; observaciones.push('Menciona casos, pero falta precisar fuentes verificables (SUNAFIL/Noticias).'); } 
    else { c2 = Math.max(1, Math.round(scoreEvid / 2)); observaciones.push('Faltan casos reales con evidencia verificable.'); }

    const scoreRRHH = computeWeightedScore(DIC_RRHH, text);
    if (scoreRRHH >= 6) { c3 = 8; } 
    else if (scoreRRHH >= 3) { c3 = 4; observaciones.push('La propuesta de acción para el área de RR.HH. es genérica.'); } 
    else { c3 = Math.max(1, Math.round(scoreRRHH / 2)); observaciones.push('No fundamenta la responsabilidad estratégica del área de RR.HH.'); }

    if (conectoresHallados < 3) {
        observaciones.push('Fortalecer el uso de conectores lógicos para la cohesión del texto.');
    }

    const notaFinal = c1 + c2 + c3;
    const estudiante = fileName.replace(/\.(pdf|docx)$/i, '').replace(/_/g, ' ');

    return {
        estudiante, c1, c2, c3, notaFinal, conectoresHallados,
        observacion: observaciones.join(' ') || '¡Excelente trabajo! Cumple con la estructura y rigor.'
    };
}

// ─── UI de Carga ───
function showLoading() {
    DOM['loading-overlay'].classList.remove('hidden');
    DOM['overlay-progress'].value = 0;
    DOM['overlay-percent'].textContent = '0%';
    DOM['loading-title'].textContent = 'Procesando archivos...';
    DOM['loading-detail'].textContent = 'Preparando documentos';
    DOM['btn-cancel'].classList.remove('hidden');
}
function hideLoading() { DOM['loading-overlay'].classList.add('hidden'); }
function updateLoadingProgress(current, total, detail) {
    const pct = Math.round((current / total) * 100);
    DOM['overlay-progress'].value = pct;
    DOM['overlay-percent'].textContent = pct + '%';
    if (detail) DOM['loading-detail'].textContent = detail;
}
function addError(archivo, mensaje) {
    const panel = DOM['error-panel'];
    const list = DOM['error-list'];
    panel.classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = `[${archivo}] ${mensaje}`;
    list.appendChild(li);
}

// ─── Lógica de Procesamiento Principal en Lote ───
async function processAllFiles() {
    if (isProcessing) return;
    if (archivosDetectados.length === 0) {
        alert('No hay archivos para procesar. Agrega documentos PDF, DOCX o ZIP primero.');
        return;
    }

    isProcessing = true;
    abortController = new AbortController();
    const signal = abortController.signal;
    
    resultadosEvaluacion = [];
    DOM['table-body'].innerHTML = '';
    DOM['error-list'].innerHTML = '';
    DOM['error-panel'].classList.add('hidden');
    DOM['progress-bar'].classList.remove('hidden');
    DOM['progress-bar'].value = 0;
    showLoading();

    try {
        const allFilesToProcess = [];
        for (let i = 0; i < archivosDetectados.length; i++) {
            if (signal.aborted) break;
            const item = archivosDetectados[i];

            if (item.type === 'zip') {
                updateLoadingProgress(i + 1, archivosDetectados.length, `Descomprimiendo: ${item.name}...`);
                try {
                    const extracted = await extractFilesFromZip(item.file);
                    allFilesToProcess.push(...extracted);
                } catch (err) { addError(item.name, 'Error al descomprimir ZIP: ' + err.message); }
            } else {
                allFilesToProcess.push(item);
            }
            await yieldUI();
        }

        if (!signal.aborted) {
            const total = allFilesToProcess.length;
            for (let i = 0; i < total; i++) {
                if (signal.aborted) break;
                const item = allFilesToProcess[i];
                const label = `Evaluando (${i + 1}/${total}): ${item.name}`;
                
                DOM['status-text'].textContent = label;
                updateLoadingProgress(i + 1, total, label);

                try {
                    let text = '';
                    if (item.type === 'pdf') { text = await extractTextFromPDF(item.file); } 
                    else if (item.type === 'docx') { text = await extractTextFromDOCX(item.file); }

                    if (!text || text.trim().length < 50) {
                        addError(item.name, 'El documento está vacío o no contiene suficiente texto legible.');
                    } else {
                        resultadosEvaluacion.push(evaluateContent(item.name, text));
                    }
                } catch (err) { 
                    addError(item.name, 'Error al extraer contenido: ' + err.message); 
                }

                DOM['progress-bar'].value = Math.round(((i + 1) / total) * 100);
                await yieldUI();
            }
        }
    } finally {
        isProcessing = false;
        hideLoading();
        DOM['progress-bar'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            DOM['status-text'].textContent = `¡Proceso completado! Se evaluaron ${resultadosEvaluacion.length} documento(s).`;
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            DOM['btn-clear'].disabled = false;
            renderTable();
        } else {
            DOM['status-text'].textContent = 'No se pudo generar evaluaciones. Revisa el panel de incidencias.';
        }
    }
}

// ─── Renderizado de Tabla y Filtros ───
function getSortedResults() {
    const sorted = [...resultadosEvaluacion];
    if (!sortColumn) return sorted;
    sorted.sort((a, b) => {
        let valA, valB;
        if (sortColumn === 'index') { valA = resultadosEvaluacion.indexOf(a); valB = resultadosEvaluacion.indexOf(b); } 
        else { valA = a[sortColumn]; valB = b[sortColumn]; }
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    return sorted;
}

function renderTable(filterText = '') {
    const tbody = DOM['table-body'];
    tbody.innerHTML = '';
    const sorted = getSortedResults();
    const filtered = filterText ? sorted.filter(r => r.estudiante.toLowerCase().includes(filterText.toLowerCase())) : sorted;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-msg">${filterText ? 'Sin coincidencias para el filtro.' : 'No hay datos procesados. Sube archivos PDF, DOCX o ZIP para iniciar.'}</td></tr>`;
        DOM['results-count'].classList.add('hidden');
        return;
    }
    DOM['results-count'].classList.remove('hidden');
    DOM['results-count'].textContent = `Mostrando ${filtered.length} de ${resultadosEvaluacion.length}`;

    filtered.forEach((res) => {
        const originalIndex = resultadosEvaluacion.indexOf(res) + 1;
        const badgeClass = res.notaFinal >= 14 ? 'badge-success' : (res.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${originalIndex}</td>
            <td><strong>${escapeHTML(res.estudiante)}</strong></td>
            <td>${res.c1} / 5</td>
            <td>${res.c2} / 7</td>
            <td>${res.c3} / 8</td>
            <td><span class="badge ${badgeClass}">${res.notaFinal} / 20</span></td>
            <td>${res.conectoresHallados}</td>
            <td style="font-size:0.82rem;color:#475569;">${escapeHTML(res.observacion)}</td>
        `;
        tbody.appendChild(row);
    });
}

function setupSortableHeaders() {
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortColumn === col) { sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; } 
            else { sortColumn = col; sortDirection = 'asc'; }
            document.querySelectorAll('.sortable').forEach(h => h.classList.remove('asc', 'desc'));
            th.classList.add(sortDirection);
            renderTable(DOM['filter-input'].value);
        });
    });
}

// ─── Exportación y Limpieza ───
function exportCSV() {
    let csvContent = '\uFEFFEstudiante,C1 Ley(5P),C2 Evidencias(7P),C3 RRHH(8P),Nota Final,Conectores,Observaciones\n';
    resultadosEvaluacion.forEach(r => {
        csvContent += `"${r.estudiante}",${r.c1},${r.c2},${r.c3},${r.notaFinal},${r.conectoresHallados},"${r.observacion}"\n`;
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'Reporte_Evaluacion_RRHH.csv';
    link.click(); URL.revokeObjectURL(url);
}

function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16); doc.text('Reporte Consolidado de Evaluación Académica', 14, 15);
    doc.setFontSize(10); doc.text('Programa de Gestión Humana y Derecho Laboral | Escala Vigesimal (0-20)', 14, 22);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-PE')}`, 14, 28);

    const tableData = resultadosEvaluacion.map((r, i) => [
        i + 1, r.estudiante, `${r.c1}/5`, `${r.c2}/7`, `${r.c3}/8`, `${r.notaFinal}/20`, r.observacion
    ]);
    doc.autoTable({
        startY: 34, head: [['#', 'Estudiante', 'C1 (5P)', 'C2 (7P)', 'C3 (8P)', 'Nota', 'Observaciones']],
        body: tableData, theme: 'striped', headStyles: { fillColor: [0, 119, 182] },
        styles: { fontSize: 8, cellPadding: 2 }, columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 40 }, 6: { cellWidth: 'auto' } }
    });
    doc.save('Reporte_Consolidado_Evaluaciones.pdf');
}

function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = []; archivosDetectados = []; sortColumn = null; sortDirection = 'asc';
    DOM['table-body'].innerHTML = '<tr><td colspan="8" class="empty-msg">No hay datos procesados. Sube archivos PDF, DOCX o ZIP para iniciar.</td></tr>';
    DOM['error-list'].innerHTML = ''; DOM['error-panel'].classList.add('hidden');
    DOM['status-text'].textContent = 'Esperando archivos...';
    DOM['progress-bar'].classList.add('hidden'); DOM['progress-bar'].value = 0;
    DOM['btn-export-pdf'].disabled = true; DOM['btn-export-csv'].disabled = true; DOM['btn-clear'].disabled = true;
    DOM['filter-input'].value = ''; DOM['results-count'].classList.add('hidden');
    DOM['file-input'].value = ''; DOM['folder-input'].value = '';
    updateFileListUI(); hideLoading();
}

// ─── Drag & Drop e Inputs ───
function setupDragDrop() {
    const dz = DOM['drop-zone'];
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
        dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });
    dz.addEventListener('dragenter', () => dz.classList.add('dragover'));
    dz.addEventListener('dragover', () => dz.classList.add('dragover'));
    dz.addEventListener('dragleave', (e) => {
        if (!dz.contains(e.relatedTarget)) dz.classList.remove('dragover');
    });
    
    dz.addEventListener('drop', async (e) => {
        dz.classList.remove('dragover');
        if (isProcessing) return;
        
        const items = e.dataTransfer.items;
        if (items) { 
            await collectFilesFromDataTransfer(items); 
        } else { 
            await addFilesToList(Array.from(e.dataTransfer.files)); 
        }

        if (archivosDetectados.length > 0) {
            processAllFiles();
        }
    });

    dz.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); DOM['file-input'].click(); }
    });
}

async function collectFilesFromDataTransfer(items) {
    const files = []; const entries = [];
    for (const item of items) {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);
        if (entry) { entries.push(entry); } 
        else { const file = item.getAsFile(); if (file) files.push(file); }
    }
    for (const entry of entries) { await readEntry(entry, files); }
    await addFilesToList(files);
}

async function readEntry(entry, accumulator) {
    if (entry.isFile) {
        return new Promise(resolve => { entry.file(file => { accumulator.push(file); resolve(); }); });
    } else if (entry.isDirectory) {
        const reader = entry.createReader();
        return new Promise(resolve => {
            reader.readEntries(async entries => {
                for (const child of entries) await readEntry(child, accumulator);
                resolve();
            });
        });
    }
}

function setupEvents() {
    setupDragDrop();
    
    // Reinicio inmediato de inputs tras la selección para permitir subidas continuas
    DOM['file-input'].addEventListener('change', async (e) => {
        const selected = Array.from(e.target.files);
        e.target.value = ''; // REINICIO CLAVE
        if (selected.length > 0) {
            await addFilesToList(selected);
            processAllFiles();
        }
    });

    if (typeof HTMLInputElement.prototype.webkitdirectory !== 'undefined') {
        DOM['btn-folder'].addEventListener('click', () => DOM['folder-input'].click());
        DOM['folder-input'].addEventListener('change', async (e) => {
            const selected = Array.from(e.target.files);
            e.target.value = ''; // REINICIO CLAVE
            if (selected.length > 0) {
                await addFilesToList(selected);
                processAllFiles();
            }
        });
    } else {
        DOM['btn-folder'].classList.add('hidden');
        DOM['folder-fallback-msg'].classList.remove('hidden');
    }

    DOM['drop-zone'].addEventListener('click', (e) => {
        if (e.target === DOM['drop-zone'] || e.target.closest('.drop-zone-content')) {
            DOM['file-input'].click();
        }
    });

    DOM['btn-export-csv'].addEventListener('click', exportCSV);
    DOM['btn-export-pdf'].addEventListener('click', exportPDF);
    DOM['btn-clear'].addEventListener('click', clearAll);
    
    DOM['btn-dismiss-errors'].addEventListener('click', () => {
        DOM['error-panel'].classList.add('hidden'); DOM['error-list'].innerHTML = '';
    });
    DOM['filter-input'].addEventListener('input', (e) => renderTable(e.target.value));
    
    DOM['btn-cancel'].addEventListener('click', () => {
        if (abortController) abortController.abort();
        isProcessing = false;
        hideLoading();
        DOM['status-text'].textContent = 'Procesamiento cancelado por el usuario.';
        DOM['progress-bar'].classList.add('hidden');
    });

    setupSortableHeaders();
}

function init() {
    cacheDOM();
    if (!checkDependencies()) return;
    configurePDFJS();
    setupEvents();
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } 
else { init(); }
