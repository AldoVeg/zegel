/* ============================================================
   index.js — Motor de Evaluación Heurístico Determinista v8.0
   ============================================================ */

let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let isProcessing = false;

const DOM = {};

function cacheDOM() {
    const ids = [
        'drop-zone', 'file-input', 'folder-input', 'btn-folder', 'file-list', 
        'file-list-items', 'file-count', 'btn-clear', 'btn-export-pdf', 
        'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 
        'table-body', 'filter-input', 'results-count', 'loading-overlay', 
        'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 
        'btn-cancel'
    ];
    ids.forEach(function(id) { 
        DOM[id] = document.getElementById(id); 
    });
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, function(tag) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return map[tag] || tag;
    });
}

function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, ' ');
}

function detectFileType(file) {
    if (!file || !file.name) return 'other';
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
    for (let i = 0; i < patrones.length; i++) {
        const match = cleanText.match(patrones[i]);
        if (match && match[1] && match[1].trim().length > 2) {
            return match[1].trim().replace(/\s+/g, ' ');
        }
    }
    const lines = cleanText.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    for (let j = 0; j < Math.min(lines.length, 5); j++) {
        const line = lines[j];
        if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s,]{6,60}$/.test(line) && line.split(/\s+/).length >= 2 && !line.toLowerCase().includes('tema')) {
            return line.trim();
        }
    }
    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN
// ═══════════════════════════════════════════════════════════
function evaluateContent(fileName, text) {
    const wordCount = text ? text.trim().split(/\s+/).filter(function(w) { return w.match(/[a-z0-9]/i); }).length : 0;
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

    let rawBlocks = text.split(/(?:\r?\n){2,}|\.\s+/).map(function(b) { return normalizeText(b); }).filter(function(b) { return b.length > 30; });
    if (rawBlocks.length === 0) rawBlocks = [normText];

    const regexT1 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo|norma).{0,12}(27735|25129|26790|29783|30056|650|713|892|688|854)/;
    const t1Compounds = ['compensacion por tiempo', 'asignacion familiar', 'seguro de vida ley', 'participacion de utilidades', 'seguridad y salud en el trabajo', 'prevencion de riesgos laborales', 'descanso vacacional', 'horas extras'];

    const regexT2 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo|convenio).{0,12}(27942|1410|014 2019|190)/;
    const t2Compounds = ['hostigamiento sexual', 'acoso sexual', 'acoso laboral', 'comite de intervencion', 'violencia sexual', 'conducta no deseada'];

    const regexT3 = /(ley|dl|d l|decreto legislativo|ds|d s|decreto supremo).{0,12}(28518|011 2012|31396)/;
    const t3Compounds = ['modalidad formativa', 'modalidades formativas', 'facilidades horarias', 'flexibilidad horaria', 'practicas preprofesionales', 'practicas profesionales', 'jornada formativa'];

    const formalEvidenceKw = ['http', 'https', 'www', 'sunafil', 'infobae', 'defensoria', 'el peruano', 'noticia', 'denuncia', 'sentencia', 'sindicato', 'mtpe', 'corte suprema', 'jurisprudencia', 'casacion', 'expediente', 'multa impuesta'];
    const narrativeActorKw = ['la empresa', 'el empleador', 'trabajador', 'colaborador', 'gerente', 'jefe', 'organizacion', 'compañia', 'recursos humanos', 'personal'];
    const narrativeActionKw = ['vulnero', 'vulneracion', 'incumplio', 'incumplimiento', 'obligo', 'afecto', 'accidente', 'despido', 'queja', 'reclamo', 'infraccion', 'abuso', 'denuncio'];

    function hasT1InBlock(b) {
        return regexT1.test(b) || t1Compounds.filter(function(kw) { return b.includes(kw); }).length >= 2;
    }
    function hasT2InBlock(b) {
        return regexT2.test(b) || t2Compounds.filter(function(kw) { return b.includes(kw); }).length >= 2;
    }
    function hasT3InBlock(b) {
        return regexT3.test(b) || t3Compounds.filter(function(kw) { return b.includes(kw); }).length >= 1;
    }
    function hasCaseInBlock(b) {
        const hasFormal = formalEvidenceKw.some(function(kw) { return b.includes(kw); });
        const hasNarrative = narrativeActorKw.some(function(kw) { return b.includes(kw); }) && narrativeActionKw.some(function(kw) { return b.includes(kw); });
        return hasFormal || hasNarrative;
    }

    const hasT1 = rawBlocks.some(hasT1InBlock) || regexT1.test(normText);
    const hasT2 = rawBlocks.some(hasT2InBlock) || regexT2.test(normText);
    const hasT3 = rawBlocks.some(hasT3InBlock) || regexT3.test(normText);

    const c1Checks = [hasT1, hasT2, hasT3];
    const c1Puntos = c1Checks.filter(Boolean).length * 2;

    const hasC1_Case = rawBlocks.some(function(b) { return hasT1InBlock(b) && hasCaseInBlock(b); });
    const hasC2_Case = rawBlocks.some(function(b) { return hasT2InBlock(b) && hasCaseInBlock(b); });
    const hasC3_Case = rawBlocks.some(function(b) { return hasT3InBlock(b) && hasCaseInBlock(b); });

    const c2Checks = [hasC1_Case, hasC2_Case, hasC3_Case];
    const c2Puntos = c2Checks.filter(Boolean).length * 2;

    const p1Kw = ['dignidad', 'bienestar', 'justicia', 'equidad', 'vulnerabilidad', 'empatia', 'valor inherente', 'derechos humanos', 'desarrollo integral', 'salud mental', 'tolerancia cero', 'mas alla de la norma', 'responsabilidad social', 'prevencion', 'integridad', 'respeto', 'corresponsabilidad'];
    const p2Kw = ['sunafil', 'multa', 'sancion', 'reglamento', 'contingencia', 'demanda', 'indemnizacion', 'evitar sanciones', 'riesgos legales', 'reputacion corporativa', 'politicas de la empresa'];
    const p3Kw = ['exageracion', 'inevitable', 'costoso', 'tradicion', 'informalidad', 'necesidades del negocio', 'cultura del sector', 'no es obligatorio', 'trabajador debe adaptarse', 'solo se debe cumplir', 'situacion aislada'];

    const p1Hits = p1Kw.filter(function(kw) { return normText.includes(kw); }).length;
    const p2Hits = p2Kw.filter(function(kw) { return normText.includes(kw); }).length;
    const p3Hits = p3Kw.filter(function(kw) { return normText.includes(kw); }).length;

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

    let fortalezasExtra = [];
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText);
    if (!hasAPA) fortalezasExtra.push('Formato APA (citas/referencias)');

    const conectores = ['sin embargo', 'por lo tanto', 'en consecuencia', 'debido a', 'adicionalmente', 'en conclusion', 'no obstante', 'asimismo', 'por ende', 'es decir'];
    if (conectores.filter(function(c) { return normText.includes(c); }).length < 3) fortalezasExtra.push('Uso de conectores lógicos argumentativos');

    const ausentaArr = [];
    if (!hasT1) ausentaArr.push('T1 (Norma)');
    if (!hasT2) ausentaArr.push('T2 (Norma)');
    if (!hasT3) ausentaArr.push('T3 (Norma)');
    if (!hasC1_Case && hasT1) ausentaArr.push('Caso Real T1');
    if (!hasC2_Case && hasT2) ausentaArr.push('Caso Real T2');
    if (!hasC3_Case && hasT3) ausentaArr.push('Caso Real T3');

    let diagnostico = 'Ausenta: ' + (ausentaArr.length > 0 ? ausentaArr.join(', ') : 'Desarrollo completo (0 omisiones)') + '. | ';
    diagnostico += 'Ética: ' + stanceMsg;
    if (fortalezasExtra.length > 0) {
        diagnostico += ' | Por mejorar formato: ' + fortalezasExtra.join(', ') + '.';
    } else {
        diagnostico += '.';
    }

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

