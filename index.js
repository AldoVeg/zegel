/* ============================================================
   index.js — Motor de Evaluación Automatizada (Memoria Optimizada)
   Procesamiento estricto en "Fila India", recolección de basura (RAM)
   y micro-barras de carga para evitar bloqueos silenciosos.
   ============================================================ */

// ─── Verificación de Dependencias CDN ───
const REQUIRED_LIBS = {
    pdfjsLib:  'PDF.js (procesamiento de PDF)',
    jspdf:    'jsPDF (exportación de reportes)',
    mammoth:  'Mammoth.js (lectura de DOCX)',
    JSZip:    'JSZip (descompresión de ZIP)'
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
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ') + '.';
        return false;
    }
    alertEl.classList.add('hidden');
    return true;
}

function configurePDFJS() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ─── Micro-pausa para forzar el redibujado de la UI y liberar la RAM ───
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

// ─── Diccionarios de Evaluación con Pesos ───
const DIC_LEY = [
    { word: 'ley', weight: 1.2 }, { word: 'norma', weight: 1.0 },
    { word: 'decreto', weight: 1.1 }, { word: 'derecho', weight: 0.8 },
    { word: 'mtpe', weight: 1.3 }, { word: 'artículo', weight: 1.0 },
    { word: 'reglamento', weight: 1.0 }, { word: '29381', weight: 1.5 },
    { word: '27942', weight: 1.5 }, { word: '28518', weight: 1.5 },
    { word: 'beneficio', weight: 0.7 }, { word: 'acoso', weight: 1.0 },
    { word: 'flexibilidad', weight: 0.7 }
];

const DIC_EVIDENCIA = [
    { word: 'sunafil', weight: 1.5 }, { word: 'resolución', weight: 1.2 },
    { word: 'noticia', weight: 0.9 }, { word: 'empresa', weight: 0.7 },
    { word: 'reportaje', weight: 1.0 }, { word: 'fuente', weight: 1.0 },
    { word: 'http', weight: 1.3 }, { word: 'https', weight: 1.3 },
    { word: 'caso real', weight: 1.4 }, { word: 'evidencia', weight: 1.1 },
    { word: 'multa', weight: 1.0 }, { word: 'denuncia', weight: 1.0 }
];

const DIC_RRHH = [
    { word: 'recursos humanos', weight: 1.3 }, { word: 'rr.hh', weight: 1.3 },
    { word: 'rrhh', weight: 1.3 }, { word: 'ética', weight: 1.2 },
    { word: 'código de ética', weight: 1.4 }, { word: 'postura', weight: 0.8 },
    { word: 'protocolo', weight: 1.0 }, { word: 'capacitación', weight: 1.1 },
    { word: 'prevención', weight: 1.0 }, { word: 'estrategia', weight: 0.9 },
    { word: 'compromiso', weight: 0.8 }
];

const CONECTORES = [
    'en primer lugar', 'a continuación', 'primero', 'para terminar', 'finalmente',
    'por otra parte', 'en cuanto a', 'acerca de', 'con relación a', 'por tanto',
    'por consiguiente', 'como resultado', 'por lo cual', 'de ahí que', 'sin embargo',
    'no obstante', 'en cambio', 'por el contrario', 'en mi opinión', 'desde mi perspectiva',
    'considero', 'es decir', 'en efecto', 'dicho de otra manera', 'en conclusión', 'en resumen'
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
        'drop-zone', 'file-input', 'folder-input', 'btn-folder',
        'folder-fallback-msg', 'file-list', 'file-list-items', 'file-count',
        'stat-pdf', 'stat-docx', 'stat-zip',
        'status-text', 'progress-bar',
        'btn-clear', 'btn-export-pdf', 'btn-export-csv',
        'error-panel', 'error-list', 'btn-dismiss-errors',
        'table-body', 'filter-input', 'results-count',
        'loading-overlay', 'loading-title', 'loading-detail',
        'overlay-progress', 'overlay-percent', 'btn-cancel',
        'cdn-alert', 'cdn-alert-text'
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
    if (type === 'pdf')  return '📄';
    if (type === 'docx') return '📝';
    if (type === 'zip')  return '📦';
    return '📎';
}

function detectFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf'))  return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.zip'))  return 'zip';
    return 'other';
}

// ─── UI: Lista de archivos detectados ───
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
    DOM['status-text'].innerHTML = archivosDetectados.length + ' archivo(s) listos para evaluar.';

    let cPDF = 0, cDOCX = 0, cZIP = 0;
    archivosDetectados.forEach(f => {
        if (f.type === 'pdf') cPDF++;
        else if (f.type === 'docx') cDOCX++;
        else if (f.type === 'zip') cZIP++;
    });

    const toggleStat = (el, count) => {
        if (count > 0) {
            el.classList.remove('hidden');
            const span = el.querySelector('span');
            if (span) span.textContent = count;
        } else {
            el.classList.add('hidden');
        }
    };
    toggleStat(DOM['stat-pdf'], cPDF);
    toggleStat(DOM['stat-docx'], cDOCX);
    toggleStat(DOM['stat-zip'], cZIP);

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        const displayName = f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name;
        chip.innerHTML =
            '<span class="chip-icon">' + getFileTypeIcon(f.type) + '</span> ' +
            '<span title="' + escapeHTML(f.name) + '">' + escapeHTML(displayName) + '</span> ' +
            '<button class="chip-remove" data-index="' + i + '">&times;</button>';
        listEl.appendChild(chip);
    });

    listEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (isProcessing) return;
            archivosDetectados.splice(parseInt(this.dataset.index), 1);
            updateFileListUI();
        });
    });
}

async function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) &&
            !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({
                name: files[i].name,
                type: type,
                file: files[i],
                size: files[i].size
            });
            added++;
        }
    }
    if (added > 0) updateFileListUI();
}

// ─── Lectura recursiva de carpetas (Drag & Drop) ───
async function collectFilesFromDataTransfer(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;
    if (!items) {
        // Fallback: usar files directamente
        return Array.from(dataTransfer.files);
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;

        // Feature detection: webkitGetAsEntry (Chromium) vs getAsEntry (Firefox)
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);

        if (entry && entry.isDirectory) {
            await readEntry(entry, files);
        } else if (entry && entry.isFile) {
            const file = item.getAsFile();
            if (file) files.push(file);
        } else {
            const file = item.getAsFile();
            if (file) files.push(file);
        }
    }
    return files;
}

function readEntry(entry, files) {
    return new Promise((resolve) => {
        if (entry.isFile) {
            entry.file(file => {
                files.push(file);
                resolve();
            });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            reader.readEntries(async (entries) => {
                for (const e of entries) {
                    await readEntry(e, files);
                }
                resolve();
            });
        } else {
            resolve();
        }
    });
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

        // Forzar limpieza de memoria de la página
        page.cleanup();

        // Dibujar micro-barra de carga
        DOM['status-text'].innerHTML =
            '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
            '<span>Leyendo: <strong>' + escapeHTML(file.name.substring(0, 25)) + '...</strong></span>' +
            '<span>Página ' + i + ' de ' + pdf.numPages + '</span>' +
            '<progress value="' + i + '" max="' + pdf.numPages + '" style="width:100%;height:6px;border-radius:3px;"></progress>' +
            '</div>';
        await yieldUI();
    }

    // Destruir el PDF en RAM
    await loadingTask.destroy();
    arrayBuffer = null;
    return fullText.toLowerCase();
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    DOM['status-text'].innerHTML =
        '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
        '<span>Leyendo: <strong>' + escapeHTML(file.name.substring(0, 25)) + '...</strong></span>' +
        '<span>Extrayendo texto del documento Word...</span>' +
        '<progress style="width:100%;height:6px;border-radius:3px;"></progress>' +
        '</div>';
    await yieldUI();

    let result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    let text = result.value.toLowerCase();

    // Limpieza de RAM
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
            let fileName = zipEntry.name.split('/').pop();
            let mimeType = lower.endsWith('.pdf')
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            let file = new File([blob], fileName, { type: mimeType });
            extracted.push({
                name: fileName,
                type: lower.endsWith('.pdf') ? 'pdf' : 'docx',
                file: file,
                size: blob.size
            });
            blob = null;
        }
        if (i % 3 === 0) await yieldUI();
    }
    return extracted;
}

