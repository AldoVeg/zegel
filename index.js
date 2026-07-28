/* ============================================================
   index.js — Motor de Evaluación Heurístico Determinista
   Totalmente acoplado a HTML y CSS para respuesta instantánea
   ============================================================ */

// ─── Variables de Estado ───
let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let sortColumn = null;
let sortDirection = 'asc';
let isProcessing = false;

// ─── Cache del DOM ───
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
    ids.forEach(id => { 
        DOM[id] = document.getElementById(id);
        if(!DOM[id]) console.warn(`Elemento DOM faltante: ${id}`);
    });
}

// ─── Funciones Utilitarias ───
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

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

// ─── Extracción del Estudiante ───
function extractStudentIdentity(fileName, text) {
    if (!text) return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');

    const cleanText = text.trim();
    const patrones = [
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*:\s*([^\n]{3,60})/i,
        /(?:estudiante|alumno|autor|presentado\s*por|elaborado\s*por|nombre)\s*[:\-]\s*([^\n]{3,60})/i
    ];

    for (const p of patrones) {
        const match = cleanText.match(p);
        if (match && match[1] && match[1].trim().length > 2) return match[1].trim().replace(/\s+/g, ' ');
    }

    const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines.slice(0, 5)) {
        if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s,]{6,60}$/.test(line) && line.split(/\s+/).length >= 2 && !line.toLowerCase().includes('tema')) {
            return line.trim();
        }
    }
    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE REGLAS HEURÍSTICAS LOCAL
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
            observacion: 'se emite: ninguno; ausenta: contenido mínimo; postura por fortalecer: extensión e información general.'
        };
    }

    // C1: Normativa
    const hasT1 = ['cts', 'gratificacion', 'vacaciones', 'dl 650', 'dl 713', 'ley 27735', 'ley 26790', 'dl 854', 'beneficios'].some(kw => normText.includes(kw));
    const hasT2 = ['acoso', 'hostigamiento', 'ley 27942', 'dl 1410', 'ds 014-2019-mimp', 'violencia sexual'].some(kw => normText.includes(kw));
    const hasT3 = ['flexibilidad', 'horario', 'estudiante', 'ley 28518', 'formativas', 'ds 011-2012-ed', 'minedu'].some(kw => normText.includes(kw));

    const c1Checks = [hasT1, hasT2, hasT3];
    const c1Puntos = Math.min(5, Math.round((c1Checks.filter(Boolean).length * (5 / 3)) * 10) / 10);

    // C2: Casos / Evidencias
    const hasCaseContext = ['http', 'https', 'www', 'sunafil', 'infobae', 'defensoria', 'noticia', 'caso', 'denuncia', 'empresa', 'sentencia'].some(kw => normText.includes(kw));
    const c2Checks = [hasT1 && hasCaseContext, hasT2 && hasCaseContext, hasT3 && hasCaseContext];
    const c2Puntos = Math.min(7, Math.round((c2Checks.filter(Boolean).length * (7 / 3)) * 10) / 10);

    // C3: Ética y RRHH
    const hasE1 = ['etica', 'dignidad', 'trato justo', 'opinion', 'considero', 'reflexion'].some(kw => normText.includes(kw));
    const hasE2 = ['recursos humanos', 'rrhh', 'rr.hh', 'gestion humana', 'talento humano', 'area de personal'].some(kw => normText.includes(kw));
    const hasE3 = ['propuesta', 'solucion', 'estrategia', 'medida', 'responsabilidad'].some(kw => normText.includes(kw));

    const c3Checks = [hasE1, hasE2, hasE3];
    const c3Puntos = Math.min(8, Math.round((c3Checks.filter(Boolean).length * (8 / 3)) * 10) / 10);

    const hasBib = ['bibliografia', 'referencia', 'fuente', 'http', 'recuperado de'].some(kw => normText.includes(kw));
    const notaFinal = Math.min(20, Math.round((c1Puntos + c2Puntos + c3Puntos) * 10) / 10);

    // Diagnóstico
    const emiteArr = [];
    if (hasT1) emiteArr.push('normativa T1'); if (hasT2) emiteArr.push('normativa T2'); if (hasT3) emiteArr.push('normativa T3');
    if (c2Checks[0]) emiteArr.push('evidencia T1'); if (c2Checks[1]) emiteArr.push('evidencia T2'); if (c2Checks[2]) emiteArr.push('evidencia T3');
    if (hasE1) emiteArr.push('postura ética'); if (hasE2) emiteArr.push('rol RR.HH.');

    const ausentaArr = [];
    if (!hasT1) ausentaArr.push('norma T1'); if (!hasT2) ausentaArr.push('norma T2'); if (!hasT3) ausentaArr.push('norma T3');
    if (!c2Checks[0]) ausentaArr.push('caso T1'); if (!c2Checks[1]) ausentaArr.push('caso T2'); if (!c2Checks[2]) ausentaArr.push('caso T3');
    if (!hasE1 || !hasE2) ausentaArr.push('cierre ético de RR.HH.');

    let fortalecerStr = 'mantener el estándar académico';
    if (!hasT3) fortalecerStr = 'completitud temática (Falta T3)';
    else if (!hasCaseContext) fortalecerStr = 'fundamentación de casos reales con enlaces';
    else if (!hasE1) fortalecerStr = 'postura crítica personal';

    return {
        estudiante: estudiante,
        c1: c1Puntos, c1Checks: c1Checks,
        c2: c2Puntos, c2Checks: c2Checks,
        c3: c3Puntos, c3Checks: c3Checks,
        notaFinal: notaFinal, wordCount: wordCount,
        bibliografia: { ok: hasBib },
        observacion: `se emite: ${emiteArr.length ? emiteArr.join(', ') : 'teoría general'}; ausenta: ${ausentaArr.length ? ausentaArr.join(', ') : 'nada esencial'}; postura por fortalecer: ${fortalecerStr}.`
    };
}

