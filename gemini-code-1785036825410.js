/* ============================================================
   SISTEMA DE EVALUACIÓN AUTOMATIZADA — VERSIÓN GITHUB PAGES
   ============================================================ */

// ─── CONFIGURACIÓN DEL WORKER DE PDF.JS PARA GITHUB PAGES ───
// Aseguramos que la ruta coincida con la versión exacta cargada en el HTML
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ─── DICCIONARIOS DE EVALUACIÓN (Pesos Ajustados) ───────────
const DIC_LEY = [
    { word: "ley", weight: 1.5 }, { word: "norma", weight: 1.2 }, { word: "decreto supremo", weight: 2.0 },
    { word: "decreto", weight: 1.0 }, { word: "derecho", weight: 1.0 }, { word: "mtpe", weight: 1.5 },
    { word: "artículo", weight: 1.0 }, { word: "reglamento", weight: 1.3 }, { word: "ley 29381", weight: 2.5 },
    { word: "ley 27942", weight: 2.5 }, { word: "ley 28518", weight: 2.5 }, { word: "beneficio social", weight: 1.5 },
    { word: "acoso laboral", weight: 2.0 }, { word: "flexibilidad", weight: 1.0 }, { word: "constitución", weight: 2.0 },
    { word: "jurisprudencia", weight: 2.0 }
];

const DIC_EVIDENCIA = [
    { word: "sunafil", weight: 2.5 }, { word: "resolución", weight: 1.5 }, { word: "noticia", weight: 1.0 },
    { word: "empresa", weight: 0.8 }, { word: "reportaje", weight: 1.2 }, { word: "fuente", weight: 1.0 },
    { word: "http", weight: 1.5 }, { word: "https", weight: 1.5 }, { word: "caso real", weight: 2.0 },
    { word: "evidencia", weight: 1.5 }, { word: "multa", weight: 1.5 }, { word: "denuncia", weight: 1.5 },
    { word: "estadística", weight: 1.3 }, { word: "sentencia", weight: 2.0 }
];

const DIC_RRHH = [
    { word: "recursos humanos", weight: 2.0 }, { word: "rr.hh", weight: 1.5 }, { word: "rrhh", weight: 1.5 },
    { word: "ética", weight: 1.5 }, { word: "código de ética", weight: 2.5 }, { word: "postura", weight: 1.0 },
    { word: "protocolo", weight: 1.3 }, { word: "capacitación", weight: 1.5 }, { word: "prevención", weight: 1.5 },
    { word: "estrategia", weight: 1.2 }, { word: "compromiso", weight: 1.2 }, { word: "bienestar laboral", weight: 2.0 },
    { word: "clima laboral", weight: 1.8 }, { word: "liderazgo", weight: 1.3 }, { word: "inclusión", weight: 1.5 }
];

const CONECTORES = [
    "en primer lugar", "a continuación", "primero", "para terminar", "finalmente", "por otra parte", 
    "en cuanto a", "acerca de", "con relación a", "por tanto", "por consiguiente", "como resultado", 
    "por lo cual", "de ahí que", "sin embargo", "no obstante", "en cambio", "por el contrario", 
    "en mi opinión", "desde mi perspectiva", "considero", "es decir", "en efecto", "dicho de otra manera", 
    "en conclusión", "en resumen", "asimismo", "además", "igualmente", "en consecuencia"
];

// ─── ESTADO GLOBAL ──────────────────────────────────────────
let resultadosEvaluacion = [];
let erroresProcesamiento = [];
let archivosDetectados   = []; 

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));
const $ = (sel) => document.querySelector(sel);

// ─── REFERENCIAS DOM ────────────────────────────────────────
const dropZone        = $('#drop-zone');
const fileInput       = $('#file-input');
const folderInput     = $('#folder-input');
const fileList        = $('#file-list');
const fileListCont    = $('#file-list-container');
const fileCount       = $('#file-count');
const statusText      = $('#status-text');
const tableBody       = $('#table-body');
const btnPdf          = $('#btn-export-pdf');
const btnCsv          = $('#btn-export-csv');
const btnClear        = $('#btn-clear');
const btnSelectFiles  = $('#btn-select-files');
const btnSelectFolder = $('#btn-select-folder');
const filterInput     = $('#filter-input');
const filterBar       = $('#filter-bar');
const inputUmbral     = $('#umbral-aprobacion');
const errorPanel      = $('#error-panel');
const errorMessage    = $('#error-message');
const loadingOverlay  = $('#loading-overlay');
const loadingMsg      = $('#loading-message');
const loadingProgress = $('#loading-progress');
const statsSummary    = $('#stats-summary');
const statTotal       = $('#stat-total');
const statPdf         = $('#stat-pdf');
const statDocx        = $('#stat-docx');
const statZip         = $('#stat-zip');