// ─── EXTRACTION FUNCTIONS WITH CDN GUARD ───
async function extractTextFromPDF(file) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('Falta la librería PDF.js en el HTML. Agrega <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(function(item) { return item.str; }).join(' ') + '\n';
    }
    return fullText;
}

async function extractTextFromDOCX(file) {
    if (typeof mammoth === 'undefined') {
        throw new Error('Falta la librería Mammoth.js en el HTML. Agrega <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value || '';
}

async function extractFilesFromZip(zipFile) {
    if (typeof JSZip === 'undefined') {
        throw new Error('Falta la librería JSZip en el HTML. Agrega <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>');
    }
    const extracted = [];
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(function(entry) { return !entry.dir; });

    for (let k = 0; k < entries.length; k++) {
        const zipEntry = entries[k];
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
                } catch (e) {
                    addError(item.name, e.message);
                }
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

                const res = evaluateContent(item.name, text);
                resultadosEvaluacion.push(res);

            } catch (err) {
                addError(item.name, err.message);
            }
            await new Promise(function(r) { setTimeout(r, 10); });
        }
    } catch (criticalErr) {
        addError("Sistema", "Se interrumpió el proceso: " + criticalErr.message);
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

// ─── RENDERIZADO EN TABLA ───
function renderPill(label, isOk) {
    if (!isOk) return '';
    return '<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">' + label + '</span>';
}
