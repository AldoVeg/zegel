/* ============================================================
   index.js — Motor de Evaluación Automatizada (Equidad Evaluativa)
   C1: 1.5 pts por tema detectado (3 temas = 4.5) + plus 0.5 con ley explícita
   C2: 2.0 pts por tema con evidencia (3 temas = 6.0) + plus 1.0 con enlaces
   C3: Evaluación precisa: postura ética (2.5) + rol RRHH (2.5) + acciones (3.0)
   Procesamiento en Fila India con recolección de basura (RAM)
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

// ─── Diccionarios de Evaluación por Tema ───
// Cada tema tiene su propio diccionario para C1 (normas) y C2 (evidencias)
const TEMAS = {
    beneficios: {
        label: 'Beneficios de Ley',
        c1: ['ley', 'norma', 'decreto', 'derecho', 'mtpe', 'artículo', 'reglamento', '29381', '27942', '28518', 'beneficio', 'remuneración', 'gratificación', 'cts', 'compensación', 'seguro', 'essalud', 'vacaciones', 'jornada', 'descanso', 'utilidades', 'asignación', 'bonificación', 'constitución', '29783', '30057', '30709', '728', 'legislativo', 'supremo', 'ds', 'd.s.'],
        c2: ['sunafil', 'resolución', 'noticia', 'empresa', 'reportaje', 'fuente', 'http', 'https', 'caso real', 'evidencia', 'multa', 'denuncia', 'expediente', 'tribunal', 'indecopi', 'el comercio', 'rpp', 'andina', 'gob.pe', 'www.', '.pe', 'sentencia', 'fiscalización', 'inspección']
    },
    acoso: {
        label: 'Acoso/Hostigamiento',
        c1: ['acoso', 'hostigamiento', '27942', 'ley', 'norma', 'decreto', 'derecho', 'mtpe', 'artículo', 'reglamento', 'laboral', 'sanción', 'falta', 'disciplinario', 'protección', 'víctima', 'denuncia', 'procedimiento', 'constitución', '29783', '30709', 'legislativo', 'supremo', 'ds', 'd.s.'],
        c2: ['sunafil', 'resolución', 'noticia', 'empresa', 'reportaje', 'fuente', 'http', 'https', 'caso real', 'evidencia', 'multa', 'denuncia', 'expediente', 'tribunal', 'indecopi', 'el comercio', 'rpp', 'andina', 'gob.pe', 'www.', '.pe', 'sentencia', 'fiscalización', 'inspección', 'testimonio']
    },
    flexibilidad: {
        label: 'Flexibilidad Horaria',
        c1: ['flexibilidad', 'horario', 'teletrabajo', 'remoto', 'jornada', 'conciliación', '28518', '30036', 'ley', 'norma', 'decreto', 'derecho', 'mtpe', 'artículo', 'reglamento', 'productividad', 'virtual', 'digital', 'desconexión', 'constitución', 'legislativo', 'supremo', 'ds', 'd.s.'],
        c2: ['sunafil', 'resolución', 'noticia', 'empresa', 'reportaje', 'fuente', 'http', 'https', 'caso real', 'evidencia', 'multa', 'denuncia', 'expediente', 'tribunal', 'indecopi', 'el comercio', 'rpp', 'andina', 'gob.pe', 'www.', '.pe', 'sentencia', 'fiscalización', 'inspección', 'covid', 'pandemia', 'home office']
    }
};

const CONECTORES = ['en primer lugar', 'a continuación', 'primero', 'para terminar', 'finalmente', 'por otra parte', 'en cuanto a', 'acerca de', 'con relación a', 'por tanto', 'por consiguiente', 'como resultado', 'por lo cual', 'de ahí que', 'sin embargo', 'no obstante', 'en cambio', 'por el contrario', 'en mi opinión', 'desde mi perspectiva', 'considero', 'es decir', 'en efecto', 'dicho de otra manera', 'en conclusión', 'en resumen'];

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
    const ids = ['drop-zone', 'file-input', 'folder-input', 'btn-folder', 'folder-fallback-msg', 'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip', 'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count', 'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 'btn-cancel', 'cdn-alert', 'cdn-alert-text'];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

function escapeHTML(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function formatFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
function getFileTypeIcon(type) { if (type === 'pdf') return '📄'; if (type === 'docx') return '📝'; if (type === 'zip') return '📦'; return '📎'; }
function detectFileType(file) { const name = file.name.toLowerCase(); if (name.endsWith('.pdf')) return 'pdf'; if (name.endsWith('.docx')) return 'docx'; if (name.endsWith('.zip')) return 'zip'; return 'other'; }

// ─── Extracción de Identidad del Estudiante ───
function extractStudentIdentity(fileName, text) {
    // 1. Buscar patrones de encabezado en el texto
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
    // 2. Fallback: nombre del archivo sin extensión
    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ─── Detección de Subtítulos ───
function detectSubtitles(text) {
    const lineas = text.split(/\n/).filter(l => l.trim().length > 0);
    let count = 0;
    const patronesSubtitulo = [
        /^(introducción|desarrollo|conclusión|conclusiones|anexos|bibliografía|referencias|índice|resumen|abstract)$/im,
        /^(capítulo|tema|sección|unidad|módulo)\s*(n[°º]?\s*)?\d/i,
        /^\d{1,2}[\.\)]\s+[A-ZÁÉÍÓÚÑ]/,  // 1. Título, 2) Título
        /^[IVX]+[\.\)]\s+[A-ZÁÉÍÓÚÑ]/,    // I. Título, II) Título
        /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{4,40}$/ // Línea corta en mayúsculas
    ];
    for (const linea of lineas) {
        for (const p of patronesSubtitulo) {
            if (p.test(linea.trim())) { count++; break; }
        }
    }
    return { count, penaliza: count > 3 };
}

// ─── Evaluación de Bibliografía ───
function evaluateBibliografia(text) {
    const idxBib = text.search(/\b(bibliografía|referencias|fuentes\s+consultadas)\b/i);
    if (idxBib === -1) {
        return { ok: false, observacion: '❌ No se encontró sección de Bibliografía/Referencias.' };
    }
    const bloqueBib = text.substring(idxBib);
    const enlaces = bloqueBib.match(/https?:\/\/[^\s]+/gi) || [];
    if (enlaces.length < 3) {
        return { ok: false, observacion: `⚠️ Bibliografía presente pero solo ${enlaces.length} enlace(s). Se requieren al menos 3 fuentes con URL.` };
    }
    // Verificar orden alfabético aproximado
    const lineas = bloqueBib.split(/\n/).filter(l => /^[a-záéíóúñ]/.test(l.trim().toLowerCase()));
    let ordenado = true;
    for (let i = 1; i < Math.min(lineas.length, 10); i++) {
        if (lineas[i].trim().toLowerCase() < lineas[i-1].trim().toLowerCase()) {
            ordenado = false; break;
        }
    }
    if (!ordenado) {
        return { ok: false, observacion: `⚠️ Bibliografía con ${enlaces.length} enlaces, pero no está en orden alfabético estricto.` };
    }
    return { ok: true, observacion: `✅ Bibliografía completa con ${enlaces.length} fuentes en orden alfabético.` };
}

// ═══════════════════════════════════════════════════════════
// NUEVO MOTOR DE EVALUACIÓN EQUITATIVA
// ═══════════════════════════════════════════════════════════

/**
 * Detecta si un tema está presente en el texto usando su diccionario C1.
 * Un tema se considera presente si tiene al menos 2 palabras clave del diccionario.
 */
