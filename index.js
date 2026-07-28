/* ============================================================
   index.js — Motor de Evaluación Heurístico Determinista
   Evaluación Automática al Cargar / Soltar Archivos
   Insignias Visibles Únicamente cuando son Detectadas
   ============================================================ */

let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let sortColumn = null;
let sortDirection = 'asc';
let isProcessing = false;

const DOM = {};

function cacheDOM() {
    const ids = [
        'drop-zone', 'file-input', 'folder-input', 'btn-folder', 'file-list', 
        'file-list-items', 'file-count', 'btn-clear', 'btn-export-pdf', 
        'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 
        'table-body', 'filter-input', 'results-count', 'loading-overlay', 
        'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 
        'btn-cancel', 'cdn-alert', 'cdn-alert-text'
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

// Normalizador Unicode para ignorar tildes, mayúsculas y caracteres raros
function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function detectFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.zip')) return 'zip';
    return 'other';
}

function getFileTypeIcon(type) {
    if (type === 'pdf') return '📄';
    if (type === 'docx') return '📝';
    if (type === 'zip') return '📦';
    return '📎';
}

// Extrae el Nombre del Estudiante del Encabezado o del Nombre de Archivo
function extractStudentIdentity(fileName, text) {
    if (!text) return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');

    const cleanText = text.trim();
    const patrones = [
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*:\s*([^\n]{3,60})/i,
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*[:\-]\s*([^\n]{3,60})/i
    ];

    for (const p of patrones) {
        const match = cleanText.match(p);
        if (match && match[1] && match[1].trim().length > 2) {
            return match[1].trim().replace(/\s+/g, ' ');
        }
    }

    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const firstLines = lines.slice(0, 5);
    for (const line of firstLines) {
        if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s,]{6,60}$/.test(line) && line.split(/\s+/).length >= 2 && !line.toLowerCase().includes('tema') && !line.toLowerCase().includes('decreto')) {
            return line.trim();
        }
    }

    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// EVALUACIÓN DETERMINISTA Y DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════