// ─── Motor de Evaluación Ponderado ───
function computeWeightedScore(dict, text) {
    let score = 0;
    for (const entry of dict) {
        const escaped = entry.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
        score += ((text.match(regex) || []).length) * entry.weight;
    }
    return score;
}

function evaluateContent(fileName, text) {
    let c1 = 1, c2 = 1, c3 = 1, conectores = 0;
    const obs = [];

    CONECTORES.forEach(c => { if (text.includes(c)) conectores++; });

    // Criterio 1: Leyes y Normativa (0-5 Pts)
    let sLey = computeWeightedScore(DIC_LEY, text);
    if (sLey >= 8) {
        c1 = 5;
    } else if (sLey >= 4) {
        c1 = 3;
        obs.push('Falta profundizar en el marco legal peruano.');
    } else {
        c1 = Math.max(1, Math.round(sLey / 2));
        obs.push('Omitió citar normas legales específicas.');
    }

    // Criterio 2: Evidencias y Casos Reales (0-7 Pts)
    let sEvid = computeWeightedScore(DIC_EVIDENCIA, text);
    if (sEvid >= 6 && (text.includes('sunafil') || text.includes('http'))) {
        c2 = 7;
    } else if (sEvid >= 3) {
        c2 = 4;
        obs.push('Menciona casos, pero falta precisar fuentes verificables (SUNAFIL/Noticias).');
    } else {
        c2 = Math.max(1, Math.round(sEvid / 2));
        obs.push('Faltan casos reales con evidencia verificable.');
    }

    // Criterio 3: Ética y Rol de RR.HH. (0-8 Pts)
    let sRRHH = computeWeightedScore(DIC_RRHH, text);
    if (sRRHH >= 6) {
        c3 = 8;
    } else if (sRRHH >= 3) {
        c3 = 4;
        obs.push('La propuesta de acción para el área de RR.HH. es genérica.');
    } else {
        c3 = Math.max(1, Math.round(sRRHH / 2));
        obs.push('No fundamenta la responsabilidad estratégica del área de RR.HH.');
    }

    if (conectores < 3) {
        obs.push('Fortalecer el uso de conectores lógicos para la cohesión del texto.');
    }

    const notaFinal = c1 + c2 + c3;
    const estudiante = fileName.replace(/\.(pdf|docx)$/i, '').replace(/_/g, ' ');

    return {
        estudiante: estudiante,
        c1: c1,
        c2: c2,
        c3: c3,
        notaFinal: notaFinal,
        conectoresHallados: conectores,
        observacion: obs.join(' ') || '¡Excelente trabajo! Cumple con la estructura y rigor académico.'
    };
}