function detectarTema(temaKey, text) {
    const dic = TEMAS[temaKey];
    const matches = [];
    let score = 0;
    for (const word of dic.c1) {
        const regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        const found = (text.match(regex) || []).length;
        if (found > 0) {
            matches.push(word);
            score += found;
        }
    }
    return { presente: matches.length >= 2, matches, score };
}

/**
 * C1: Normativa Perú (0-5 pts)
 * Cada tema detectado con explicación y sustento = 1.5 pts.
 * 3 temas = 4.5 pts base.
 * Plus de 0.5 si los 3 temas están presentes Y hay al menos 1 ley/N° explícita.
 */
function evaluateC1(text) {
    const resultados = {};
    let temasDetectados = 0;
    const observaciones = [];

    for (const [key, tema] of Object.entries(TEMAS)) {
        const deteccion = detectarTema(key, text);
        resultados[key] = deteccion;
        if (deteccion.presente) {
            temasDetectados++;
        } else {
            observaciones.push('Tema "' + tema.label + '" no detectado o sin sustento normativo.');
        }
    }

    let puntaje = temasDetectados * 1.5;

    const tieneLeyExplicita = /(ley\s*(n°|nº|nro|núm)?\s*\d{3,5}|decreto\s*(supremo|legislativo|de urgencia)?\s*(n°|nº|nro|núm)?\s*\d{2,5}|d\.?s\.?\s*(n°|nº|nro|núm)?\s*\d{2,5}|constitución\s*política)/gi.test(text);

    if (temasDetectados === 3 && tieneLeyExplicita) {
        puntaje = 5.0;
        observaciones.push('✅ Plus 0.5: los 3 temas con referencias normativas explícitas del Perú.');
    } else if (temasDetectados === 3 && !tieneLeyExplicita) {
        puntaje = 4.5;
        observaciones.push('⚠️ Los 3 temas presentes, pero falta citar una ley/N° explícita para el plus 0.5.');
    }

    return { puntaje: Math.min(5, puntaje), temasDetectados, detalle: resultados, observaciones };
}