function evaluateContent(fileName, text) {
    const wordCount = text ? text.split(/\s+/).filter(w => w.length > 1).length : 0;
    const estudiante = extractStudentIdentity(fileName, text);
    const normText = normalizeText(text);

    if (wordCount < 30) {
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: [false, false, false],
            c2: 0, c2Checks: [false, false, false],
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: 'se emite: ninguno; ausenta: contenido mínimo procesable; postura por fortalecer: extensión e información general.'
        };
    }

    // 1. Detección C1: Normativa Peruana (Máx. 5 pts)
    const t1Kw = ['cts', 'gratificacion', 'vacaciones', 'd.l. 650', 'dl 650', 'd.l. 713', 'dl 713', 'ley 27735', 'ley 26790', 'sctr', 'd.l. 854', 'dl 854', 'beneficios sociales', 'mype'];
    const t2Kw = ['acoso', 'hostigamiento', 'ley 27942', 'd.l. 1410', 'dl 1410', 'd.s. 014-2019-mimp', 'ds 014-2019-mimp', 'violencia sexual'];
    const t3Kw = ['flexibilidad', 'horario', 'estudiante', 'ley 28518', 'modalidades formativas', 'd.s. 011-2012-ed', 'ds 011-2012-ed', 'minedu', 'jornada'];

    const hasT1 = t1Kw.some(kw => normText.includes(kw));
    const hasT2 = t2Kw.some(kw => normText.includes(kw));
    const hasT3 = t3Kw.some(kw => normText.includes(kw));

    const c1Checks = [hasT1, hasT2, hasT3];
    const c1Count = c1Checks.filter(Boolean).length;
    const c1Puntos = Math.min(5, Math.round((c1Count * (5 / 3)) * 10) / 10);

    // 2. Detección C2: Evidencias y Casos Reales (Máx. 7 pts)
    const caseKw = ['http', 'https', 'www', 'sunafil', 'infobae', 'defensoria', 'el peruano', 'noticia', 'caso', 'denuncia', 'empresa', 'ripley', 'emape', 'cronica viva', 'lp derecho'];
    const hasCaseContext = caseKw.some(kw => normText.includes(kw));

    const hasC1_Case = hasT1 && hasCaseContext;
    const hasC2_Case = hasT2 && hasCaseContext;
    const hasC3_Case = hasT3 && hasCaseContext;

    const c2Checks = [hasC1_Case, hasC2_Case, hasC3_Case];
    const c2Count = c2Checks.filter(Boolean).length;
    const c2Puntos = Math.min(7, Math.round((c2Count * (7 / 3)) * 10) / 10);

    // 3. Detección C3: Ética y Rol de RR.HH. (Máx. 8 pts)
    const e1Kw = ['etica', 'dignidad', 'trato justo', 'opinion', 'considero', 'reflexion', 'juicio'];
    const e2Kw = ['recursos humanos', 'rrhh', 'rr.hh', 'gestion humana', 'talento humano', 'area de personal'];
    const e3Kw = ['propuesta', 'solucion', 'estrategia', 'medida', 'garante', 'responsabilidad', 'compromiso'];

    const hasE1 = e1Kw.some(kw => normText.includes(kw));
    const hasE2 = e2Kw.some(kw => normText.includes(kw));
    const hasE3 = e3Kw.some(kw => normText.includes(kw));

    const c3Checks = [hasE1, hasE2, hasE3];
    const c3Count = c3Checks.filter(Boolean).length;
    const c3Puntos = Math.min(8, Math.round((c3Count * (8 / 3)) * 10) / 10);

    // Bibliografía
    const bibKw = ['bibliografia', 'referencia', 'fuente', 'http', 'https', 'recuperado de'];
    const hasBib = bibKw.some(kw => normText.includes(kw));

    // Nota Final
    const notaFinal = Math.min(20, Math.round((c1Puntos + c2Puntos + c3Puntos) * 10) / 10);

    // Diagnóstico Sintético
    const emiteArr = [];
    if (hasT1) emiteArr.push('marco normativo T1');
    if (hasT2) emiteArr.push('marco normativo T2');
    if (hasT3) emiteArr.push('marco normativo T3');
    if (hasC1_Case) emiteArr.push('evidencia T1');
    if (hasC2_Case) emiteArr.push('evidencia T2');
    if (hasC3_Case) emiteArr.push('evidencia T3');
    if (hasE1) emiteArr.push('postura ética');
    if (hasE2) emiteArr.push('rol de RR.HH.');

    const ausentaArr = [];
    if (!hasT1) ausentaArr.push('normativa T1');
    if (!hasT2) ausentaArr.push('normativa T2');
    if (!hasT3) ausentaArr.push('normativa T3 (Flexibilidad)');
    if (!hasC1_Case) ausentaArr.push('caso real T1');
    if (!hasC2_Case) ausentaArr.push('caso real T2');
    if (!hasC3_Case) ausentaArr.push('caso real T3');
    if (!hasE1 || !hasE2) ausentaArr.push('reflexión ética integral de RR.HH.');

    let fortalecerStr = 'mantener el estándar de rigor académico';
    if (!hasT3) fortalecerStr = 'completitud en el desarrollo de todos los temas requeridos (T3)';
    else if (!hasC3_Case) fortalecerStr = 'fundamentación de casos reales con enlaces verificables';
    else if (!hasE1) fortalecerStr = 'postura crítica personal sobre el rol de Gestión Humana';

    const emiteStr = emiteArr.length > 0 ? emiteArr.join(', ') : 'conceptos generales';
    const ausentaStr = ausentaArr.length > 0 ? ausentaArr.join(', ') : 'ningún requerimiento obligatorio';

    const observacion = `se emite: ${emiteStr}; ausenta: ${ausentaStr}; postura por fortalecer: ${fortalecerStr}.`;

    return {
        estudiante: estudiante,
        c1: c1Puntos, c1Checks: c1Checks,
        c2: c2Puntos, c2Checks: c2Checks,
        c3: c3Puntos, c3Checks: c3Checks,
        notaFinal: notaFinal,
        wordCount: wordCount,
        bibliografia: { ok: hasBib },
        observacion: observacion
    };
}

