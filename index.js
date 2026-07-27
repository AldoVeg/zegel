/* ============================================================
   index.js — Motor de Evaluación Automatizada con IA Integrada
   Versión Minimalista High-Contrast: Micro-Pills de Estado,
   Formato Ultra-Sintético de Ausencias y Rediseño Gráfico.
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
        alertText.textContent = 'Faltan librerías: ' + missing.join(', ') + '. Verifica tu conexión a internet.';
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

// ─── Estado Global (Nombres Preservados) ───
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

// ─── EXTRACCIÓN DE IDENTIDAD ───
function extractStudentIdentity(fileName, text) {
    if (!text) return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');

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
// MOTOR DE EVALUACIÓN ULTRA-CONCRETO (IA GEMINI)
// ═══════════════════════════════════════════════════════════
async function evaluateContentWithAI(fileName, text) {
    const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;
    const estudiante = extractStudentIdentity(fileName, text);
    
    if (wordCount < 40) {
        return {
            estudiante: estudiante, 
            c1: 0, c1Checks: [false, false, false], 
            c2: 0, c2Checks: [false, false, false], 
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: 'Se emite: Ninguno | Ausenta: Documento completo | Por fortalecer: Lectura de archivo'
        };
    }

    const promptText = `
    Actúa como auditor académico ultra-directo. Evalúa el siguiente texto:

    --- INICIO TEXTO ---
    ${text.substring(0, 16000)}
    --- FIN TEXTO ---

    EVALUACIÓN POR CHECKS GRANULARES:

    C1: NORMATIVA PERÚ (Máx 5 pts)
    - [T1] Beneficios laborales de Ley
    - [T2] Acoso y Hostigamiento Laboral / Sexual
    - [T3] Flexibilidad Horaria para Estudiantes

    C2: CASOS REALES Y EVIDENCIA (Máx 7 pts)
    - [C1] Caso/Noticia Tema 1 (Beneficios)
    - [C2] Caso/Noticia Tema 2 (Acoso)
    - [C3] Caso/Noticia Tema 3 (Flexibilidad)

    C3: ÉTICA Y RESPONSABILIDAD RR.HH. (Máx 8 pts)
    - [E1] Postura ética personal/crítica
    - [E2] Rol explicito de RR.HH.
    - [E3] Propuestas o soluciones concretas

    SINTESIS EXTREMA DE OBSERVACIONES:
    Sé ultraconcreto y usa ESTRICTAMENTE este formato sin agregar introducciones ni explicaciones extra:
    "se emite: [lista breve de lo que si hay], ausenta: [lista de lo que falta], postura por fortalecer: [un aspecto clave de C3 o ética]"

    Responde ÚNICAMENTE con un objeto JSON:
    {
      "c1_puntaje": numero,
      "c1_checks": [booleano_t1, booleano_t2, booleano_t3],
      "c2_puntaje": numero,
      "c2_checks": [booleano_c1, booleano_c2, booleano_c3],
      "c3_puntaje": numero,
      "c3_checks": [booleano_e1, booleano_e2, booleano_e3],
      "bibliografia_valida": booleano,
      "resumen_concreto": "se emite: ..., ausenta: ..., postura por fortalecer: ..."
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

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();
        const aiResponseText = data.candidates[0].content.parts[0].text;
        const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("La IA no devolvió JSON.");
        
        const resIA = JSON.parse(jsonMatch[0]);

        const c1Puntos = Math.min(5, Math.round((resIA.c1_puntaje || 0) * 10) / 10);
        const c2Puntos = Math.min(7, Math.round((resIA.c2_puntaje || 0) * 10) / 10);
        const c3Puntos = Math.min(8, Math.round((resIA.c3_puntaje || 0) * 10) / 10);

        const notaCalculada = c1Puntos + c2Puntos + c3Puntos;
        const notaFinal = Math.min(20, Math.round(notaCalculada * 10) / 10);

        return {
            estudiante: estudiante,
            c1: c1Puntos,
            c1Checks: resIA.c1_checks || [false, false, false],
            c2: c2Puntos,
            c2Checks: resIA.c2_checks || [false, false, false],
            c3: c3Puntos,
            c3Checks: resIA.c3_checks || [false, false, false],
            notaFinal: notaFinal,
            wordCount: wordCount,
            bibliografia: { ok: !!resIA.bibliografia_valida },
            observacion: resIA.resumen_concreto || "se emite: contenido general, ausenta: especificaciones, postura por fortalecer: precisión"
        };

    } catch (error) {
        console.error("Error API:", error);
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: [false, false, false],
            c2: 0, c2Checks: [false, false, false],
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0,
            wordCount: wordCount,
            bibliografia: { ok: false },
            observacion: 'Error en servicio de IA.'
        };
    }
}

// ─── LECTORES DE ARCHIVOS ───
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
        } catch (e) {}
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

// ─── UI Y LISTA DE ARCHIVOS ───
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

// ─── PROCESAMIENTO EN FILA INDIA ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    if(AI_API_KEY === "TU_API_KEY_AQUI" || !AI_API_KEY) {
        alert("Configura tu API Key de Gemini en la variable AI_API_KEY.");
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
            await new Promise(resolve => setTimeout(resolve, 1000));
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

// ─── COMPONENTES VISUALES MINIMALISTAS ───
function renderPill(label, isOk) {
    const bg = isOk ? '#dcfce7' : '#f3f4f6';
    const color = isOk ? '#15803d' : '#9ca3af';
    const border = isOk ? '1px solid #86efac' : '1px solid #e5e7eb';
    return `<span style="display:inline-block; padding:2px 5px; margin:1px; font-size:0.7rem; font-weight:700; border-radius:4px; background:${bg}; color:${color}; border:${border};">${label}</span>`;
}

function renderScoreBadge(score, max) {
    let color = '#ef4444'; 
    let bg = '#fef2f2';
    const pct = score / max;
    if(pct >= 0.7) { color = '#10b981'; bg = '#ecfdf5'; }
    else if(pct >= 0.5) { color = '#f59e0b'; bg = '#fffbeb'; }

    return `<div style="display:inline-block; text-align:center; padding:4px 8px; border-radius:6px; background:${bg}; color:${color}; border:1px solid ${color}33;">
        <span style="font-size:0.95rem; font-weight:800;">${score}</span><span style="font-size:0.75rem; opacity:0.8;">/${max}</span>
    </div>`;
}

function renderFinalBadge(nota) {
    let bg = '#10b981';
    if (nota < 11) bg = '#ef4444';
    else if (nota < 14) bg = '#f59e0b';

    return `<span style="display:inline-block; padding:4px 10px; font-weight:800; font-size:0.85rem; border-radius:20px; color:#ffffff; background:${bg}; box-shadow: 0 2px 4px rgba(0,0,0,0.08);">${nota} / 20</span>`;
}

// ─── RENDERIZADO DE TABLA (ESTILO MINIMALISTA HIGH-CONTRAST) ───
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
        const bibIcon = r.bibliografia && r.bibliografia.ok 
            ? '<span style="color:#10b981; font-weight:700; font-size:0.8rem;">✓ Válida</span>' 
            : '<span style="color:#9ca3af; font-weight:500; font-size:0.8rem;">✕ Ausente</span>';
        
        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]);
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]);
        const c3Pills = renderPill('E1', r.c3Checks[0]) + renderPill('E2', r.c3Checks[1]) + renderPill('E3', r.c3Checks[2]);

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #f3f4f6';
        
        tr.innerHTML =
            `<td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">${idx + 1}</td>` +
            `<td style="font-weight:600; color:#111827; font-size:0.85rem;">${escapeHTML(r.estudiante)}</td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c1, 5)}<br><div style="margin-top:3px;">${c1Pills}</div></td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c2, 7)}<br><div style="margin-top:3px;">${c2Pills}</div></td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c3, 8)}<br><div style="margin-top:3px;">${c3Pills}</div></td>` +
            `<td style="text-align:center;">${renderFinalBadge(r.notaFinal)}</td>` +
            `<td style="text-align:center; font-size:0.8rem; color:#4b5563;">${r.wordCount} words</td>` +
            `<td style="text-align:center;">${bibIcon}</td>` +
            `<td style="font-size:0.8rem; color:#374151; line-height:1.3; padding: 8px;">
                <div style="background:#f9fafb; border-left:3px solid #6366f1; padding:6px 8px; border-radius:0 4px 4px 0;">
                   ${escapeHTML(r.observacion)}
                </div>
            </td>`;
            
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

// ─── EXPORTACIONES ───
function exportCSV() {
    if (resultadosEvaluacion.length === 0) return;
    let csv = 'Estudiante,C1,C2,C3,Nota Final,Palabras,Bibliografia,Resumen Concreto\n';
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

    doc.setFontSize(14);
    doc.text("Reporte de Evaluaciones", 14, 15);
    
    let y = 25;
    doc.setFontSize(9);
    doc.text("#", 14, y);
    doc.text("Estudiante", 25, y);
    doc.text("C1", 85, y);
    doc.text("C2", 105, y);
    doc.text("C3", 125, y);
    doc.text("Nota", 145, y);
    doc.text("Diagnóstico Concreto", 165, y);
    doc.line(14, y + 2, 280, y + 2);

    y += 8;
    resultadosEvaluacion.forEach((r, idx) => {
        if (y > 180) { doc.addPage(); y = 20; }
        doc.text(String(idx + 1), 14, y);
        doc.text(String(r.estudiante).substring(0, 25), 25, y);
        doc.text(String(r.c1), 85, y);
        doc.text(String(r.c2), 105, y);
        doc.text(String(r.c3), 125, y);
        doc.text(String(r.notaFinal), 145, y);
        doc.text(String(r.observacion).substring(0, 55), 165, y);
        y += 7;
    });

    doc.save(`Consolidado_Evaluaciones_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── PERSISTENCIA Y LIMPIEZA ───
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

// ─── EVENT LISTENERS Y INICIALIZACIÓN ───
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
