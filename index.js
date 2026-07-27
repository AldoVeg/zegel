/* ============================================================
   index.js — Motor de Evaluación Automatizada con IA Integrada
   C1: Normativa - T1(Beneficios), T2(Acoso), T3(Flexibilidad)
   C2: Evidencia - Casos/Noticias de T1, T2 y T3
   C3: Reflexión - Ética, Rol RRHH, Acciones estratégicas
   Procesamiento secuencial (Fila India) y limpieza de RAM
   ============================================================ */

// ─── CONFIGURACIÓN DE LA IA (API) ───
// ¡IMPORTANTE!: Coloca aquí tu clave de API real generada en Google AI Studio
const AI_API_KEY = "TU_API_KEY_AQUI";
const AI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${AI_API_KEY}`;

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
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ') + '. Verifica tu conexión a internet y recarga la página.';
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

// ─── Micro-pausa para forzar redibujado de UI y liberar RAM ───
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

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
    const ids = ['drop-zone', 'file-input', 'folder-input', 'btn-folder', 'folder-fallback-msg', 'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip', 'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count', 'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 'btn-cancel', 'cdn-alert', 'cdn-alert-text', 'btn-process'];
    ids.forEach(id => { 
        const el = document.getElementById(id);
        if(el) DOM[id] = el; 
    });
}

function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function formatFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
function getFileTypeIcon(type) { if (type === 'pdf') return '📄'; if (type === 'docx') return '📝'; if (type === 'zip') return '📦'; return '📎'; }
function detectFileType(file) { const name = file.name.toLowerCase(); if (name.endsWith('.pdf')) return 'pdf'; if (name.endsWith('.docx')) return 'docx'; if (name.endsWith('.zip')) return 'zip'; return 'other'; }

// ─── Extracción de Identidad del Estudiante ───
function extractStudentIdentity(fileName, text) {
    const patrones = [
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*:\s*([^\n]{3,60})/i,
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*[:\-]\s*([^\n]{3,60})/i
    ];
    for (const p of patrones) {
        const match = text.match(p);
        if (match && match[1] && match[1].trim().length > 2) {
            return match[1].trim().replace(/\s+/g, ' ');
        }
    }
    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN SEMÁNTICO (VÍA IA)
// ═══════════════════════════════════════════════════════════

/**
 * Evaluación asistida por IA con salida en JSON estricto
 */
async function evaluateContentWithAI(fileName, text) {
    const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;
    const estudiante = extractStudentIdentity(fileName, text);
    
    // Validar extensión base antes de gastar recursos de API
    if (wordCount < 100) {
        return {
            estudiante: estudiante, c1: 0, c1Checks: '❌ ❌ ❌', c2: 0, c2Checks: '❌ ❌ ❌', c3: 0, c3Checks: '❌ ❌ ❌',
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: '⚠️ Texto demasiado corto o ilegible para evaluar adecuadamente.'
        };
    }

    const promptText = `
    Actúa como un docente evaluador universitario riguroso. Audita el siguiente texto académico (ensayo/informe) presentado por un estudiante:

    --- INICIO DEL TEXTO ---
    ${text.substring(0, 15000)}
    --- FIN DEL TEXTO ---

    EVALÚA ESTRICTAMENTE LOS SIGUIENTES 3 CRITERIOS.

    C1: NORMATIVA PERÚ (Máximo 5 puntos)
    - Tema 1: Beneficios laborales de Ley (¿Desarrolla con sustento normativo peruano?)
    - Tema 2: Acoso y Hostigamiento Laboral / Sexual (¿Desarrolla con sustento normativo peruano?)
    - Tema 3: Flexibilidad Horaria para Estudiantes (¿Desarrolla con sustento normativo peruano?)
    Puntuación C1: 1.5 pts por cada tema con sustento normativo verificado. Otorga un plus de 0.5 pts solo si los 3 temas están desarrollados y citan explícitamente leyes o decretos peruanos reales.

    C2: CASOS REALES Y EVIDENCIA (Máximo 7 puntos)
    - Caso Tema 1: ¿Presenta ejemplo o noticia real peruana sobre vulneración de Beneficios?
    - Caso Tema 2: ¿Presenta ejemplo o noticia real peruana sobre vulneración de Acoso/Hostigamiento?
    - Caso Tema 3: ¿Presenta ejemplo o noticia real peruana sobre vulneración de Flexibilidad?
    Puntuación C2: 2.0 pts por cada caso real. Otorga un plus de 1.0 pt solo si los casos incluyen enlaces URL verificables.

    C3: ÉTICA Y RESPONSABILIDAD PROFESIONAL EN RR.HH. (Máximo 8 puntos)
    - Check 1: ¿Expone una postura ética personal, crítica y clara en las conclusiones? (Hasta 2.5 pts)
    - Check 2: ¿Define claramente el rol estratégico y la responsabilidad del profesional de RR.HH.? (Hasta 2.5 pts)
    - Check 3: ¿Propone acciones o estrategias concretas de prevención/mejora frente a la responsabilidad profesional? (Hasta 3.0 pts)

    BIBLIOGRAFÍA:
    - ¿El texto cuenta con una sección de bibliografía con enlaces válidos?

    Responde ÚNICAMENTE con un objeto JSON válido, sin bloques de código markdown (\`\`\`), con esta estructura exacta:
    {
      "c1_puntaje": numero,
      "c1_checks": [booleano_tema1, booleano_tema2, booleano_tema3],
      "c2_puntaje": numero,
      "c2_checks": [booleano_caso1, booleano_caso2, booleano_caso3],
      "c3_puntaje": numero,
      "c3_checks": [booleano_etica, booleano_rrhh, booleano_acciones],
      "bibliografia_valida": booleano,
      "observaciones": "Resumen conciso en una frase sobre las deficiencias o fortalezas encontradas."
    }
    `;

    try {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.1 } // Baja temperatura para análisis estricto
            })
        });

        if (!response.ok) {
            throw new Error(`Error en API HTTP: ${response.status}`);
        }

        const data = await response.json();
        
        // Limpiar posible formato Markdown residual si la IA no respetó el formato estricto
        let aiResponseText = data.candidates[0].content.parts[0].text;
        aiResponseText = aiResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        const resIA = JSON.parse(aiResponseText);

        // Convertir booleanos a palomitas visuales
        const checksC1 = resIA.c1_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC2 = resIA.c2_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC3 = resIA.c3_checks.map(v => v ? '✅' : '❌').join(' ');

        const notaFinal = Math.round((resIA.c1_puntaje + resIA.c2_puntaje + resIA.c3_puntaje) * 10) / 10;

        return {
            estudiante: estudiante,
            c1: resIA.c1_puntaje,
            c1Checks: checksC1,
            c2: resIA.c2_puntaje,
            c2Checks: checksC2,
            c3: resIA.c3_puntaje,
            c3Checks: checksC3,
            notaFinal: notaFinal,
            wordCount: wordCount,
            bibliografia: { ok: resIA.bibliografia_valida },
            observacion: resIA.observaciones
        };

    } catch (error) {
        console.error("Error al evaluar con la IA en archivo:", fileName, error);
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: '⚠️ ⚠️ ⚠️',
            c2: 0, c2Checks: '⚠️ ⚠️ ⚠️',
            c3: 0, c3Checks: '⚠️ ⚠️ ⚠️',
            notaFinal: 0,
            wordCount: wordCount,
            bibliografia: { ok: false },
            observacion: '❌ Error de comunicación con la API de Evaluación IA. Verifica tu API Key o conexión.'
        };
    }
}