// ─── Panel de Errores ───
function addError(archivo, mensaje) {
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = '[' + archivo + '] ' + mensaje;
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
    DOM['loading-title'].textContent = 'Procesando archivos...';
    DOM['loading-detail'].textContent = 'Preparando documentos';
    DOM['overlay-progress'].value = 0;
    DOM['overlay-percent'].textContent = '0%';
    DOM['btn-cancel'].classList.remove('hidden');

    try {
        // Copia para procesar como cola (Queue)
        let cola = [...archivosDetectados];
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;

            // Sacamos 1 archivo de la cola (Fila India)
            let item = cola.shift();

            if (item.type === 'zip') {
                DOM['loading-detail'].textContent = 'Extrayendo ZIP: ' + item.name + '...';
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    // Añadimos al inicio de la cola para procesar inmediatamente
                    cola.unshift(...extracted);
                    total += extracted.length - 1;
                } catch (e) {
                    addError(item.name, 'Error al descomprimir ZIP: ' + e.message);
                }
                item.file = null;
                item = null;
                continue;
            }

            procesados++;
            DOM['loading-detail'].textContent = 'Procesando archivo ' + procesados + ' de ' + total;
            DOM['overlay-progress'].value = Math.round((procesados / total) * 100);
            DOM['overlay-percent'].textContent = Math.round((procesados / total) * 100) + '%';
            DOM['progress-bar'].value = Math.round((procesados / total) * 100);

            try {
                let text = '';
                if (item.type === 'pdf') {
                    text = await extractTextFromPDF(item.file);
                } else if (item.type === 'docx') {
                    text = await extractTextFromDOCX(item.file);
                }

                if (!text || text.trim().length < 50) {
                    addError(item.name, 'Documento vacío o ilegible (menos de 50 caracteres).');
                } else {
                    resultadosEvaluacion.push(evaluateContent(item.name, text));
                }

                // Destrucción estricta de la variable de texto (evita colapso de RAM)
                text = null;
            } catch (err) {
                addError(item.name, 'Error al procesar: ' + err.message);
            }

            item.file = null;
            item = null;
            await yieldUI();
        }
    } finally {
        isProcessing = false;
        DOM['loading-overlay'].classList.add('hidden');
        DOM['progress-bar'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            DOM['status-text'].textContent =
                '¡Completado! Se evaluaron ' + resultadosEvaluacion.length + ' documento(s).';
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            DOM['btn-clear'].disabled = false;
            renderTable();
            saveState();
        } else {
            DOM['status-text'].textContent =
                'No se encontraron documentos válidos para evaluar. Revisa el panel de errores.';
        }
    }
}

// ─── Renderizado de Tabla ───
function renderTable(filterText) {
    filterText = filterText || '';
    const tbody = DOM['table-body'];
    tbody.innerHTML = '';

    let sorted = getSortedResults();

    let filtered = filterText
        ? sorted.filter(r => r.estudiante.toLowerCase().includes(filterText.toLowerCase()))
        : sorted;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-msg">Sin resultados que mostrar.</td></tr>';
        DOM['results-count'].classList.add('hidden');
        return;
    }

    DOM['results-count'].classList.remove('hidden');
    DOM['results-count'].textContent = 'Mostrando ' + filtered.length + ' de ' + resultadosEvaluacion.length;

    filtered.forEach(r => {
        const originalIndex = resultadosEvaluacion.indexOf(r) + 1;
        const badgeClass = r.notaFinal >= 14 ? 'badge-success'
            : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + originalIndex + '</td>' +
            '<td><strong>' + escapeHTML(r.estudiante) + '</strong></td>' +
            '<td>' + r.c1 + ' / 5</td>' +
            '<td>' + r.c2 + ' / 7</td>' +
            '<td>' + r.c3 + ' / 8</td>' +
            '<td><span class="badge ' + badgeClass + '">' + r.notaFinal + ' / 20</span></td>' +
            '<td>' + r.conectoresHallados + '</td>' +
            '<td style="font-size:0.82rem;color:#475569;">' + escapeHTML(r.observacion) + '</td>';
        tbody.appendChild(tr);
    });
}

// ─── Ordenamiento ───
function getSortedResults() {
    let sorted = [...resultadosEvaluacion];
    if (!sortColumn) return sorted;

    sorted.sort((a, b) => {
        let vA = a[sortColumn];
        let vB = b[sortColumn];
        if (typeof vA === 'string') vA = vA.toLowerCase();
        if (typeof vB === 'string') vB = vB.toLowerCase();
        if (vA < vB) return sortDirection === 'asc' ? -1 : 1;
        if (vA > vB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    return sorted;
}

function setupSortableHeaders() {
    document.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', function() {
            const col = this.dataset.sort;
            if (sortColumn === col) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = col;
                sortDirection = 'asc';
            }
            // Actualizar indicadores visuales
            document.querySelectorAll('.sortable').forEach(h => {
                h.classList.remove('asc', 'desc');
                h.setAttribute('aria-sort', 'none');
            });
            this.classList.add(sortDirection);
            this.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');
            renderTable(DOM['filter-input'].value);
        });
    });
}

