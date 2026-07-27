/* ============================================================
   index.js — Motor de Evaluación Automatizada con IA Integrada
   Versión Fortalecida: Parseo Seguro de JSON, Eventos Completos,
   Exportaciones (PDF/CSV) y Resiliencia en Fila India.
   ============================================================ */

// ─── CONFIGURACIÓN DE LA IA (API) ───
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
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ') + '. Verifica tu conexión a internet y recarga.';
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

const yieldUI = () => new Promise(resolve => setTimeout(resolve, 20));

// ─── Estado Global (Nombres Estrictamente Preservados) ───
let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let sortColumn = null;
let sortDirection = 'asc';
let isProcessing = false;

// ─── Referencias al DOM ───
const DOM = {};
function cacheDOM() {
    const ids = ['drop-zone', 'file-input', 'folder-input', 'btn-folder', 'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip', 'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count', 'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 'btn-cancel', 'cdn-alert', 'cdn-alert-text', 'btn-process'];
    ids.forEach(id => { 
        const el = document.getElementById(id);
        if(el) DOM[id] = el; 
    });
}

function escapeHTML(str) { if(!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function getFileTypeIcon(type) { if (type === 'pdf') return '📄'; if (type === 'docx') return '📝'; if (type === 'zip') return '📦'; return '📎'; }
function detectFileType(file) { const name = file.name.toLowerCase(); if (name.endsWith('.pdf')) return 'pdf'; if (name.endsWith('.docx')) return 'docx'; if (name.endsWith('.zip')) return 'zip'; return 'other'; }

// ─── EXTRACCIÓN AVANZADA DE IDENTIDAD ───
function extractStudentIdentity(fileName, text) {
    if (!text) return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');

    // Patrones de búsqueda directa en el texto
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

    // Búsqueda en el pie del documento (Nombre, Código/DNI)
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const tailLines = lines.slice(-6);

    for (const line of tailLines) {
        const matchFinal = line.match(/^([A-ZÁÉÍÓÚÑa-záéíóúñ\s]{5,50})(?:,\s*|\s+)([A-Z0-9]{5,12})$/i);
        if (matchFinal) {
            return matchFinal[1].trim() + ' (' + matchFinal[2].trim() + ')';
        }
        if (/^[A-ZÁÉÍÓÚÑ\s]{6,60}$/.test(line) && line.split(/\s+/).length >= 2) {
            return line.trim();
        }
    }

    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN SEMÁNTICO ROBUTO (IA GEMINI)
// ═══════════════════════════════════════════════════════════
async function evaluateContentWithAI(fileName, text) {
    const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;
    const estudiante = extractStudentIdentity(fileName, text);
    
    if (wordCount < 40) {
        return {
            estudiante: estudiante, c1: 0, c1Checks: '❌ ❌ ❌', c2: 0, c2Checks: '❌ ❌ ❌', c3: 0, c3Checks: '❌ ❌ ❌',
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: '⚠️ Documento con texto insuficiente o ilegible.'
        };
    }

    const promptText = `
    Actúa como un docente universitario riguroso evaluando un trabajo académico.
    
    --- INICIO DEL TEXTO DEL ESTUDIANTE ---
    ${text.substring(0, 16000)}
    --- FIN DEL TEXTO ---

    INSTRUCCIONES DE EVALUACIÓN:

    C1: NORMATIVA PERÚ (Máximo 5 puntos)
    - Tema 1: Beneficios laborales de Ley (¿Sustento normativo peruano?)
    - Tema 2: Acoso y Hostigamiento Laboral / Sexual (¿Sustento normativo peruano?)
    - Tema 3: Flexibilidad Horaria para Estudiantes (¿Sustento normativo peruano?)
    * Otorga 1.5 pts por cada tema verificado. Plus de 0.5 solo si los 3 temas citan normas reales. Max 5 pts. Si falta un tema, asigna false y 0 en ese rubro.

    C2: CASOS REALES Y EVIDENCIA (Máximo 7 puntos)
    - Caso Tema 1: ¿Noticia/caso real peruano sobre Beneficios?
    - Caso Tema 2: ¿Noticia/caso real peruano sobre Acoso/Hostigamiento?
    - Caso Tema 3: ¿Noticia/caso real peruano sobre Flexibilidad Horaria?
    * Otorga 2.0 pts por cada caso real argumentado. Plus de 1.0 pt si presenta enlace URL directo. Max 7 pts.

    C3: ÉTICA Y RESPONSABILIDAD PROFESIONAL EN RR.HH. (Máximo 8 puntos)
    - Check 1: Postura ética personal y crítica en las reflexiones (Hasta 2.5 pts)
    - Check 2: Definición explícita del rol/responsabilidad de RR.HH. (Hasta 2.5 pts)
    - Check 3: Propuesta de acciones o estrategias concretas (Hasta 3.0 pts)

    BIBLIOGRAFÍA:
    - ¿Incluye sección bibliográfica con enlaces o referencias al final? (true/false)

    Responde ESTRICTAMENTE con un objeto JSON sin formato markdown extra:
    {
      "c1_puntaje": numero,
      "c1_checks": [booleano, booleano, booleano],
      "c2_puntaje": numero,
      "c2_checks": [booleano, booleano, booleano],
      "c3_puntaje": numero,
      "c3_checks": [booleano, booleano, booleano],
      "bibliografia_valida": booleano,
      "observaciones": "Resumen claro de debilidades (ej: Omitió Tema 2 sobre Acoso Laboral)."
    }
    `;

    try {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
            })
        });

        if (!response.ok) throw new Error(`Error API HTTP: ${response.status}`);

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            throw new Error("Respuesta de la IA bloqueada o no válida.");
        }

        let aiResponseText = data.candidates[0].content.parts[0].text;
        
        // Extracción segura mediante Expresión Regular para evitar fallos si la IA incluye caracteres de formato
        const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("La IA no devolvió la estructura JSON requerida.");
        
        const resIA = JSON.parse(jsonMatch[0]);

        const checksC1 = resIA.c1_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC2 = resIA.c2_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC3 = resIA.c3_checks.map(v => v ? '✅' : '❌').join(' ');

        const notaCalculada = (resIA.c1_puntaje || 0) + (resIA.c2_puntaje || 0) + (resIA.c3_puntaje || 0);
        const notaFinal = Math.min(20, Math.round(notaCalculada * 10) / 10);

        return {
            estudiante: estudiante,
            c1: resIA.c1_puntaje || 0,
            c1Checks: checksC1,
            c2: resIA.c2_puntaje || 0,
            c2Checks: checksC2,
            c3: resIA.c3_puntaje || 0,
            c3Checks: checksC3,
            notaFinal: notaFinal,
            wordCount: wordCount,
            bibliografia: { ok: !!resIA.bibliografia_valida },
            observacion: resIA.observaciones || "Sin observaciones adicionales."
        };

    } catch (error) {
        console.error("Error evaluando con la IA:", error);
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: '❌ ❌ ❌',
            c2: 0, c2Checks: '❌ ❌ ❌',
            c3: 0, c3Checks: '❌ ❌ ❌',
            notaFinal: 0,
            wordCount: wordCount,
            bibliografia: { ok: false },
            observacion: '❌ Error en la API de Evaluación. Verifica tu conexión o clave de API.'
        };
    }
}

