/* ============================================================
   index.js — Motor de Evaluación Heurístico Determinista v7.5
   Proximidad Estricta, Ética Escalonada y Detección Dual (Narrativa)
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
    return str.replace(/[&<>'"]/g, tag => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[tag] || tag));
}

function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, ' ');
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
// MOTOR DE EVALUACIÓN: RIGUROSIDAD Y DETECCIÓN DUAL
// ═══════════════════════════════════════════════════════════
function evaluateContent(fileName, text) {
    const wordCount = text ? text.trim().split(/\s+/).filter(w => w.match(/[a-z0-9]/i)).length : 0;
    const estudiante = extractStudentIdentity(fileName, text);
    const normText = normalizeText(text);

    if (wordCount < 50) {
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: [false, false, false],
            c2: 0, c2Checks: [false, false, false],
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: 'Ausenta: Contenido mínimo. | Por fortalecer: Documento en blanco o insuficiente.'
        };
    }

    // 1. SEGMENTACIÓN ESTRICTA
    let rawBlocks = text.split(/(?:\r?\n){2,}|\.\s+/).map(b => normalizeText(b)).filter(b => b.length > 30);
    if (rawBlocks.length === 0) rawBlocks = [normText];

    // Diccionarios Normativos
    const regexT1 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo|norma).{0,12}(27735|25129|26790|29783|30056|650|713|892|688|854)/;
    const t1Compounds = ['compensacion por tiempo', 'asignacion familiar', 'seguro de vida ley', 'participacion de utilidades', 'seguridad y salud en el trabajo', 'prevencion de riesgos laborales', 'descanso vacacional', 'horas extras'];

    const regexT2 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo|convenio).{0,12}(27942|1410|014 2019|190)/;
    const t2Compounds = ['hostigamiento sexual', 'acoso sexual', 'acoso laboral', 'comite de intervencion', 'violencia sexual', 'conducta no deseada'];

    const regexT3 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo).{0,12}(28518|011 2012|31396)/;
    const t3Compounds = ['modalidad formativa', 'modalidades formativas', 'facilidades horarias', 'flexibilidad horaria', 'practicas preprofesionales', 'practicas profesionales', 'jornada formativa'];

    // 2. NUEVOS DICCIONARIOS DE CASOS (FORMAL Y NARRATIVO)
    const formalEvidenceKw = ['http', 'https', 'www', 'sunafil', 'infobae', 'defensoria', 'el peruano', 'noticia', 'denuncia', 'sentencia', 'sindicato', 'mtpe', 'corte suprema', 'jurisprudencia', 'casacion', 'expediente', 'multa impuesta'];
    
    // Diccionarios para inferir casos narrados por el alumno
    const narrativeActorKw = ['la empresa', 'el empleador', 'trabajador', 'colaborador', 'gerente', 'jefe', 'organizacion', 'compañia', 'recursos humanos', 'personal'];
    const narrativeActionKw = ['vulnero', 'vulneracion', 'incumplio', 'incumplimiento', 'obligo', 'afecto', 'accidente', 'despido', 'queja', 'reclamo', 'infraccion', 'abuso', 'denuncio'];

    // Funciones Evaluadoras por Bloque
    const hasT1InBlock = (b) => regexT1.test(b) || t1Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT2InBlock = (b) => regexT2.test(b) || t2Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT3InBlock = (b) => regexT3.test(b) || t3Compounds.filter(kw => b.includes(kw)).length >= 1;
    
    // Evaluador Dual de Casos (Proximidad absoluta)
    const hasCaseInBlock = (b) => {
        const hasFormal = formalEvidenceKw.some(kw => b.includes(kw));
        const hasNarrative = narrativeActorKw.some(kw => b.includes(kw)) && narrativeActionKw.some(kw => b.includes(kw));
        return hasFormal || hasNarrative;
    };

    // 3. C1: NORMATIVA 
    const hasT1 = rawBlocks.some(b => hasT1InBlock(b)) || regexT1.test(normText);
    const hasT2 = rawBlocks.some(b => hasT2InBlock(b)) || regexT2.test(normText);
    const hasT3 = rawBlocks.some(b => hasT3InBlock(b)) || regexT3.test(normText);

    const c1Checks = [hasT1, hasT2, hasT3];
    const c1Puntos = c1Checks.filter(Boolean).length * 2;

    // 4. C2: CASOS REALES (Condición EXCLUSIVA de Proximidad Contextual)
    const hasC1_Case = rawBlocks.some(b => hasT1InBlock(b) && hasCaseInBlock(b));
    const hasC2_Case = rawBlocks.some(b => hasT2InBlock(b) && hasCaseInBlock(b));
    const hasC3_Case = rawBlocks.some(b => hasT3InBlock(b) && hasCaseInBlock(b));

    const c2Checks = [hasC1_Case, hasC2_Case, hasC3_Case];
    const c2Puntos = c2Checks.filter(Boolean).length * 2;

    // 5. C3: ÉTICA ESCALONADA 
    const p1Kw = ['dignidad', 'bienestar', 'justicia', 'equidad', 'vulnerabilidad', 'empatia', 'valor inherente', 'derechos humanos', 'desarrollo integral', 'salud mental', 'tolerancia cero', 'mas alla de la norma', 'responsabilidad social', 'prevencion', 'integridad', 'respeto', 'corresponsabilidad'];
    const p2Kw = ['sunafil', 'multa', 'sancion', 'reglamento', 'contingencia', 'demanda', 'indemnizacion', 'evitar sanciones', 'riesgos legales', 'reputacion corporativa', 'politicas de la empresa'];
    const p3Kw = ['exageracion', 'inevitable', 'costoso', 'tradicion', 'informalidad', 'necesidades del negocio', 'cultura del sector', 'no es obligatorio', 'trabajador debe adaptarse', 'solo se debe cumplir', 'situacion aislada'];

    const p1Hits = p1Kw.filter(kw => normText.includes(kw)).length;
    const p2Hits = p2Kw.filter(kw => normText.includes(kw)).length;
    const p3Hits = p3Kw.filter(kw => normText.includes(kw)).length;

    let c3Puntos = 0;
    let stanceMsg = '';
    let c3Checks = [false, false, false];

    if (p3Hits > 0) {
        c3Puntos = 0; 
        stanceMsg = 'Postura Deficiente (justifica o normaliza malas prácticas)';
        c3Checks = [true, false, false];
    } else if (p1Hits > 0) {
        if (c1Puntos === 6 && c2Puntos === 6) {
            c3Puntos = 8; 
            stanceMsg = 'Postura Ética Humana Impecable (Análisis y evidencias completos al 100%)';
            c3Checks = [true, true, true];
        } else if (c1Puntos >= 4 && c2Puntos >= 4) {
            c3Puntos = 6; 
            stanceMsg = 'Postura Ética Humana Buena (Penalizada levemente por omisión de 1 tema o 1 caso)';
            c3Checks = [true, true, false];
        } else {
            c3Puntos = 4; 
            stanceMsg = 'Postura Ética Humana Parcial (Existen vacíos graves en normativas o casos)';
            c3Checks = [true, false, false];
        }
    } else if (p2Hits > 0) {
        c3Puntos = 4; 
        stanceMsg = 'Postura Legalista-Corporativa (Enfocada en evitar multas y riesgos corporativos)';
        c3Checks = [true, false, false];
    } else {
        c3Puntos = 0;
        stanceMsg = 'No se evidencia reflexión crítica clara ni postura personal';
    }

    // 6. RADARES ADICIONALES (APA, Conectores)
    let fortalezasExtra = [];
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText);
    if (!hasAPA) fortalezasExtra.push('Formato APA (citas/referencias)');

    const conectores = ['sin embargo', 'por lo tanto', 'en consecuencia', 'debido a', 'adicionalmente', 'en conclusion', 'no obstante', 'asimismo', 'por ende', 'es decir'];
    if (conectores.filter(c => normText.includes(c)).length < 3) fortalezasExtra.push('Uso de conectores lógicos argumentativos');

    const subtitulosProhibidos = ['tema 1', 'parte 1', 'parte 2', 'reflexion final', 'tema 2', 'tema 3'];
    if (subtitulosProhibidos.some(sub => normText.includes(sub))) fortalezasExtra.push('Redacción fluida (sin subtítulos escolares)');

    // 7. CONSTRUCCIÓN DEL DIAGNÓSTICO SINTÉTICO
    const ausentaArr = [];
    if (!hasT1) ausentaArr.push('T1 (Norma)');
    if (!hasT2) ausentaArr.push('T2 (Norma)');
    if (!hasT3) ausentaArr.push('T3 (Norma)');
    if (!hasC1_Case && hasT1) ausentaArr.push('Caso Real T1');
    if (!hasC2_Case && hasT2) ausentaArr.push('Caso Real T2');
    if (!hasC3_Case && hasT3) ausentaArr.push('Caso Real T3');

    let diagnostico = `Ausenta: ${ausentaArr.length > 0 ? ausentaArr.join(', ') : 'Desarrollo completo (0 omisiones)'}. | `;
    diagnostico += `Ética: ${stanceMsg}`;
    if (fortalezasExtra.length > 0) diagnostico += ` | Por mejorar formato: ${fortalezasExtra.join(', ')}.`;
    else diagnostico += `.`;

    const notaFinal = Math.min(20, c1Puntos + c2Puntos + c3Puntos);

    return {
        estudiante: estudiante,
        c1: c1Puntos, c1Checks: c1Checks,
        c2: c2Puntos, c2Checks: c2Checks,
        c3: c3Puntos, c3Checks: c3Checks,
        notaFinal: notaFinal,
        wordCount: wordCount,
        bibliografia: { ok: hasAPA },
        observacion: diagnostico
    };
}

// ─── LECTORES DE ARCHIVOS (PDF, DOCX, ZIP) ───
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

            if (DOM['loading-detail']) DOM['loading-detail'].textContent = `Evaluando analíticamente (${procesados}/${total}): ${item.name}`;
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
    } catch (criticalErr) {
        addError("Sistema", "Se detuvo el proceso por un error inesperado.");
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

// ─── RENDERIZADO VISUAL EN TABLA ───
function renderPill(label, isOk) {
    if (!isOk) return ''; 
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
        const bibIcon = r.bibliografia.ok ? '<span style="color:#10b981; font-weight:700; font-size:0.8rem;">✓ APA OK</span>' : '<span style="color:#9ca3af; font-size:0.8rem;">—</span>';

        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]) || '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        
        let c3Pills = '<span style="color:#9ca3af; font-size:0.75rem;">—</span>';
        if (r.c3 === 8) c3Pills = renderPill('Óptimo (8p)', true);
        else if (r.c3 === 6) c3Pills = renderPill('Bueno (6p)', true);
        else if (r.c3 === 4) c3Pills = renderPill('Parcial/Legal (4p)', true);
        else if (r.c3Checks[0]) c3Pills = renderPill('Deficiente (0p)', true);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">${idx + 1}</td>
            <td style="font-weight:600; color:#111827; font-size:0.85rem;">${escapeHTML(r.estudiante)}</td>
            <td style="text-align:center;">${renderScoreBadge(r.c1, 6)}<br><div style="margin-top:3px;">${c1Pills}</div></td>
            <td style="text-align:center;">${renderScoreBadge(r.c2, 6)}<br><div style="margin-top:3px;">${c2Pills}</div></td>
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

// ─── GESTIÓN DE EVENTOS DE USUARIO ───
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
        processAllFiles(); 
    }
}

function updateFileListUI() {
    if (!DOM['file-list-items']) return;
    DOM['file-list-items'].innerHTML = '';
    if (archivosDetectados.length === 0) { DOM['file-list'].classList.add('hidden'); return; }
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
    if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
    if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = true;
    if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = true;
    if (DOM['file-input']) DOM['file-input'].value = '';
    if (DOM['folder-input']) DOM['folder-input'].value = '';
}

function exportCSV() {
    if (resultadosEvaluacion.length === 0) return;
    let csv = 'Estudiante,C1(6),C2(6),C3(8),Nota Final,Palabras,Bibliografia,Diagnostico Sintetico\n';
    resultadosEvaluacion.forEach(r => {
        csv += `"${r.estudiante}",${r.c1},${r.c2},${r.c3},${r.notaFinal},${r.wordCount},"${r.bibliografia.ok ? 'APA OK' : 'NO'}","${r.observacion.replace(/"/g, '""')}"\n`;
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

document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    if (