/**
 * C2: Casos Reales Peruanos (0-7 pts)
 * Cada tema con evidencia = 2.0 pts. 3 temas = 6.0 pts base.
 * Plus de 1.0 si hay enlaces verificables (URLs) en al menos 2 temas.
 */
function evaluateC2(text) {
    const resultados = {};
    let temasConEvidencia = 0;
    let temasConEnlace = 0;
    const observaciones = [];
    const enlaces = text.match(/https?:\/\/[^\s]+/gi) || [];

    for (const [key, tema] of Object.entries(TEMAS)) {
        let matchCount = 0;
        for (const word of tema.c2) {
            const regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
            matchCount += (text.match(regex) || []).length;
        }
        const presente = matchCount >= 2;
        const tieneEnlace = enlaces.length > 0 && presente;
        resultados[key] = { presente, matchCount, tieneEnlace };
        if (presente) {
            temasConEvidencia++;
            if (tieneEnlace) temasConEnlace++;
        } else {
            observaciones.push('Tema "' + tema.label + '" sin evidencia de caso real peruano.');
        }
    }

    let puntaje = temasConEvidencia * 2.0;

    if (temasConEvidencia === 3 && temasConEnlace >= 2) {
        puntaje = 7.0;
        observaciones.push('✅ Plus 1.0: evidencia con enlaces verificables en al menos 2 temas.');
    } else if (temasConEvidencia === 3 && temasConEnlace < 2) {
        puntaje = 6.0;
        observaciones.push('⚠️ Los 3 temas con evidencia, pero faltan enlaces verificables para el plus 1.0.');
    } else if (enlaces.length === 0) {
        observaciones.push('❌ No se encontraron enlaces verificables en ningún tema.');
    }

    return { puntaje: Math.min(7, puntaje), temasConEvidencia, temasConEnlace, totalEnlaces: enlaces.length, detalle: resultados, observaciones };
}

/**
 * C3: Ética y Rol de RR.HH. (0-8 pts)
 * Evaluación precisa con 3 sub-criterios:
 *   3A. Postura ética explícita (0-2.5 pts)
 *   3B. Rol estratégico de RR.HH. (0-2.5 pts)
 *   3C. Acciones estratégicas por tema (0-3.0 pts) — 1 idea sustantiva por tema = 1.0 pt
 * Se aísla el último 30% del texto como bloque de reflexión.
 */