// ─── LECTORES (PDF/DOCX/ZIP) OPTIMIZADOS PARA RAM ───
async function extractTextFromPDF(file) {
    let arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + ' ';
        page.cleanup();

        if (DOM['status-text']) {
            DOM['status-text'].innerHTML =
                '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
                '<span>Leyendo PDF: <strong>' + file.name.substring(0, 25) + '...</strong></span>' +
                '<span>Página ' + i + ' de ' + pdf.numPages + '</span>' +
                '<progress value="' + i + '" max="' + pdf.numPages + '" style="width:100%;height:6px;border-radius:3px;"></progress>' +
                '</div>';
        }
        await yieldUI();
    }
    await loadingTask.destroy();
    arrayBuffer = null;
    return fullText; // Retornamos texto original para que la IA lea mayúsculas/minúsculas correctas
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    if (DOM['status-text']) {
        DOM['status-text'].innerHTML = 'Extrayendo DOCX: <strong>' + file.name.substring(0, 25) + '...</strong>';
    }
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    let text = result.value;
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
            let file = new File([blob], zipEntry.name.split('/').pop(), {
                type: lower.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
            extracted.push({ name: file.name, type: lower.endsWith('.pdf') ? 'pdf' : 'docx', file: file, size: blob.size });
            blob = null;
        }
        if (i % 3 === 0) await yieldUI();
    }
    return extracted;
}