// ─── LECTORES DE ARCHIVOS ───
async function extractTextFromPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n';
    }
    return fullText;
}

async function extractTextFromDOCX(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value || '';
}

async function extractFilesFromZip(zipFile) {
    const extracted = [];
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(entry => !entry.dir);

    for (const zipEntry of entries) {
        const lower = zipEntry.name.toLowerCase();
        if (lower.endsWith('.pdf') || lower.endsWith('.docx')) {
            const blob = await zipEntry.async('blob');
            const file = new File([blob], zipEntry.name.split('/').pop(), {
                type: lower.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
            extracted.push({ name: file.name, type: lower.endsWith('.pdf') ? 'pdf' : 'docx', file: file, size: blob.size });
        }
    }
    return extracted;
}

// ─── PROCESAMIENTO AUTOMÁTICO EN LOTE ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    isProcessing = true;
    abortController = new AbortController();
    resultadosEvaluacion = [];

    if (DOM['table-body']) DOM['table-body'].innerHTML = '';
    if (DOM['loading-overlay']) DOM['loading-overlay'].classList.remove('hidden');

    try {
        let cola = archivosDetectados.slice();
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (abortController.signal.aborted) break;

            let item = cola.shift();

            if (item.type === 'zip') {
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    cola.unshift(...extracted);
                    total += extracted.length;
                } catch (e) { addError(item.name, 'Error ZIP: ' + e.message); }
                procesados++;
                continue;
            }

            procesados++;
            const pct = Math.round((procesados / total) * 100);

            if (DOM['loading-detail']) DOM['loading-detail'].textContent = `Evaluando (${procesados}/${total}): ${item.name}`;
            if (DOM['overlay-progress']) DOM['overlay-progress'].value = pct;
            if (DOM['overlay-percent']) DOM['overlay-percent'].textContent = `${pct}%`;

            try {
                let text = '';
                if (item.type === 'pdf') text = await extractTextFromPDF(item.file);
                else if (item.type === 'docx') text = await extractTextFromDOCX(item.file);

                const res = evaluateContent(item.name, text);
                resultadosEvaluacion.push(res);

            } catch (err) {
                addError(item.name, 'Error al procesar: ' + err.message);
            }

            await new Promise(r => setTimeout(r, 10));
        }
    } finally {
        isProcessing = false;
        if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            renderTable();
        }
    }
}

// ─── RENDERIZADO VISUAL (INSIGNIAS DETECTADAS / OMITIDAS) ───
function renderPill(label, isOk) {
    if (!isOk) return ''; // Se omite por completo si no se detecta
    return `<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">${label}</span>`;
}

function renderScoreBadge(score, max) {
    let color = '#ef4444', bg = '#fef2f2';
    const pct = score / max;
    if (pct >= 0.7) { color = '#10b981'; bg = '#ecfdf5'; }
    else if (pct >= 0.4) { color = '#f59e0b'; bg = '#fffbeb'; }

    return `<div style="display:inline-block; text-align:center; padding:2px 6px; border-radius:6px; background:${bg}; color:${color}; border:1px solid ${color}33;">
        <span style="font-size:0.85rem; font-weight:800;">${score}</span><span style="font-size:0.65rem; opacity:0.8;">/${max}</span>
    </div>`;
}

function renderFinalBadge(nota) {
    let bg = '#10b981';
    if (nota < 11) bg = '#ef4444';
    else if (nota < 14) bg = '#f59e0b';

    return `<span style="display:inline-block; padding:4px 10px; font-weight:800; font-size:0.85rem; border-radius:20px; color:#ffffff; background:${bg};">${nota} / 20</span>`;
}