function evaluateC3(text, resultadosC1) {
    const observaciones = [];

    const palabras = text.split(/\s+/);
    const puntoCorte = Math.floor(palabras.length * 0.7);
    const bloqueReflexion = palabras.slice(puntoCorte).join(' ');
    const textoCompleto = text;

    // 3A. Postura ética explícita (0-2.5 pts)
    const marcadoresEtica = ['ética', 'código de ética', 'postura', 'moral', 'valores', 'principios', 'deontología', 'integridad', 'responsabilidad', 'transparencia'];
    let scoreEtica = 0;
    for (const m of marcadoresEtica) {
        const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        scoreEtica += (bloqueReflexion.match(regex) || []).length;
    }
    const ptsEtica = scoreEtica >= 5 ? 2.5 : scoreEtica >= 2 ? 1.5 : scoreEtica >= 1 ? 0.8 : 0;
    if (ptsEtica < 1.5) observaciones.push('Postura ética débil o ausente en la reflexión final.');

    // 3B. Rol estratégico de RR.HH. (0-2.5 pts)
    const marcadoresRRHH = ['recursos humanos', 'rr.hh', 'rrhh', 'gestión humana', 'talento humano', 'área de personal', 'departamento de rrhh', 'profesional de rrhh', 'gestor', 'liderazgo', 'cultura organizacional', 'clima laboral'];
    let scoreRRHH = 0;
    for (const m of marcadoresRRHH) {
        const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        scoreRRHH += (bloqueReflexion.match(regex) || []).length;
    }
    const ptsRRHH = scoreRRHH >= 4 ? 2.5 : scoreRRHH >= 2 ? 1.5 : scoreRRHH >= 1 ? 0.8 : 0;
    if (ptsRRHH < 1.5) observaciones.push('No se atribuyen acciones concretas al profesional de RR.HH.');

    // 3C. Acciones estratégicas por tema (0-3.0 pts)
    const temasDetectados = resultadosC1 ? resultadosC1.temasDetectados : 0;
    let ptsAcciones = 0;
    if (temasDetectados >= 1) {
        const marcadoresAccion = ['protocolo', 'capacitación', 'prevención', 'estrategia', 'plan', 'política', 'programa', 'intervención', 'sensibilización', 'monitoreo', 'evaluación', 'mejora', 'implementar', 'diseñar', 'ejecutar', 'supervisar'];
        let scoreAccion = 0;
        for (const m of marcadoresAccion) {
            const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
            scoreAccion += (textoCompleto.match(regex) || []).length;
        }
        ptsAcciones = Math.min(3.0, temasDetectados * 1.0);
        if (scoreAccion < temasDetectados * 2) {
            ptsAcciones = Math.min(3.0, Math.max(0.5, scoreAccion * 0.3));
            observaciones.push('Las acciones estratégicas por tema son genéricas; falta profundidad.');
        }
    } else {
        observaciones.push('Sin temas detectados en C1, no se pueden evaluar acciones por tema.');
    }

    const puntaje = Math.round((ptsEtica + ptsRRHH + ptsAcciones) * 10) / 10;

    if (puntaje >= 7) observaciones.push('✅ Reflexión ética sólida con acciones estratégicas claras para RR.HH.');
    else if (puntaje >= 5) observaciones.push('⚠️ Reflexión aceptable pero requiere mayor profundidad ética y estratégica.');
    else observaciones.push('❌ La reflexión ética y el rol de RR.HH. son insuficientes.');

    return { puntaje: Math.min(8, puntaje), detalle: { ptsEtica, ptsRRHH, ptsAcciones }, observaciones };
}

/**
 * Evaluación consolidada: orquesta C1 + C2 + C3 + extensión + subtítulos + bibliografía
 */