// ─── UI DE ARCHIVOS E INTERACCIÓN ───
function updateFileListUI() {
    const listEl = DOM['file-list-items'];
    const fileList = DOM['file-list'];
    if (!listEl || !fileList) return;
    
    listEl.innerHTML = '';
    if (archivosDetectados.length === 0) {
        fileList.classList.add('hidden');
        if (DOM['status-text']) DOM['status-text'].innerHTML = 'Esperando archivos...';
        return;
    }
    fileList.classList.remove('hidden');
    if (DOM['file-count']) DOM['file-count'].textContent = archivosDetectados.length;
    if (DOM['status-text']) DOM['status-text'].innerHTML = archivosDetectados.length + ' archivo(s) listos para evaluar.';

    let cPDF = 0, cDOCX = 0, cZIP = 0;
    archivosDetectados.forEach(f => {
        if (f.type === 'pdf') cPDF++;
        else if (f.type === 'docx') cDOCX++;
        else if (f.type === 'zip') cZIP++;
    });
    const ts = (el, c) => {
        if (c > 0) { el.classList.remove('hidden'); el.textContent = el.textContent.replace(/\d+/, c); }
        else el.classList.add('hidden');
    };
    if (DOM['stat-pdf']) ts(DOM['stat-pdf'], cPDF);
    if (DOM['stat-docx']) ts(DOM['stat-docx'], cDOCX);
    if (DOM['stat-zip']) ts(DOM['stat-zip'], cZIP);

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        chip.innerHTML =
            '<span class="chip-icon">' + getFileTypeIcon(f.type) + '</span> ' +
            '<span title="' + escapeHTML(f.name) + '">' + escapeHTML(f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name) + '</span> ' +
            '<button class="chip-remove" data-index="' + i + '">&times;</button>';
        listEl.appendChild(chip);
    });
    listEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (isProcessing) return;
            archivosDetectados.splice(parseInt(btn.dataset.index), 1);
            updateFileListUI();
        });
    });
}

function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
            added++;
        }
    }
    if (added > 0) updateFileListUI();
}

function addError(archivo, mensaje) {
    if(!DOM['error-panel']) return;
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = '[' + archivo + '] ' + mensaje;
    DOM['error-list'].appendChild(li);
}