// ─── LECTORES (PDF/DOCX/ZIP) ───
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

// ─── PROCESAMIENTO AUTOMÁTICO ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    isProcessing = true;
    abortController = new AbortController();
    resultadosEvaluacion = [];

    DOM['table-body'].innerHTML = '';
    DOM['loading-overlay'].classList.remove('hidden');

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
                    total += extracted.length - 1; // Ajuste contador
                } catch (e) { addError(item.name, `ZIP Error: ${e.message}`); }
                continue;
            }

            procesados++;
            const pct = Math.round((procesados / total) * 100);
            DOM['loading-detail'].textContent = `Evaluando (${procesados}/${total}): ${item.name}`;
            DOM['overlay-progress'].value = pct;
            DOM['overlay-percent'].textContent = `${pct}%`;

            try {
                let text = '';
                if (item.type === 'pdf') text = await extractTextFromPDF(item.file);
                else if (item.type === 'docx') text = await extractTextFromDOCX(item.file);
                
                resultadosEvaluacion.push(evaluateContent(item.name, text));
            } catch (err) {
                addError(item.name, `Error lectura: ${err.message}`);
            }
            await new Promise(r => setTimeout(r, 10)); // UI Breath
        }
    } finally {
        isProcessing = false;
        DOM['loading-overlay'].classList.add('hidden');
        if (resultadosEvaluacion.length > 0) {
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            renderTable();
        }
    }
}

// ─── MANEJO DE LISTA DE ARCHIVOS Y DISPARADOR ───
function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = false;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size)) {
            archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
            added = true;
        }
    }
    if (added) {
        updateFileListUI();
        processAllFiles(); // DISPARO AUTOMÁTICO AL CARGAR
    }
}