function evaluateContent(fileName, text) {
    const obs = [];
    const wordCount = text.split(/\s+/).filter(function(w) { return w.length > 1; }).length;

    // ── Extensión textual ──
    if (wordCount < 700) obs.push('⚠️ Extensión baja (' + wordCount + ' palabras). Falta profundidad argumentativa.');
    else if (wordCount < 1000) obs.push('📝 Extensión aceptable (' + wordCount + ' palabras). Podría ampliarse.');
    else obs.push('✅ Extensión adecuada (' + wordCount + ' palabras). Abundancia argumentativa.');

    // ── Penalización de subtítulos ──
    const subtitulos = detectSubtitles(text);
    if (subtitulos.count > 3) obs.push('❌ Se detectaron ' + subtitulos.count + ' subtítulos. La redacción debe ser puramente narrativa.');
    else if (subtitulos.count > 0) obs.push('⚠️ Se detectaron ' + subtitulos.count + ' subtítulos. Evitar estructuras de informe.');

    // ── C1: Normativa Perú ──
    const resC1 = evaluateC1(text);
    obs.push('C1: ' + resC1.puntaje + '/5 — ' + resC1.temasDetectados + '/3 temas con normativa.');
    obs.push.apply(obs, resC1.observaciones);

    // ── C2: Casos Reales ──
    const resC2 = evaluateC2(text);
    obs.push('C2: ' + resC2.puntaje + '/7 — ' + resC2.temasConEvidencia + '/3 temas con evidencia (' + resC2.totalEnlaces + ' enlaces).');
    obs.push.apply(obs, resC2.observaciones);

    // ── C3: Ética y RR.HH. ──
    const resC3 = evaluateC3(text, resC1);
    obs.push('C3: ' + resC3.puntaje + '/8 — Ética: ' + resC3.detalle.ptsEtica + ' | RRHH: ' + resC3.detalle.ptsRRHH + ' | Acciones: ' + resC3.detalle.ptsAcciones);
    obs.push.apply(obs, resC3.observaciones);

    // ── Conectores ──
    let conectores = 0;
    CONECTORES.forEach(function(c) { if (text.includes(c)) conectores++; });
    if (conectores < 3) obs.push('Fortalecer uso de conectores lógicos.');

    // ── Bibliografía ──
    const resBib = evaluateBibliografia(text);
    obs.push(resBib.observacion);

    // ── Nota final ──
    const notaFinal = Math.round((resC1.puntaje + resC2.puntaje + resC3.puntaje) * 10) / 10;
    const estudiante = extractStudentIdentity(fileName, text);

    return {
        estudiante: estudiante,
        c1: resC1.puntaje,
        c2: resC2.puntaje,
        c3: resC3.puntaje,
        notaFinal: notaFinal,
        wordCount: wordCount,
        conectoresHallados: conectores,
        bibliografia: resBib,
        observacion: obs.join(' | ')
    };
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
        fullText += textContent.items.map(function(item) { return item.str; }).join(' ') + ' ';
        page.cleanup();

        DOM['status-text'].innerHTML =
            '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
            '<span>Leyendo: <strong>' + file.name.substring(0, 25) + '...</strong></span>' +
            '<span>Página ' + i + ' de ' + pdf.numPages + '</span>' +
            '<progress value="' + i + '" max="' + pdf.numPages + '" style="width:100%;height:6px;border-radius:3px;"></progress>' +
            '</div>';
        await yieldUI();
    }

    await loadingTask.destroy();
    arrayBuffer = null;
    return fullText.toLowerCase();
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    DOM['status-text'].innerHTML =
        '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
        '<span>Leyendo: <strong>' + file.name.substring(0, 25) + '...</strong></span>' +
        '<span>Extrayendo DOCX...</span>' +
        '<progress style="width:100%;height:6px;border-radius:3px;"></progress>' +
        '</div>';
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    let text = result.value.toLowerCase();
    arrayBuffer = null;
    result = null;
    return text;
}