// ─── PROCESAMIENTO ESTRICTO EN FILA INDIA CON LLAMADA A IA ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    // Validación temprana de API KEY
    if(AI_API_KEY === "TU_API_KEY_AQUI") {
        addError("SISTEMA", "Debes colocar tu API KEY en la línea 14 de index.js antes de evaluar.");
        return;
    }

    isProcessing = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    resultadosEvaluacion = [];
    if (DOM['table-body']) DOM['table-body'].innerHTML = '';
    
    if (DOM['error-list']) DOM['error-list'].innerHTML = '';
    if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
    if (DOM['progress-bar']) { DOM['progress-bar'].classList.remove('hidden'); DOM['progress-bar'].value = 0; }
    if (DOM['loading-overlay']) DOM['loading-overlay'].classList.remove('hidden');

    try {
        let cola = archivosDetectados.slice();
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;

            let item = cola.shift();

            if (item.type === 'zip') {
                if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Extrayendo ZIP: ' + item.name + '...';
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    for (let e = extracted.length - 1; e >= 0; e--) cola.unshift(extracted[e]);
                    total += extracted.length - 1;
                } catch (e) { addError(item.name, 'Error ZIP: ' + e.message); }
                item.file = null; item = null;
                continue;
            }

            procesados++;
            
            // Reflejar avance en la UI
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Procesando ' + procesados + ' de ' + total;
            if (DOM['overlay-progress']) DOM['overlay-progress'].value = Math.round((procesados / total) * 100);
            if (DOM['overlay-percent']) DOM['overlay-percent'].textContent = Math.round((procesados / total) * 100) + '%';
            if (DOM['progress-bar']) DOM['progress-bar'].value = Math.round((procesados / total) * 100);

            try {
                let text = '';
                if (item.type === 'pdf') text = await extractTextFromPDF(item.file);
                else if (item.type === 'docx') text = await extractTextFromDOCX(item.file);

                if (!text || text.trim().length < 50) {
                    addError(item.name, 'Documento vacío o ilegible.');
                } else {
                    if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'IA Evaluando: ' + item.name + '...';
                    
                    // Esperamos a que la IA evalúe el documento
                    const resultado = await evaluateContentWithAI(item.name, text);
                    resultadosEvaluacion.push(resultado);
                }
                text = null; // Limpiar RAM
            } catch (err) {
                addError(item.name, 'Error: ' + err.message);
            }

            item.file = null; item = null;
            await yieldUI();
            
            // Pequeña pausa para no saturar los límites de peticiones (Rate Limit) de la API
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } finally {
        isProcessing = false;
        if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');
        if (DOM['progress-bar']) DOM['progress-bar'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            if (DOM['status-text']) DOM['status-text'].textContent = '¡Completado! Evaluados ' + resultadosEvaluacion.length + ' archivos.';
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            renderTable();
            saveState();
        } else {
            if (DOM['status-text']) DOM['status-text'].textContent = 'No hubo archivos válidos o el proceso fue cancelado.';
        }
    }
}

// ─── TABLA DE RESULTADOS CON LOS CHECKS VINCULADOS ───
function renderTable(fText) {
    fText = fText || '';
    const tbody = DOM['table-body'];
    if (!tbody) return;
    
    tbody.innerHTML = '';
    let sorted = resultadosEvaluacion.slice();
    if (sortColumn) {
        sorted.sort((a, b) => {
            let vA = a[sortColumn], vB = b[sortColumn];
            if (typeof vA === 'string') vA = vA.toLowerCase();
            if (typeof vB === 'string') vB = vB.toLowerCase();
            if (vA < vB) return sortDirection === 'asc' ? -1 : 1;
            if (vA > vB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    let fil = fText ? sorted.filter(r => r.estudiante.toLowerCase().includes(fText.toLowerCase())) : sorted;
    if (fil.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos.</td></tr>';
        if(DOM['results-count']) DOM['results-count'].classList.add('hidden');
        return;
    }
    if (DOM['results-count']) {
        DOM['results-count'].classList.remove('hidden');
        DOM['results-count'].textContent = 'Mostrando ' + fil.length + ' de ' + resultadosEvaluacion.length;
    }
    
    fil.forEach(r => {
        const idx = resultadosEvaluacion.indexOf(r) + 1;
        const badgeClass = r.notaFinal >= 14 ? 'badge-success' : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const bibIcon = r.bibliografia && r.bibliografia.ok ? '✅' : '❌';
        
        const tr = document.createElement('tr');
        // Aquí se inyectan los Checks visuales (✅/❌) traídos directamente de la API de IA.
        tr.innerHTML =
            '<td>' + idx + '</td>' +
            '<td><strong>' + escapeHTML(r.estudiante) + '</strong></td>' +
            '<td style="text-align:center;">' + r.c1 + ' / 5<br><span style="font-size:0.9rem; letter-spacing: 2px;">' + r.c1Checks + '</span></td>' +
            '<td style="text-align:center;">' + r.c2 + ' / 7<br><span style="font-size:0.9rem; letter-spacing: 2px;">' + r.c2Checks + '</span></td>' +
            '<td style="text-align:center;">' + r.c3 + ' / 8<br><span style="font-size:0.9rem; letter-spacing: 2px;">' + r.c3Checks + '</span></td>' +
            '<td><span class="badge ' + badgeClass + '">' + r.notaFinal + '</span></td>' +
            '<td>' + r.wordCount + ' palabras</td>' +
            '<td>' + bibIcon + '</td>' +
            '<td style="font-size:0.82rem;">' + escapeHTML(r.observacion) + '</td>';
        tbody.appendChild(tr);
    });
}

function setupSortableHeaders() {
    const headers = document.querySelectorAll('.results-table th.sortable');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortColumn === col) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            else { sortColumn = col; sortDirection = 'asc'; }
            headers.forEach(h => h.classList.remove('asc', 'desc'));
            th.classList.add(sortDirection);
            renderTable(DOM['filter-input'] ? DOM['filter-input'].value : '');
        });
    });
}

