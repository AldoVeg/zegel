/* ============================================================
   index.js — Motor de Evaluación Heurístico y Determinista
   Evaluación por Presencia / Omisión de Patrones
   Sin dependencias de IA externa, sin latencia y 100% local.
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

const yieldUI = () => new Promise(resolve => setTimeout(resolve, 10));

// ─── Estado Global (Estructura Intacta) ───
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

// ─── EXTRACCIÓN DE NOMBRE DEL ESTUDIANTE ───
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
    const firstLines = lines.slice(0, 5);
    for (const line of firstLines) {
        if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s,]{6,60}$/.test(line) && line.split(/\s+/).length >= 2 && !line.toLowerCase().includes('tema') && !line.toLowerCase().includes('decreto')) {
            return line.trim();
        }
    }

    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE REGLAS Y COINCIDENCIAS LOCALE (DETERMINISTA)
// ═══════════════════════════════════════════════════════════
async function evaluateContentWithAI(fileName, text) {
    const wordCount = text ? text.split(/\s+/).filter(w => w.length > 1).length : 0;
    const estudiante = extractStudentIdentity(fileName, text);
    const lowerText = (text || '').toLowerCase();

    if (wordCount < 40) {
        return {
            estudiante: estudiante, 
            c1: 0, c1Checks: [false, false, false], 
            c2: 0, c2Checks: [false, false, false], 
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: 'se emite: ninguno, ausenta: contenido mínimo procesable, postura por fortalecer: extensión e información general'
        };
    }

    // 1. REGLAS C1: NORMATIVA PERUANA (Máx 5 pts)
    const t1Keywords = ['cts', 'gratificac', 'vacacion', 'asignacion familiar', 'utilidad', 'd.l. 650', 'd.l. 713', 'ley 27735', 'ley 26790', 'sctr', 'd.l. 854', 'beneficios sociales'];
    const t2Keywords = ['acoso', 'hostigamiento', 'ley 27942', 'd.l. 1410', 'd.s. 014-2019-mimp', 'violencia sexual', 'hostigamiento sexual'];
    const t3Keywords = ['flexibilidad', 'horario', 'estudiante', 'ley 28518', 'modalidades formativas', 'd.s. 011-2012-ed', 'jornada'];

    const hasC1_T1 = t1Keywords.some(kw => lowerText.includes(kw));
    const hasC1_T2 = t2Keywords.some(kw => lowerText.includes(kw));
    const hasC1_T3 = t3Keywords.some(kw => lowerText.includes(kw));

    const c1Checks = [hasC1_T1, hasC1_T2, hasC1_T3];
    const c1Count = c1Checks.filter(Boolean).length;
    const c1Puntos = Math.min(5, Math.round((c1Count * (5 / 3)) * 10) / 10);

    // 2. REGLAS C2: CASOS REALES Y EVIDENCIA (Máx 7 pts)
    const caseIndicators = ['caso', 'noticia', 'empresa', 'sunafil', 'sancion', 'multa', 'http', 'https', 'www', 'sentencia', 'denuncia', 'infobae', 'defensoria', 'el peruano'];
    const hasCaseContext = caseIndicators.some(kw => lowerText.includes(kw));

    const hasC2_C1 = hasC1_T1 && hasCaseContext;
    const hasC2_C2 = hasC1_T2 && hasCaseContext;
    const hasC2_C3 = hasC1_T3 && hasCaseContext;

    const c2Checks = [hasC2_C1, hasC2_C2, hasC2_C3];
    const c2Count = c2Checks.filter(Boolean).length;
    const c2Puntos = Math.min(7, Math.round((c2Count * (7 / 3)) * 10) / 10);

    // 3. REGLAS C3: ÉTICA Y ROL DE RR.HH. (Máx 8 pts)
    const e1Keywords = ['etica', 'ético', 'ética', 'critica', 'crítica', 'reflexion', 'reflexión', 'dignidad', 'trato justo', 'opinion', 'opinión', 'considero'];
    const e2Keywords = ['recursos humanos', 'rrhh', 'rr.hh', 'gestion humana', 'gestión humana', 'talento humano', 'departamento de personal'];
    const e3Keywords = ['propuesta', 'solucion', 'solución', 'estrategia', 'plan', 'accion', 'acción', 'medida', 'responsabilidad', 'garante'];

    const hasC3_E1 = e1Keywords.some(kw => lowerText.includes(kw));
    const hasC3_E2 = e2Keywords.some(kw => lowerText.includes(kw));
    const hasC3_E3 = e3Keywords.some(kw => lowerText.includes(kw));

    const c3Checks = [hasC3_E1, hasC3_E2, hasC3_E3];
    const c3Count = c3Checks.filter(Boolean).length;
    const c3Puntos = Math.min(8, Math.round((c3Count * (8 / 3)) * 10) / 10);

    // 4. BIBLIOGRAFÍA
    const bibKeywords = ['bibliografia', 'bibliografía', 'referencia', 'fuente', 'http', 'https', 'recuperado de'];
    const hasBib = bibKeywords.some(kw => lowerText.includes(kw));

    // 5. CÁLCULO DE NOTA FINAL
    const notaFinal = Math.min(20, Math.round((c1Puntos + c2Puntos + c3Puntos) * 10) / 10);

    // 6. GENERACIÓN DEL DIAGNÓSTICO SINTÉTICO
    const emiteArr = [];
    if (hasC1_T1) emiteArr.push('marco normativo T1');
    if (hasC1_T2) emiteArr.push('marco normativo T2');
    if (hasC1_T3) emiteArr.push('marco normativo T3');
    if (hasC2_C1) emiteArr.push('evidencia T1');
    if (hasC2_C2) emiteArr.push('evidencia T2');
    if (hasC2_C3) emiteArr.push('evidencia T3');
    if (hasC3_E1) emiteArr.push('postura ética');
    if (hasC3_E2) emiteArr.push('rol de RR.HH.');

    const ausentaArr = [];
    if (!hasC1_T1) ausentaArr.push('normativa T1');
    if (!hasC1_T2) ausentaArr.push('normativa T2');
    if (!hasC1_T3) ausentaArr.push('normativa T3 (Flexibilidad)');
    if (!hasC2_C1) ausentaArr.push('caso real T1');
    if (!hasC2_C2) ausentaArr.push('caso real T2');
    if (!hasC2_C3) ausentaArr.push('caso real T3');
    if (!hasC3_E1 || !hasC3_E2) ausentaArr.push('reflexión ética integral de RR.HH.');

    let fortalecerStr = 'mantener el estándar de rigor académico';
    if (!hasC1_T3) fortalecerStr = 'completitud en el desarrollo de todos los temas requeridos (T3)';
    else if (!hasC2_C3) fortalecerStr = 'fundamentación de casos reales con enlaces verificables';
    else if (!hasC3_E1) fortalecerStr = 'postura crítica personal sobre el rol de Gestión Humana';

    const emiteStr = emiteArr.length > 0 ? emiteArr.join(', ') : 'conceptos generales';
    const ausentaStr = ausentaArr.length > 0 ? ausentaArr.join(', ') : 'ningún requerimiento obligatorio';

    const observacion = `se emite: ${emiteStr}; ausenta: ${ausentaStr}; postura por fortalecer: ${fortalecerStr}.`;

    return {
        estudiante: estudiante,
        c1: c1Puntos,
        c1Checks: c1Checks,
        c2: c2Puntos,
        c2Checks: c2Checks,
        c3: c3Puntos,
        c3Checks: c3Checks,
        notaFinal: notaFinal,
        wordCount: wordCount,
        bibliografia: { ok: hasBib },
        observacion: observacion
    };
}

// ─── EXTRACTION DE ARCHIVOS ───
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

// ─── PROCESAMIENTO EN LOTE ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

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

// ─── RENDERING DE INSIGNIAS (SOLO SI ES DETECTADO, OMITIDO SI NO) ───
function renderPill(label, isOk) {
    if (!isOk) return ''; // Se omite completamente si no se detecta
    return `<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">${label}</span>`;
}

function renderScoreBadge(score, max) {
    let color = '#ef4444'; 
    let bg = '#fef2f2';
    const pct = score / max;
    if(pct >= 0.7) { color = '#10b981'; bg = '#ecfdf5'; }
    else if(pct >= 0.4) { color = '#f59e0b'; bg = '#fffbeb'; }

    return `<div style="display:inline-block; text-align:center; padding:2px 6px; border-radius:6px; background:${bg}; color:${color}; border:1px solid ${color}33;">
        <span style="font-size:0.85rem; font-weight:800;">${score}</span><span style="font-size:0.65rem; opacity:0.8;">/${max}</span>
    </div>`;
}

function renderFinalBadge(nota) {
    let bg = '#10b981';
    if (nota < 11) bg = '#ef4444';
    else if (nota < 14) bg = '#f59e0b';

    return `<span style="display:inline-block; padding:4px 10px; font-weight:800; font-size:0.85rem; border-radius:20px; color:#ffffff; background:${bg}; shadow: 0 2px 4px rgba(0,0,0,0.08);">${nota} / 20</span>`;
}

// ─── RENDERIZADO DE LA TABLA ───
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
            ? '<span style="color:#10b981; font-weight:700; font-size:0.8rem;">✓ Con Fuentes</span>' 
            : '<span style="color:#9ca3af; font-weight:500; font-size:0.8rem;">—</span>';
        
        // Píldoras: Solo se generan las que son verdaderas; si no, queda vacío o con guion de omisión.
        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        const c3Pills = renderPill('E1', r.c3Checks[0]) + renderPill('E2', r.c3Checks[1]) + renderPill('E3', r.c3Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';

        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #f3f4f6';
        
        tr.innerHTML =
            `<td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">${idx + 1}</td>` +
            `<td style="font-weight:600; color:#111827; font-size:0.85rem;">${escapeHTML(r.estudiante)}</td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c1, 5)}<br><div style="margin-top:3px;">${c1Pills}</div></td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c2, 7)}<br><div style="margin-top:3px;">${c2Pills}</div></td>` +
            `<td style="text-align:center; padding: 6px;">${renderScoreBadge(r.c3, 8)}<br><div style="margin-top:3px;">${c3Pills}</div></td>` +
            `<td style="text-align:center;">${renderFinalBadge(r.notaFinal)}</td>` +
            `<td style="text-align:center; font-size:0.8rem; color:#4b5563;">${r.wordCount} pal.</td>` +
            `<td style="text-align:center;">${bibIcon}</td>` +
            `<td style="font-size:0.8rem; color:#374151; line-height:1.35; padding: 8px;">
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
    doc.text("Reporte de Evaluaciones Académicas", 14, 15);
    
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

// ─── EVENT LISTENERS ───
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