// ─── Persistencia con sessionStorage ───
function saveState() {
    try {
        const state = {
            resultadosEvaluacion: resultadosEvaluacion,
            archivosDetectados: archivosDetectados.map(f => ({
                name: f.name, type: f.type, size: f.size
                // No guardamos el File object (no es serializable)
            })),
            sortColumn: sortColumn,
            sortDirection: sortDirection
        };
        sessionStorage.setItem('evaluador_state', JSON.stringify(state));
    } catch (e) {
        // sessionStorage puede fallar si está lleno; no es crítico
    }
}

function loadState() {
    try {
        const raw = sessionStorage.getItem('evaluador_state');
        if (!raw) return false;
        const state = JSON.parse(raw);
        if (state.resultadosEvaluacion && state.resultadosEvaluacion.length > 0) {
            resultadosEvaluacion = state.resultadosEvaluacion;
            sortColumn = state.sortColumn || null;
            sortDirection = state.sortDirection || 'asc';
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            DOM['btn-clear'].disabled = false;
            DOM['status-text'].textContent =
                'Sesión restaurada: ' + resultadosEvaluacion.length + ' evaluación(es) previa(s).';
            renderTable();
            return true;
        }
    } catch (e) {
        // Estado corrupto, ignorar
    }
    return false;
}

// ─── Limpieza Total ───
function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    sortColumn = null;
    sortDirection = 'asc';

    DOM['table-body'].innerHTML =
        '<tr><td colspan="8" class="empty-msg">No hay datos procesados. Sube los archivos para iniciar.</td></tr>';
    DOM['error-list'].innerHTML = '';
    DOM['error-panel'].classList.add('hidden');
    DOM['progress-bar'].classList.add('hidden');
    DOM['btn-export-pdf'].disabled = true;
    DOM['btn-export-csv'].disabled = true;
    DOM['btn-clear'].disabled = true;
    DOM['file-input'].value = '';
    DOM['folder-input'].value = '';
    DOM['filter-input'].value = '';
    DOM['results-count'].classList.add('hidden');
    DOM['loading-overlay'].classList.add('hidden');

    // Limpiar indicadores de ordenamiento
    document.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('asc', 'desc');
        h.setAttribute('aria-sort', 'none');
    });

    updateFileListUI();
    sessionStorage.removeItem('evaluador_state');
}