function updateFileListUI() {
    DOM['file-list-items'].innerHTML = '';
    if (archivosDetectados.length === 0) {
        DOM['file-list'].classList.add('hidden');
        return;
    }
    DOM['file-list'].classList.remove('hidden');
    DOM['file-count'].textContent = archivosDetectados.length;

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
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = `[${archivo}] ${mensaje}`;
    DOM['error-list'].appendChild(li);
}

// ─── RENDERIZADO VISUAL EN LA TABLA ───
function renderPill(label, isOk) {
    if (!isOk) return ''; // Se omite si es falso
    return `<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">${label}</span>`;
}

function renderScore(score, max) {
    let color = '#ef4444', bg = '#fef2f2';
    if (score / max >= 0.7) { color = '#10b981'; bg = '#ecfdf5'; }
    else if (score / max >= 0.4) { color = '#f59e0b'; bg = '#fffbeb'; }
    return `<div style="display:inline-block; text-align:center; padding:2px 6px; border-radius:6px; background:${bg}; color:${color}; border:1px solid ${color}33;">
        <span style="font-size:0.85rem; font-weight:800;">${score}</span><span style="font-size:0.65rem; opacity:0.8;">/${max}</span></div>`;
}

function renderTable(fText = '') {
    const tbody = DOM['table-body'];
    tbody.innerHTML = '';
    
    let sorted = [...resultadosEvaluacion];
    if (sortColumn) {
        sorted.sort((a, b) => {
            let vA = a[sortColumn], vB = b[sortColumn];
            if (typeof vA === 'string') vA = vA.toLowerCase();
            if (typeof vB === 'string') vB = vB.toLowerCase();
            return (vA < vB ? -1 : 1) * (sortDirection === 'asc' ? 1 : -1);
        });
    }

    let fil = sorted.filter(r => r.estudiante.toLowerCase().includes(fText.toLowerCase()));
    if (fil.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos de evaluación.</td></tr>';
        DOM['results-count'].classList.add('hidden');
        return;
    }

    DOM['results-count'].classList.remove('hidden');
    DOM['results-count'].textContent = `Mostrando ${fil.length} resultados`;

    fil.forEach((r, idx) => {
        const bib = r.bibliografia.ok ? '<span style="color:#10b981; font-weight:700; font-size:0.8rem;">✓ Con Fuentes</span>' : '<span style="color:#9ca3af;">—</span>';
        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]) || '<span style="color:#9ca3af;">—</span>';
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]) || '<span style="color:#9ca3af;">—</span>';
        const c3Pills = renderPill('E1', r.c3Checks[0]) + renderPill('E2', r.c3Checks[1]) + renderPill('E3', r.c3Checks[2]) || '<span style="color:#9ca3af;">—</span>';
        const finalBg = r.notaFinal < 11 ? '#ef4444' : (r.notaFinal < 14 ? '#f59e0b' : '#10b981');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">${idx + 1}</td>
            <td style="font-weight:600; color:#111827; font-size:0.85rem;">${escapeHTML(r.estudiante)}</td>
            <td style="text-align:center;">${renderScore(r.c1, 5)}<br><div style="margin-top:3px;">${c1Pills}</div></td>
            <td style="text-align:center;">${renderScore(r.c2, 7)}<br><div style="margin-top:3px;">${c2Pills}</div></td>
            <td style="text-align:center;">${renderScore(r.c3, 8)}<br><div style="margin-top:3px;">${c3Pills}</div></td>
            <td style="text-align:center;"><span style="display:inline-block; padding:4px 10px; font-weight:800; font-size:0.85rem; border-radius:20px; color:#ffffff; background:${finalBg};">${r.notaFinal} / 20</span></td>
            <td style="text-align:center; font-size:0.8rem; color:#4b5563;">${r.wordCount} pal.</td>
            <td style="text-align:center;">${bib}</td>
            <td style="font-size:0.8rem; color:#374151; padding: 8px;">
                <div style="background:#f9fafb; border-left:3px solid #6366f1; padding:6px 8px; border-radius:0 4px 4px 0;">${escapeHTML(r.observacion)}</div>
            </td>`;
        tbody.appendChild(tr);
    });
}

function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg">Sube o arrastra archivos para iniciar la evaluación automática.</td></tr>';
    DOM['file-list'].classList.add('hidden');
    DOM['error-panel'].classList.add('hidden');
    DOM['btn-export-pdf'].disabled = true;
    DOM['btn-export-csv'].disabled = true;
    DOM['file-input'].value = '';
    DOM['folder-input'].value = '';
    DOM['results-count'].classList.add('hidden');
    updateFileListUI();
}

// ─── EXPORTACIONES ───
function exportCSV() {
    if (resultadosEvaluacion.length === 0) return;
    let csv = 'Estudiante,C1,C2,C3,Nota Final,Palabras,Bibliografia,Resumen Concreto\n';
    resultadosEvaluacion.forEach(r => {
        csv += `"${r.estudiante}",${r.c1},${r.c2},${r.c3},${r.notaFinal},${r.wordCount},"${r.bibliografia.ok ? 'SI' : 'NO'}","${r.observacion.replace(/"/g, '""')}"\n`;
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }));
    link.download = `Evaluaciones_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

function exportPDF() {
    if (resultadosEvaluacion.length === 0 || !window.jspdf) return;
    const doc = new window.jspdf.jsPDF('l', 'mm', 'a4');
    doc.setFontSize(14); doc.text("Reporte de Evaluaciones Académicas", 14, 15);
    
    let y = 25; doc.setFontSize(9);
    doc.text("#", 14, y); doc.text("Estudiante", 25, y); doc.text("C1", 85, y); doc.text("C2", 100, y);
    doc.text("C3", 115, y); doc.text("Nota", 130, y); doc.text("Diagnóstico Concreto", 145, y);
    doc.line(14, y + 2, 280, y + 2);

    y += 8;
    resultadosEvaluacion.forEach((r, idx) => {
        if (y > 180) { doc.addPage(); y = 20; }
        doc.text(String(idx + 1), 14, y); doc.text(String(r.estudiante).substring(0, 25), 25, y);
        doc.text(String(r.c1), 85, y); doc.text(String(r.c2), 100, y); doc.text(String(r.c3), 115, y);
        doc.text(String(r.notaFinal), 130, y); doc.text(String(r.observacion).substring(0, 75), 145, y);
        y += 7;
    });
    doc.save(`Evaluaciones_${new Date().toISOString().slice(0,10)}.pdf`);
}

// ─── INICIALIZACIÓN DE EVENTOS ───
document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    if (typeof pdfjsLib !== 'undefined') pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    else { DOM['cdn-alert'].classList.remove('hidden'); DOM['cdn-alert-text'].textContent = 'Verifique conexión a internet (Faltan Librerías)'; }

    const drop = DOM['drop-zone'];
    if (drop) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); }));
        ['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, () => drop.classList.add('dragover')));
        ['dragleave', 'drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('dragover')));
        drop.addEventListener('drop', ev => { if (ev.dataTransfer.files.length) addFilesToList(ev.dataTransfer.files); });
    }

    DOM['file-input']?.addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    DOM['folder-input']?.addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    DOM['btn-folder']?.addEventListener('click', () => DOM['folder-input'].click());
    DOM['btn-clear']?.addEventListener('click', clearAll);
    DOM['btn-cancel']?.addEventListener('click', () => abortController?.abort());
    DOM['btn-export-csv']?.addEventListener('click', exportCSV);
    DOM['btn-export-pdf']?.addEventListener('click', exportPDF);
    DOM['filter-input']?.addEventListener('input', function() { renderTable(this.value); });
    DOM['btn-dismiss-errors']?.addEventListener('click', () => DOM['error-panel'].classList.add('hidden'));

    document.querySelectorAll('.results-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            sortDirection = (sortColumn === col && sortDirection === 'asc') ? 'desc' : 'asc';
            sortColumn = col;
            renderTable(DOM['filter-input'].value);
        });
    });
});