// ─── INICIALIZACIÓN ─────────────────────────────────────────
function init() {
    if (typeof JSZip === 'undefined' || typeof pdfjsLib === 'undefined' || typeof mammoth === 'undefined') {
        showError('Error de red: No se pudieron cargar las librerías necesarias. Verifica tu conexión a internet.');
        return;
    }
    bindDragDrop();
    bindButtons();
    bindFilters();
    bindErrorDismiss();
    bindDropZoneKeyboard();
}

// ─── DRAG & DROP ────────────────────────────────────────────
function bindDragDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => 
        dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); })
    );
    dropZone.addEventListener('dragenter', () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragover',  () => dropZone.classList.add('dragover'));
    dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', e => {
        dropZone.classList.remove('dragover');
        const items = e.dataTransfer.items;
        if (items) collectFilesFromDataTransfer(items);
        else handleIncomingFiles(Array.from(e.dataTransfer.files));
    });

    fileInput.addEventListener('change', () => { handleIncomingFiles(Array.from(fileInput.files)); fileInput.value = ''; });
    folderInput.addEventListener('change', () => { handleIncomingFiles(Array.from(folderInput.files)); folderInput.value = ''; });
}

// ─── RECOLECCIÓN DE ARCHIVOS Y CARPETAS ─────────────────────
async function collectFilesFromDataTransfer(items) {
    const allFiles = [];
    async function traverse(item) {
        if (item.kind === 'file') {
            const file = item.getAsFile();
            if (file) allFiles.push(file);
        } else if (item.kind === 'directory' || item.webkitGetAsEntry) {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry && entry.isDirectory) await readDirectory(entry, allFiles);
            else if (entry && entry.isFile) {
                const file = await entryToFile(entry);
                if (file) allFiles.push(file);
            }
        }
    }
    for (let i = 0; i < items.length; i++) await traverse(items[i]);
    handleIncomingFiles(allFiles);
}

function readDirectory(dirEntry, accumulator) {
    return new Promise((resolve) => {
        const reader = dirEntry.createReader();
        const readBatch = () => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve(); return; }
                for (const entry of entries) {
                    if (entry.isFile) { const file = await entryToFile(entry); if (file) accumulator.push(file); }
                    else if (entry.isDirectory) await readDirectory(entry, accumulator);
                }
                readBatch();
            });
        };
        readBatch();
    });
}
function entryToFile(entry) { return new Promise(resolve => entry.file(file => resolve(file), () => resolve(null))); }

// ─── FILTRADO Y ACTUALIZACIÓN DE INTERFAZ ───────────────────
function handleIncomingFiles(files) {
    if (!files || files.length === 0) return;
    const validExtensions = ['.pdf', '.docx', '.zip'];
    const validFiles = files.filter(f => {
        if (isSystemOrHiddenFile(f.name)) return false;
        return validExtensions.includes('.' + f.name.split('.').pop().toLowerCase());
    });

    if (validFiles.length === 0) { showError('Formato inválido. Sube únicamente archivos PDF, DOCX o ZIP.'); return; }

    archivosDetectados = validFiles.map(f => ({ name: f.name, type: f.name.split('.').pop().toLowerCase(), size: f.size, file: f }));
    renderFileList();
    updateStats(archivosDetectados);
    processAllFiles();
}

function isSystemOrHiddenFile(path) {
    const fn = path.split('/').pop();
    return path.includes('__MACOSX') || fn.startsWith('._') || fn.startsWith('.') || fn.toLowerCase() === 'thumbs.db' || fn.toLowerCase() === 'desktop.ini';
}