// ─── LECTORES PROTEGIDOS (PDF/DOCX/ZIP) ───
async function extractTextFromPDF(file) {
    let arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ') + '\n';
            page.cleanup();
        } catch (pageErr) {
            console.warn(`Página ${i} de ${file.name} omitida por lectura parcial.`);
        }
        await yieldUI();
    }
    await loadingTask.destroy();
    return fullText;
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value || '';
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
        }
    }
    return extracted;
}

// ─── GESTIÓN DE INTERFAZ Y ARCHIVOS ───
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
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
        }
    }
    updateFileListUI();
}

function addError(archivo, mensaje) {
    if(!DOM['error-panel']) return;
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = '[' + archivo + '] ' + mensaje;
    DOM['error-list'].appendChild(li);
}

// ─── PROCESAMIENTO EN FILA INDIA (SINCRONIZADO) ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    if(AI_API_KEY === "TU_API_KEY_AQUI" || !AI_API_KEY) {
        alert("Por favor ingresa tu clave API Key de Gemini en la variable AI_API_KEY.");
        return;
    }

    isProcessing = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    resultadosEvaluacion = [];
    if (DOM['table-body']) DOM['table-body'].innerHTML = '';
    if (DOM['loading-overlay']) DOM['loading-overlay'].classList.remove('hidden');

    try {
        let cola = archivosDetectados.slice();
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;

            let item = cola.shift();

            if (item.type === 'zip') {
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    for (let e = extracted.length - 1; e >= 0; e--) cola.unshift(extracted[e]);
                    total += extracted.length;
                } catch (e) { addError(item.name, 'Error ZIP: ' + e.message); }
                procesados++;
                continue;
            }

            procesados++;
            const pct = Math.round((procesados / total) * 100);
            
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Evaluando (' + procesados + '/' + total + '): ' + item.name;
            if (DOM['overlay-progress']) DOM['overlay-progress'].value = pct;
            if (DOM['overlay-percent']) DOM['overlay-percent'].textContent = pct + '%';

            try {
                let text = '';
                if (item.type === 'pdf') text = await extractTextFromPDF(item.file);
                else if (item.type === 'docx') text = await extractTextFromDOCX(item.file);

                const resultado = await evaluateContentWithAI(item.name, text);
                resultadosEvaluacion.push(resultado);

            } catch (err) {
                addError(item.name, 'Error al procesar: ' + err.message);
            }

            await yieldUI();
            await new Promise(resolve => setTimeout(resolve, 1200)); // Pausa para estabilidad de la API
        }
    } finally {
        isProcessing = false;
        if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            renderTable();
            saveState();
        }
    }
}