// ─── Exportaciones ───
function exportCSV() {
    let csvContent = 'data:text/csv;charset=utf-8,\uFEFF';
    csvContent += 'Estudiante,C1 Ley(5P),C2 Evidencias(7P),C3 RRHH(8P),Nota Final,Conectores,Observaciones\n';
    resultadosEvaluacion.forEach(r => {
        csvContent +=
            '"' + r.estudiante + '",' +
            r.c1 + ',' + r.c2 + ',' + r.c3 + ',' +
            r.notaFinal + ',' + r.conectoresHallados + ',' +
            '"' + r.observacion + '"\n';
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'Reporte_Evaluacion_RRHH.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    const hoy = new Date().toLocaleDateString('es-PE', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    doc.setFontSize(16);
    doc.text('Reporte Consolidado de Evaluación Académica', 14, 15);
    doc.setFontSize(10);
    doc.text('Programa de Gestión Humana y Derecho Laboral | Escala Vigesimal (0-20)', 14, 22);
    doc.text('Generado: ' + hoy, 14, 28);

    const tableData = resultadosEvaluacion.map((r, i) => [
        i + 1,
        r.estudiante,
        r.c1 + '/5',
        r.c2 + '/7',
        r.c3 + '/8',
        r.notaFinal + '/20',
        r.conectoresHallados,
        r.observacion
    ]);

    doc.autoTable({
        startY: 33,
        head: [['#', 'Estudiante', 'C1 (5P)', 'C2 (7P)', 'C3 (8P)', 'Nota', 'Conect.', 'Observaciones de Fortalecimiento']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 119, 182] },
        styles: { fontSize: 7.5 },
        columnStyles: {
            0: { cellWidth: 10 },
            1: { cellWidth: 35 },
            7: { cellWidth: 70 }
        }
    });

    doc.save('Reporte_Consolidado_Evaluaciones.pdf');
}

// ─── Configuración de Eventos ───
function setupEvents() {
    // ── Dropzone ──
    const dz = DOM['drop-zone'];

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evName => {
        dz.addEventListener(evName, function(e) {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    dz.addEventListener('dragover', function() {
        dz.classList.add('dragover');
    });

    dz.addEventListener('dragleave', function(e) {
        // Solo remover si realmente salimos del dropzone (no de un hijo)
        if (!dz.contains(e.relatedTarget)) {
            dz.classList.remove('dragover');
        }
    });

    dz.addEventListener('drop', async function(e) {
        dz.classList.remove('dragover');
        if (isProcessing) return;
        const files = await collectFilesFromDataTransfer(e.dataTransfer);
        if (files.length > 0) {
            await addFilesToList(files);
            processAllFiles();
        }
    });

    // Click en dropzone → abre selector de archivos
    dz.addEventListener('click', function(e) {
        if (e.target === dz || dz.contains(e.target)) {
            DOM['file-input'].click();
        }
    });

    // Teclado: Enter/Espacio en dropzone → abre selector
    dz.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            DOM['file-input'].click();
        }
    });

    // ── Input de archivos ──
    DOM['file-input'].addEventListener('change', async function(e) {
        const files = Array.from(e.target.files);
        e.target.value = ''; // Permite re-seleccionar el mismo archivo
        if (files.length > 0) {
            await addFilesToList(files);
            processAllFiles();
        }
    });

    // ── Input de carpeta ──
    DOM['btn-folder'].addEventListener('click', function() {
        DOM['folder-input'].click();
    });

    DOM['folder-input'].addEventListener('change', async function(e) {
        const files = Array.from(e.target.files);
        e.target.value = '';
        if (files.length > 0) {
            await addFilesToList(files);
            processAllFiles();
        }
    });

    // Detectar soporte de webkitdirectory
    if (typeof DOM['folder-input'].webkitdirectory === 'undefined' || DOM['folder-input'].webkitdirectory === false) {
        DOM['btn-folder'].style.display = 'none';
        DOM['folder-fallback-msg'].classList.remove('hidden');
    }

    // ── Botones ──
    DOM['btn-clear'].addEventListener('click', clearAll);

    DOM['btn-cancel'].addEventListener('click', function() {
        if (abortController) abortController.abort();
        isProcessing = false;
        DOM['loading-overlay'].classList.add('hidden');
        DOM['status-text'].textContent = 'Procesamiento cancelado por el usuario.';
    });

    DOM['btn-dismiss-errors'].addEventListener('click', function() {
        DOM['error-panel'].classList.add('hidden');
        DOM['error-list'].innerHTML = '';
    });

    DOM['btn-export-csv'].addEventListener('click', exportCSV);
    DOM['btn-export-pdf'].addEventListener('click', exportPDF);

    // ── Filtro ──
    DOM['filter-input'].addEventListener('input', function() {
        renderTable(this.value);
    });

    // ── Ordenamiento ──
    setupSortableHeaders();
}

// ─── Inicialización ───
function init() {
    cacheDOM();
    if (!checkDependencies()) {
        // Si faltan dependencias, mostrar error pero no bloquear
        console.error('Faltan dependencias CDN. La aplicación no funcionará correctamente.');
        return;
    }
    configurePDFJS();
    setupEvents();

    // Intentar restaurar estado previo
    if (!loadState()) {
        updateFileListUI();
    }
}

// Arranque seguro: esperar a que el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