async function extractFilesFromZip(zipFile) {
    let extracted = [];
    const zip = await JSZip.loadAsync(zipFile);
    const entries = Object.values(zip.files).filter(function(entry) { return !entry.dir; });

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

// ─── UI: Lista de archivos ───
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
    archivosDetectados.forEach(function(f) {
        if (f.type === 'pdf') cPDF++;
        else if (f.type === 'docx') cDOCX++;
        else if (f.type === 'zip') cZIP++;
    });
    var ts = function(el, c) {
        if (c > 0) { el.classList.remove('hidden'); el.textContent = el.textContent.replace(/\d+/, c); }
        else el.classList.add('hidden');
    };
    ts(DOM['stat-pdf'], cPDF);
    ts(DOM['stat-docx'], cDOCX);
    ts(DOM['stat-zip'], cZIP);

    archivosDetectados.forEach(function(f, i) {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        chip.innerHTML =
            '<span class="chip-icon">' + getFileTypeIcon(f.type) + '</span> ' +
            '<span title="' + escapeHTML(f.name) + '">' + escapeHTML(f.name.length > 25 ? f.name.slice(0, 22) + '...' : f.name) + '</span> ' +
            '<button class="chip-remove" data-index="' + i + '">&times;</button>';
        listEl.appendChild(chip);
    });
    listEl.querySelectorAll('.chip-remove').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (isProcessing) return;
            archivosDetectados.splice(parseInt(btn.dataset.index), 1);
            updateFileListUI();
        });
    });
}

async function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type) && !archivosDetectados.some(function(f) { return f.name === files[i].name && f.size === files[i].size; })) {
            archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
            added++;
        }
    }
    if (added > 0) updateFileListUI();
}

// ─── Panel de errores ───
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
    DOM['btn-cancel'].classList.remove('hidden');

    try {
        let cola = archivosDetectados.slice();
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;

            let item = cola.shift();

            if (item.type === 'zip') {
                DOM['loading-detail'].textContent = 'Extrayendo ZIP: ' + item.name + '...';
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    for (let e = extracted.length - 1; e >= 0; e--) {
                        cola.unshift(extracted[e]);
                    }
                    total += extracted.length - 1;
                } catch (e) {
                    addError(item.name, 'Error ZIP: ' + e.message);
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
                    addError(item.name, 'Documento vacío o ilegible.');
                } else {
                    resultadosEvaluacion.push(evaluateContent(item.name, text));
                }
                text = null;
            } catch (err) {
                addError(item.name, 'Error: ' + err.message);
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
            DOM['status-text'].textContent = '¡Completado! Evaluados ' + resultadosEvaluacion.length + ' de ' + archivosDetectados.length + ' archivos.';
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            DOM['btn-clear'].disabled = false;
            renderTable();
            saveState();
        } else {
            DOM['status-text'].textContent = 'Ocurrió un error general o no hubo archivos válidos.';
        }
    }
}

