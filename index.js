/* ============================================================
   index.js — Motor de Evaluación Heurístico Determinista v7.5
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

    // 2. DICCIONARIOS DE CASOS (FORMAL Y NARRATIVO)
    const formalEvidenceKw = ['http', 'https', 'www', 'sunafil', 'infobae', 'defensoria', 'el peruano', 'noticia', 'denuncia', 'sentencia', 'sindicato', 'mtpe', 'corte suprema', 'jurisprudencia', 'casacion', 'expediente', 'multa impuesta'];
    
    const narrativeActorKw = ['la empresa', 'el empleador', 'trabajador', 'colaborador', 'gerente', 'jefe', 'organizacion', 'compañia', 'recursos humanos', 'personal'];
    const narrativeActionKw = ['vulnero', 'vulneracion', 'incumplio', 'incumplimiento', 'obligo', 'afecto', 'accidente', 'despido', 'queja', 'reclamo', 'infraccion', 'abuso', 'denuncio'];

    // Funciones Evaluadoras por Bloque
    const hasT1InBlock = (b) => regexT1.test(b) || t1Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT2InBlock = (b) => regexT2.test(b) || t2Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT3InBlock = (b) => regexT3.test(b) || t3Compounds.filter(kw => b.includes(kw)).length >= 1;
    
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
            stanceMsg = 'Postura Ética Humana Impecable (Análisis y evidencias completos al 100