function renderTable(filterText = '') {
    const tbody = DOM['table-body'];
    if (!tbody) return;

    tbody.innerHTML = '';
    let filtered = resultadosEvaluacion.filter(r => r.estudiante.toLowerCase().includes(filterText.toLowerCase()));

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos de evaluación.</td></tr>';
        if (DOM['results-count']) DOM['results-count'].classList.add('hidden');
        return;
    }

    if (DOM['results-count']) {
        DOM['results-count'].classList.remove('hidden');
        DOM['results-count'].textContent = `Mostrando ${filtered.length} de ${resultadosEvaluacion.length}`;
    }

    filtered.forEach((r, idx) => {
        const bibIcon = r.bibliografia.ok 
            ? '<span style="color:#10b981; font-weight:700; font-size:0.8rem;">✓ Con Fuentes</span>' 
            : '<span style="color:#9ca3af; font-size:0.8rem;">—</span>';

        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        const c3Pills = renderPill('E1', r.c3Checks[0]) + renderPill('E2', r.c3Checks[1]) + renderPill('E3', r.c3Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">${idx + 1}</td>
            <td style="font-weight:600; color:#111827; font-size:0.85rem;">${escapeHTML(r.estudiante)}</td>
            <td style="text-align:center;">${renderScoreBadge(r.c1, 5)}<br><div style="margin-top:3px;">${c1Pills}</div></td>
            <td style="text-align:center;">${renderScoreBadge(r.c2, 7)}<br><div style="margin-top:3px;">${c2Pills}</div></td>
            <td style="text-align:center;">${renderScoreBadge(r.c3, 8)}<br><div style="margin-top:3px;">${c3Pills}</div></td>
            <td style="text-align:center;">${renderFinalBadge(r.notaFinal)}</td>
            <td style="text-align:center; font-size:0.8rem; color:#4b5563;">${r.wordCount} pal.</td>
            <td style="text-align:center;">${bibIcon}</td>
            <td style="font-size:0.8rem; color:#374151; line-height:1.35; padding: 8px;">
                <div style="background:#f9fafb; border-left:3px solid #6366f1; padding:6px 8px; border-radius:0 4px 4px 0;">
                   ${escapeHTML(r.observacion)}
                </div>
            </td>`;
        tbody.appendChild(tr);
    });
}

function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let addedAny = false;

    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
            addedAny = true;
        }
    }

    if (addedAny) {
        updateFileListUI();
        processAllFiles(); // DISPARO AUTOMÁTICO INSTANTÁNEO
    }
}

function updateFileListUI() {
    if (!DOM['file-list-items']) return;
    DOM['file-list-items'].innerHTML = '';

    if (archivosDetectados.length === 0) {
        DOM['file-list'].classList.add('hidden');
        return;
    }

    DOM['file-list'].classList.remove('hidden');
    if (DOM['file-count']) DOM['file-count'].textContent = archivosDetectados.length;

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        chip.innerHTML = `${getFileTypeIcon(f.type)} <span>${escapeHTML(f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name)}</span> <button class="chip-remove" data-index="${i}">&times;</button>`;
        DOM['file-list-items'].appendChild(chip);
    });

    DOM['file-list-items'].querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            archivosDetectados.splice(parseInt(btn.dataset.index), 1);
            updateFileListUI();
            if (archivosDetectados.length > 0) processAllFiles();
            else clearAll();
        });
    });
}

function addError(archivo, mensaje) {
    if (!DOM['error-panel']) return;
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = `[${archivo}] ${mensaje}`;
    DOM['error-list'].appendChild(li);
}

function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    if (DOM['table-body']) DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg">Sube o arrastra archivos para iniciar la evaluación automática.</td></tr>';
    if (DOM['file-list']) DOM['file-list'].classList.add('hidden');
    if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = true;
    if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = true;
    if (DOM['btn-clear']) DOM['btn-clear'].disabled = true;
}

// ─── INICIALIZACIÓN ───
document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const dropZone = DOM['drop-zone'];
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }));
        dropZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFilesToList(e.dataTransfer.files); });
    }

    if (DOM['file-input']) DOM['file-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['folder-input']) DOM['folder-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['btn-folder']) DOM['btn-folder'].addEventListener('click', () => { if (DOM['folder-input']) DOM['folder-input'].click(); });
    if (DOM['btn-clear']) DOM['btn-clear'].addEventListener('click', clearAll);
    if (DOM['filter-input']) DOM['filter-input'].addEventListener('input', function() { renderTable(this.value); });
    if (DOM['btn-dismiss-errors']) DOM['btn-dismiss-errors'].addEventListener('click', () => DOM['error-panel'].classList.add('hidden'));
});