function renderFileList() {
    fileList.innerHTML = '';
    const iconMap = { pdf: '📕', docx: '📘', zip: '📦' };
    archivosDetectados.forEach((f, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="file-icon">${iconMap[f.type] || '📄'}</span><span>${escapeHTML(f.name)}</span><button class="file-remove" data-index="${i}" title="Eliminar">&times;</button>`;
        fileList.appendChild(li);
    });
    fileList.querySelectorAll('.file-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            archivosDetectados.splice(parseInt(btn.dataset.index), 1);
            renderFileList(); updateStats(archivosDetectados);
            if (archivosDetectados.length === 0) { fileListCont.hidden = true; btnClear.disabled = true; }
        });
    });
    fileListCont.hidden = false; fileCount.textContent = archivosDetectados.length; btnClear.disabled = false;
}

function updateStats(list) {
    statTotal.textContent = list.length;
    statPdf.textContent = list.filter(f => f.type === 'pdf').length;
    statDocx.textContent = list.filter(f => f.type === 'docx').length;
    statZip.textContent = list.filter(f => f.type === 'zip').length;
    statsSummary.hidden = list.length === 0;
}

// ─── MOTOR PRINCIPAL ASÍNCRONO ──────────────────────────────
async function processAllFiles() {
    if (archivosDetectados.length === 0) return;
    resultadosEvaluacion = []; erroresProcesamiento = []; hideError();
    showLoading('Preparando procesamiento...', 0); await yieldToMain();

    const flatFiles = [];
    for (let i = 0; i < archivosDetectados.length; i++) {
        const entry = archivosDetectados[i];
        if (entry.type === 'zip') {
            updateLoading(`Descomprimiendo: ${entry.name}`, 10); await yieldToMain();
            try {
                const extracted = await extractZip(entry.file);
                if (extracted.length === 0) erroresProcesamiento.push(`${entry.name}: No contenía PDF/DOCX válidos.`);
                else flatFiles.push(...extracted);
            } catch (err) { erroresProcesamiento.push(`Error abriendo ZIP (${entry.name}).`); }
        } else { flatFiles.push(entry); }
    }

    updateStats(flatFiles);

    if (flatFiles.length === 0) {
        hideLoading(); showError('No se encontraron documentos válidos para evaluar tras la extracción.');
        statusText.textContent = '⚠️ Sin documentos válidos.'; return;
    }

    const total = flatFiles.length;
    for (let i = 0; i < total; i++) {
        const entry = flatFiles[i];
        updateLoading(`Evaluando (${i + 1}/${total}): ${entry.name}`, Math.round(((i + 1) / total) * 100)); await yieldToMain();
        try {
            let text = '';
            if (entry.type === 'pdf') text = await extractTextFromPDF(entry.file);
            else if (entry.type === 'docx') text = await extractTextFromDOCX(entry.file);
            
            if (!text || text.trim().length < 20) { erroresProcesamiento.push(`${entry.name}: Sin texto legible (Posible imagen escaneada).`); continue; }
            resultadosEvaluacion.push(evaluateContent(entry.name, text));
        } catch (err) { erroresProcesamiento.push(`Error en lectura de ${entry.name}`); console.error(err); }
    }

    hideLoading();
    if (erroresProcesamiento.length > 0) showError(`Advertencias (${erroresProcesamiento.length}):\n${erroresProcesamiento.slice(0, 5).join('\n')}${erroresProcesamiento.length > 5 ? '\n...' : ''}`);
    statusText.textContent = resultadosEvaluacion.length > 0 ? `✅ Evaluación finalizada: ${resultadosEvaluacion.length} estudiantes procesados.` : '⚠️ Ningún documento cumplió los criterios de lectura.';
    
    renderTable();
    filterBar.hidden = resultadosEvaluacion.length === 0;
}

// ─── MÓDULOS DE EXTRACCIÓN (BLINDADOS) ──────────────────────
async function extractZip(zipFile, depth = 0) {
    if (depth > 3) return []; // Evitar ataques "Zip Bomb" limitando la recursividad
    const zip = await JSZip.loadAsync(zipFile), extracted = [];
    for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir || isSystemOrHiddenFile(path)) continue;
        const fileName = path.split('/').pop(), ext = '.' + fileName.split('.').pop().toLowerCase();
        if (['.pdf', '.docx'].includes(ext)) {
            const blob = await zipEntry.async('blob');
            extracted.push({ name: fileName, type: ext.replace('.', ''), size: blob.size, file: new File([blob], fileName) });
        } else if (ext === '.zip') {
            extracted.push(...await extractZip(new File([await zipEntry.async('blob')], fileName), depth + 1));
        }
    }
    return extracted;
}

async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) { // Límite 50 páginas por rendimiento web
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        text += textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' ') + ' ';
    }
    return text.toLowerCase().trim();
}

async function extractTextFromDOCX(file) { 
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value.toLowerCase().trim(); 
}

// ─── LÓGICA DE CALIFICACIÓN Y RÚBRICA ───────────────────────
function evaluateContent(fileName, text) {
    const scoreLey = computeScore(text, DIC_LEY, 5);
    let c1, obsLey = [];
    if (scoreLey >= 4.5) c1 = 5; else if (scoreLey >= 3) { c1 = 4; obsLey.push('Falta precisión legal.'); } else if (scoreLey >= 1.5) { c1 = 2; obsLey.push('Marco general. Sugerimos citar normas exactas.'); } else { c1 = 1; obsLey.push('Omitió base normativa.'); }

    const scoreEvid = computeScore(text, DIC_EVIDENCIA, 7);
    const hasSource = text.includes('sunafil') || text.includes('http') || text.includes('resolución') || text.includes('sentencia');
    let c2, obsEvid = [];
    if (scoreEvid >= 5.5 && hasSource) c2 = 7; else if (scoreEvid >= 3.5) { c2 = 5; obsEvid.push('Faltan enlaces o fuentes verificables.'); } else if (scoreEvid >= 1.5) { c2 = 3; obsEvid.push('Evidencias insuficientes.'); } else { c2 = 1; obsEvid.push('Carece de casos reales.'); }

    const scoreRRHH = computeScore(text, DIC_RRHH, 8);
    let c3, obsRRHH = [];
    if (scoreRRHH >= 6.5) c3 = 8; else if (scoreRRHH >= 4) { c3 = 6; obsRRHH.push('Acción de RRHH poco detallada.'); } else if (scoreRRHH >= 2) { c3 = 3; obsRRHH.push('Propuesta muy genérica.'); } else { c3 = 1; obsRRHH.push('No fundamenta el rol estratégico de RRHH.'); }

    let conectores = 0; CONECTORES.forEach(c => { if (text.includes(c)) conectores++; });
    if (conectores < 3) obsRRHH.push('Requiere mejorar uso de conectores lógicos.');

    const observacion = [...obsLey, ...obsEvid, ...obsRRHH].join(' ') || '¡Excelente trabajo! Cumple el rigor académico esperado.';
    
    let estudiante = fileName.replace(/\.(pdf|docx)$/i, '').replace(/_/g, ' ');
    estudiante = estudiante.replace(/^[0-9.]+\d+SEM-\d+-/i, ''); 

    return { estudiante, c1, c2, c3, notaFinal: c1 + c2 + c3, conectoresHallados: conectores, observacion };
}

function computeScore(text, dic, maxPoints) {
    let weight = 0;
    dic.forEach(({ word, w }) => { 
        const m = text.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')); 
        if (m) weight += m.length * (w || 1); 
    });
    const maxTheoretical = dic.reduce((s, { w }) => s + (w || 1) * 3, 0); // Asume 3 menciones como "ideal"
    return Math.min((maxTheoretical > 0 ? (weight / maxTheoretical) * maxPoints : 0), maxPoints);
}

// ─── RENDEREIZADO Y GESTIÓN DE EVENTOS ──────────────────────
function renderTable() {
    tableBody.innerHTML = '';
    const filter = filterInput.value.trim().toLowerCase();
    const umbral = parseInt(inputUmbral.value, 10) || 14;

    const filtered = filter ? resultadosEvaluacion.filter(r => r.estudiante.toLowerCase().includes(filter)) : resultadosEvaluacion;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="empty-msg">${filter ? 'No hay coincidencias.' : 'Sin datos procesados.'}</td></tr>`; return;
    }

    filtered.forEach((res, idx) => {
        const badgeClass = res.notaFinal >= umbral ? 'badge-success' : 'badge-danger';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${idx + 1}</td><td><strong>${escapeHTML(res.estudiante)}</strong></td>
            <td>${res.c1}/5</td><td>${res.c2}/7</td><td>${res.c3}/8</td>
            <td><span class="badge ${badgeClass}">${res.notaFinal}/20</span></td>
            <td>${res.conectoresHallados}</td>
            <td style="font-size:0.85rem; color:#475569;">${escapeHTML(res.observacion)}</td>`;
        tableBody.appendChild(tr);
    });
}

function bindFilters() {
    filterInput.addEventListener('input', renderTable);
    inputUmbral.addEventListener('input', renderTable);
}

function bindButtons() {
    btnSelectFiles.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
    btnSelectFolder.addEventListener('click', e => { e.stopPropagation(); folderInput.click(); });
    btnClear.addEventListener('click', () => { if(confirm('¿Deseas limpiar todos los registros?')) clearAll(); });
    btnCsv.addEventListener('click', exportCSV);
    btnPdf.addEventListener('click', exportPDF);
}

function clearAll() {
    resultadosEvaluacion = []; erroresProcesamiento = []; archivosDetectados = [];
    renderTable(); fileList.innerHTML = ''; fileListCont.hidden = true; statsSummary.hidden = true; filterBar.hidden = true; filterInput.value = '';
    statusText.textContent = 'Esperando archivos...'; hideError();
}

function exportCSV() {
    let csv = '\uFEFFEstudiante,C1 Ley,C2 Evidencias,C3 RRHH,Nota Final,Conectores,Observaciones\n';
    resultadosEvaluacion.forEach(r => csv += `"${r.estudiante}",${r.c1},${r.c2},${r.c3},${r.notaFinal},${r.conectoresHallados},"${r.observacion}"\n`);
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `Reporte_RRHH_${new Date().toISOString().slice(0,10)}.csv`; link.click();
}

function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });
    const umbral = parseInt(inputUmbral.value, 10) || 14;

    doc.setFontSize(16); doc.text('Reporte Consolidado de Evaluación', 14, 15);
    doc.setFontSize(10); doc.setTextColor(71, 85, 105); doc.text('Gestión Humana y Derecho Laboral | Escala Vigesimal (0-20)', 14, 21);
    doc.text(`Fecha: ${new Date().toLocaleDateString()} | Registros: ${resultadosEvaluacion.length} | Umbral de aprobación: ${umbral}`, 14, 27);

    const data = resultadosEvaluacion.map((r, i) => [
        i + 1, r.estudiante, r.c1, r.c2, r.c3, r.notaFinal, r.conectoresHallados.toString(), r.observacion
    ]);

    doc.autoTable({
        startY: 32,
        head: [['#', 'Estudiante', 'C1 (5)', 'C2 (7)', 'C3 (8)', 'Nota', 'Conect.', 'Observaciones']],
        body: data,
        theme: 'grid',
        headStyles: { fillColor: [3, 105, 161] },
        styles: { fontSize: 8, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 45, fontStyle: 'bold' }, 5: { fontStyle: 'bold' }, 7: { cellWidth: 90 } },
        didParseCell: function(data) {
            if (data.section === 'body' && data.column.index === 5) {
                const nota = parseInt(data.cell.raw, 10);
                if (nota < umbral) {
                    data.cell.styles.textColor = [255, 255, 255];
                    data.cell.styles.fillColor = [220, 38, 38]; // Destacado rojo sólido
                }
            }
        }
    });

    doc.save(`Evaluaciones_RRHH_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── UI AUXILIAR ────────────────────────────────────────────
function showLoading(m, p) { loadingMsg.textContent = m; loadingProgress.value = p; loadingOverlay.hidden = false; }
function updateLoading(m, p) { loadingMsg.textContent = m; loadingProgress.value = p; }
function hideLoading() { loadingOverlay.hidden = true; }
function showError(msg) { errorMessage.innerText = msg; errorPanel.hidden = false; }
function hideError() { errorPanel.hidden = true; }
function bindErrorDismiss() { $('.error-dismiss').addEventListener('click', hideError); }
function bindDropZoneKeyboard() { dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } }); }
function escapeHTML(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// Arrancar sistema al cargar DOM
document.addEventListener('DOMContentLoaded', init);