// ─── RENDERIZADO Y ORDENAMIENTO DE TABLA ───
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
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos de evaluación.</td></tr>';
        if(DOM['results-count']) DOM['results-count'].classList.add('hidden');
        return;
    }

    if (DOM['results-count']) {
        DOM['results-count'].classList.remove('hidden');
        DOM['results-count'].textContent = 'Mostrando ' + fil.length + ' de ' + resultadosEvaluacion.length;
    }
    
    fil.forEach((r, idx) => {
        const badgeClass = r.notaFinal >= 14 ? 'badge-success' : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const bibIcon = r.bibliografia && r.bibliografia.ok ? '✅ Válida' : '❌ Ausente';
        
        const tr = document.createElement('tr');
        
        tr.innerHTML =
            `<td>${idx + 1}</td>` +
            `<td><strong>${escapeHTML(r.estudiante)}</strong></td>` +
            `<td style="text-align:center;">${r.c1} / 5<br><span style="font-size:1.0rem; letter-spacing: 2px;">${r.c1Checks}</span></td>` +
            `<td style="text-align:center;">${r.c2} / 7<br><span style="font-size:1.0rem; letter-spacing: 2px;">${r.c2Checks}</span></td>` +
            `<td style="text-align:center;">${r.c3} / 8<br><span style="font-size:1.0rem; letter-spacing: 2px;">${r.c3Checks}</span></td>` +
            `<td style="text-align:center;"><span class="badge ${badgeClass}">${r.notaFinal} / 20</span></td>` +
            `<td style="text-align:center;">${r.wordCount} palabras</td>` +
            `<td style="text-align:center;">${bibIcon}</td>` +
            `<td style="font-size:0.85rem; color: #333;">${escapeHTML(r.observacion)}</td>`;
            
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

// ─── EXPORTACIONES (CSV Y PDF) ───
function exportCSV() {
    if (resultadosEvaluacion.length === 0) return;
    let csv = 'Estudiante,C1 Normativa,C2 Evidencia,C3 Etica,Nota Final,Palabras,Bibliografia,Observaciones\n';
    resultadosEvaluacion.forEach(r => {
        csv += `"${r.estudiante}",${r.c1},${r.c2},${r.c3},${r.notaFinal},${r.wordCount},"${r.bibliografia.ok ? 'SI' : 'NO'}","${r.observacion.replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Consolidado_Evaluaciones_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

function exportPDF() {
    if (resultadosEvaluacion.length === 0 || typeof window.jspdf === 'undefined') return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');

    doc.setFontSize(16);
    doc.text("Consolidado de Evaluaciones Académicas", 14, 15);
    
    let y = 25;
    doc.setFontSize(10);
    doc.text("#", 14, y);
    doc.text("Estudiante", 25, y);
    doc.text("C1 (5P)", 85, y);
    doc.text("C2 (7P)", 110, y);
    doc.text("C3 (8P)", 135, y);
    doc.text("Nota", 160, y);
    doc.text("Observación", 185, y);
    doc.line(14, y + 2, 280, y + 2);

    y += 8;
    resultadosEvaluacion.forEach((r, idx) => {
        if (y > 180) { doc.addPage(); y = 20; }
        doc.text(String(idx + 1), 14, y);
        doc.text(String(r.estudiante).substring(0, 30), 25, y);
        doc.text(String(r.c1), 85, y);
        doc.text(String(r.c2), 110, y);
        doc.text(String(r.c3), 135, y);
        doc.text(String(r.notaFinal), 160, y);
        doc.text(String(r.observacion).substring(0, 50), 185, y);
        y += 7;
    });

    doc.save(`Consolidado_Evaluaciones_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── PERSISTENCIA Y LIMPIEZA DE SESIÓN ───
function saveState() {
    try {
        const state = { resultados: resultadosEvaluacion };
        sessionStorage.setItem('evaluador_state', JSON.stringify(state));
    } catch (e) {}
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

// ─── INICIALIZACIÓN COMPLETA DE EVENTOS ───
document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    checkDependencies();
    configurePDFJS();
    setupSortableHeaders();
    loadState();

    const dropZone = DOM['drop-zone'];
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false));
        dropZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFilesToList(e.dataTransfer.files); });
    }

    if (DOM['file-input']) DOM['file-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['folder-input']) DOM['folder-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['btn-folder']) DOM['btn-folder'].addEventListener('click', () => { if (DOM['folder-input']) DOM['folder-input'].click(); });
    
    if (DOM['btn-process']) DOM['btn-process'].addEventListener('click', processAllFiles);
    if (DOM['btn-clear']) DOM['btn-clear'].addEventListener('click', clearAll);
    if (DOM['btn-cancel']) DOM['btn-cancel'].addEventListener('click', () => { if (abortController) abortController.abort(); });
    if (DOM['btn-export-csv']) DOM['btn-export-csv'].addEventListener('click', exportCSV);
    if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].addEventListener('click', exportPDF);
    if (DOM['btn-dismiss-errors']) DOM['btn-dismiss-errors'].addEventListener('click', () => { if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden'); });
    if (DOM['filter-input']) DOM['filter-input'].addEventListener('input', function() { renderTable(this.value); });
});