// ─── Render de Tabla ───
function renderTable(fText) {
    fText = fText || '';
    const tbody = DOM['table-body'];
    tbody.innerHTML = '';
    let sorted = resultadosEvaluacion.slice();
    if (sortColumn) {
        sorted.sort(function(a, b) {
            let vA = a[sortColumn], vB = b[sortColumn];
            if (typeof vA === 'string') vA = vA.toLowerCase();
            if (typeof vB === 'string') vB = vB.toLowerCase();
            if (vA < vB) return sortDirection === 'asc' ? -1 : 1;
            if (vA > vB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }
    let fil = fText ? sorted.filter(function(r) { return r.estudiante.toLowerCase().includes(fText.toLowerCase()); }) : sorted;
    if (fil.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos.</td></tr>';
        DOM['results-count'].classList.add('hidden');
        return;
    }
    DOM['results-count'].classList.remove('hidden');
    DOM['results-count'].textContent = 'Mostrando ' + fil.length + ' de ' + resultadosEvaluacion.length;
    fil.forEach(function(r) {
        const idx = resultadosEvaluacion.indexOf(r) + 1;
        const badgeClass = r.notaFinal >= 14 ? 'badge-success' : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const bibIcon = r.bibliografia && r.bibliografia.ok ? '✅' : '❌';
        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + idx + '</td>' +
            '<td><strong>' + escapeHTML(r.estudiante) + '</strong></td>' +
            '<td>' + r.c1 + ' / 5</td>' +
            '<td>' + r.c2 + ' / 7</td>' +
            '<td>' + r.c3 + ' / 8</td>' +
            '<td><span class="badge ' + badgeClass + '">' + r.notaFinal + '</span></td>' +
            '<td>' + r.wordCount + ' palabras</td>' +
            '<td>' + bibIcon + '</td>' +
            '<td style="font-size:0.82rem;">' + escapeHTML(r.observacion) + '</td>';
        tbody.appendChild(tr);
    });
}

// ─── Ordenamiento de tabla ───
function setupSortableHeaders() {
    const headers = document.querySelectorAll('.results-table th.sortable');
    headers.forEach(function(th) {
        th.addEventListener('click', function() {
            const col = th.dataset.sort;
            if (sortColumn === col) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = col;
                sortDirection = 'asc';
            }
            headers.forEach(function(h) { h.classList.remove('asc', 'desc'); });
            th.classList.add(sortDirection);
            renderTable(DOM['filter-input'] ? DOM['filter-input'].value : '');
        });
    });
}

// ─── Persistencia en sessionStorage ───
function saveState() {
    try {
        const state = {
            resultados: resultadosEvaluacion,
            archivos: archivosDetectados.map(function(f) { return { name: f.name, type: f.type, size: f.size }; })
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
            DOM['btn-export-pdf'].disabled = false;
            DOM['btn-export-csv'].disabled = false;
            DOM['btn-clear'].disabled = false;
            renderTable();
            DOM['status-text'].textContent = 'Sesión restaurada: ' + resultadosEvaluacion.length + ' evaluaciones previas.';
        }
    } catch (e) { /* ignorar */ }
}

// ─── Limpieza total ───
function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg">Sube archivos para iniciar la evaluación.</td></tr>';
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
    updateFileListUI();
    sessionStorage.removeItem('evaluador_state');
}

// ─── Exportación CSV ───
function exportCSV() {
    let csvContent = '\uFEFF'; // BOM para tildes en Excel
    csvContent += 'Estudiante,C1 Normativa(5P),C2 Evidencias(7P),C3 Ética RRHH(8P),Nota Final,Extensión,Conectores,Bibliografía,Observaciones\n';
    resultadosEvaluacion.forEach(function(r) {
        csvContent += '"' + r.estudiante + '",' + r.c1 + ',' + r.c2 + ',' + r.c3 + ',' + r.notaFinal + ',' + r.wordCount + ',' + r.conectoresHallados + ',"' + (r.bibliografia && r.bibliografia.ok ? 'OK' : 'Falta') + '","' + r.observacion + '"\n';
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Reporte_Evaluacion_RRHH.csv';
    link.click();
}

// ─── Exportación PDF ───
function exportPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(16);
    doc.text('Reporte Consolidado de Evaluación Académica', 14, 15);
    doc.setFontSize(10);
    doc.text('Programa de Gestión Humana y Derecho Laboral | Escala Vigesimal (0-20)', 14, 22);
    doc.text('Generado: ' + new Date().toLocaleDateString('es-PE'), 14, 28);

    const tableData = resultadosEvaluacion.map(function(r, i) {
        return [
            i + 1,
            r.estudiante,
            r.c1 + '/5',
            r.c2 + '/7',
            r.c3 + '/8',
            r.notaFinal + '/20',
            r.wordCount + ' pal.',
            r.bibliografia && r.bibliografia.ok ? 'OK' : 'Falta',
            r.observacion.substring(0, 120)
        ];
    });

    doc.autoTable({
        startY: 34,
        head: [['#', 'Estudiante', 'C1 (5P)', 'C2 (7P)', 'C3 (8P)', 'Nota', 'Extensión', 'Bib.', 'Observaciones']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 119, 182] },
        styles: { fontSize: 7 },
        columnStyles: {
            0: { cellWidth: 10 },
            1: { cellWidth: 40 },
            8: { cellWidth: 70 }
        }
    });

    doc.save('Reporte_Consolidado_Evaluaciones.pdf');
}

// ─── Recolección de archivos desde carpetas arrastradas ───
async function collectFilesFromDataTransfer(dataTransfer) {
    const files = [];
    if (dataTransfer.items && dataTransfer.items.length > 0) {
        const entries = [];
        for (let i = 0; i < dataTransfer.items.length; i++) {
            const item = dataTransfer.items[i];
            const getAsEntry = item.webkitGetAsEntry || item.getAsEntry;
            if (getAsEntry) {
                const entry = getAsEntry.call(item);
                if (entry) entries.push(entry);
            }
        }
        if (entries.length > 0) {
            for (const entry of entries) {
                await readEntry(entry, files);
            }
            return files;
        }
    }
    return Array.from(dataTransfer.files || []);
}

async function readEntry(entry, files) {
    if (entry.isFile) {
        return new Promise(function(resolve) {
            entry.file(function(file) {
                files.push(file);
                resolve();
            });
        });
    } else if (entry.isDirectory) {
        const reader = entry.createReader();
        return new Promise(function(resolve) {
            reader.readEntries(async function(entries) {
                for (const e of entries) {
                    await readEntry(e, files);
                }
                resolve();
            });
        });
    }
}

// ─── Configuración de Eventos ───
function setupEvents() {
    // Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(ev) {
        DOM['drop-zone'].addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); });
    });
    DOM['drop-zone'].addEventListener('dragover', function() { DOM['drop-zone'].classList.add('dragover'); });
    DOM['drop-zone'].addEventListener('dragleave', function(e) {
        if (!DOM['drop-zone'].contains(e.relatedTarget)) {
            DOM['drop-zone'].classList.remove('dragover');
        }
    });
    DOM['drop-zone'].addEventListener('drop', async function(e) {
        DOM['drop-zone'].classList.remove('dragover');
        if (isProcessing) return;
        const files = await collectFilesFromDataTransfer(e.dataTransfer);
        await addFilesToList(files);
        if (archivosDetectados.length > 0) processAllFiles();
    });

    // Input de archivos
    DOM['file-input'].addEventListener('change', async function(e) {
        let f = Array.from(e.target.files);
        e.target.value = '';
        if (f.length > 0) { await addFilesToList(f); processAllFiles(); }
    });

    // Input de carpeta
    if (DOM['folder-input']) {
        DOM['folder-input'].addEventListener('change', async function(e) {
            let f = Array.from(e.target.files);
            e.target.value = '';
            if (f.length > 0) { await addFilesToList(f); processAllFiles(); }
        });
    }

    // Botón de carpeta
    if (DOM['btn-folder']) {
        DOM['btn-folder'].addEventListener('click', function() {
            if (DOM['folder-input']) DOM['folder-input'].click();
        });
    }

    // Click en dropzone
    DOM['drop-zone'].addEventListener('click', function(e) {
        if (e.target === DOM['drop-zone'] || e.target.closest('.drop-zone-content')) {
            DOM['file-input'].click();
        }
    });

    // Teclado en dropzone
    DOM['drop-zone'].addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            DOM['file-input'].click();
        }
    });

    // Botones
    DOM['btn-clear'].addEventListener('click', clearAll);
    DOM['btn-cancel'].addEventListener('click', function() {
        if (abortController) abortController.abort();
        isProcessing = false;
        DOM['loading-overlay'].classList.add('hidden');
    });
    DOM['btn-export-csv'].addEventListener('click', exportCSV);
    DOM['btn-export-pdf'].addEventListener('click', exportPDF);

    // Dismiss errores
    if (DOM['btn-dismiss-errors']) {
        DOM['btn-dismiss-errors'].addEventListener('click', function() {
            DOM['error-panel'].classList.add('hidden');
            DOM['error-list'].innerHTML = '';
        });
    }

    // Filtro
    if (DOM['filter-input']) {
        DOM['filter-input'].addEventListener('input', function() {
            renderTable(this.value);
        });
    }

    // Ordenamiento
    setupSortableHeaders();
}

// ─── Inicialización ───
function init() {
    cacheDOM();
    if (checkDependencies()) {
        configurePDFJS();
        setupEvents();
        loadState();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