// ─── PERSISTENCIA Y LIMPIEZA DE SESIÓN ───
function saveState() {
    try {
        const state = {
            resultados: resultadosEvaluacion,
            archivos: archivosDetectados.map(f => ({ name: f.name, type: f.type, size: f.size }))
        };
        sessionStorage.setItem('evaluador_state', JSON.stringify(state));
    } catch (e) { /* storage lleno, ignorar */ }
}

function loadState() {
    try {
        const raw = sessionStorage.getItem('evaluador_state');
        if (!raw) return;
        const state = JSON.parse(raw);
        if (state.resultados && state.resultados.length > 0) {
            resultadosEvaluacion = state.resultados;
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            renderTable();
            if (DOM['status-text']) DOM['status-text'].textContent = 'Sesión restaurada: ' + resultadosEvaluacion.length + ' evaluaciones previas.';
        }
    } catch (e) {}
}

function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    
    if (DOM['table-body']) DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg">Sube archivos para iniciar la evaluación.</td></tr>';
    if (DOM['error-list']) DOM['error-list'].innerHTML = '';
    if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
    if (DOM['progress-bar']) DOM['progress-bar'].classList.add('hidden');
    if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = true;
    if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = true;
    if (DOM['btn-clear']) DOM['btn-clear'].disabled = true;
    if (DOM['file-input']) DOM['file-input'].value = '';
    if (DOM['folder-input']) DOM['folder-input'].value = '';
    if (DOM['filter-input']) DOM['filter-input'].value = '';
    if (DOM['results-count']) DOM['results-count'].classList.add('hidden');
    
    updateFileListUI();
    sessionStorage.removeItem('evaluador_state');
}

// ─── INICIALIZACIÓN Y EVENTOS DEL DOM ───
document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    checkDependencies();
    configurePDFJS();
    setupSortableHeaders();
    loadState();

    const dropZone = DOM['drop-zone'];
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false));
        ['dragenter', 'dragover'].forEach(evt => dropZone.addEventListener(evt, () => dropZone.classList.add('dragover'), false));
        ['dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, () => dropZone.classList.remove('dragover'), false));
        dropZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFilesToList(e.dataTransfer.files); });
    }

    if (DOM['file-input']) DOM['file-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['folder-input']) DOM['folder-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['btn-folder']) DOM['btn-folder'].addEventListener('click', () => { if (DOM['folder-input']) DOM['folder-input'].click(); });

    if (DOM['btn-process']) DOM['btn-process'].addEventListener('click', processAllFiles);
    if (DOM['btn-clear']) DOM['btn-clear'].addEventListener('click', clearAll);
    if (DOM['btn-cancel']) DOM['btn-cancel'].addEventListener('click', () => { if (abortController) abortController.abort(); });
    if (DOM['btn-dismiss-errors']) DOM['btn-dismiss-errors'].addEventListener('click', () => { if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden'); });

    if (DOM['filter-input']) DOM['filter-input'].addEventListener('input', function() { renderTable(this.value); });
});
