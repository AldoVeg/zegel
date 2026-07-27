/* ============================================================
   index.js — Motor de Evaluación Automatizada (Equidad Evaluativa)
   C1: Normativa - T1(Beneficios), T2(Acoso), T3(Flexibilidad)
   C2: Evidencia - Casos/Noticias de T1, T2 y T3
   C3: Reflexión - Ética, Rol RRHH, Acciones estratégicas
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

// ─── Detección de Subtítulos ───
function detectSubtitles(text) {
    const lineas = text.split(/\n/).filter(l => l.trim().length > 0);
    let count = 0;
    const patronesSubtitulo = [
        /^(introducción|desarrollo|conclusión|conclusiones|anexos|bibliografía|referencias|índice|resumen|abstract)$/im,
        /^(capítulo|tema|sección|unidad|módulo)\s*(n[°º]?\s*)?\d/i,
        /^\d{1,2}[\.\)]\s+[A-ZÁÉÍÓÚÑ]/,
        /^[IVX]+[\.\)]\s+[A-ZÁÉÍÓÚÑ]/,
        /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{4,40}$/
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
    if (idxBib === -1) return { ok: false, observacion: '❌ No se encontró sección de Bibliografía.' };
    
    const bloqueBib = text.substring(idxBib);
    const enlaces = bloqueBib.match(/https?:\/\/[^\s]+/gi) || [];
    if (enlaces.length < 3) return { ok: false, observacion: `⚠️ Solo ${enlaces.length} enlace(s). Se requieren al menos 3 fuentes.` };
    
    const lineas = bloqueBib.split(/\n/).filter(l => /^[a-záéíóúñ]/.test(l.trim().toLowerCase()));
    let ordenado = true;
    for (let i = 1; i < Math.min(lineas.length, 10); i++) {
        if (lineas[i].trim().toLowerCase() < lineas[i-1].trim().toLowerCase()) {
            ordenado = false; break;
        }
    }
    if (!ordenado) return { ok: false, observacion: `⚠️ Bibliografía con ${enlaces.length} enlaces, pero no en orden alfabético estricto.` };
    
    return { ok: true, observacion: `✅ Bibliografía completa con ${enlaces.length} fuentes en orden alfabético.` };
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN
// ═══════════════════════════════════════════════════════════

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

// C1: Normativa Perú
function evaluateC1(text) {
    const resultados = {};
    let temasDetectados = 0;
    const observaciones = [];

    for (const [key, tema] of Object.entries(TEMAS)) {
        const deteccion = detectarTema(key, text);
        resultados[key] = deteccion;
        if (deteccion.presente) temasDetectados++;
        else observaciones.push('Falta desarrollo normativo del tema: ' + tema.label);
    }

    let puntaje = temasDetectados * 1.5;
    const tieneLeyExplicita = /(ley\s*(n°|nº|nro|núm)?\s*\d{3,5}|decreto\s*(supremo|legislativo|de urgencia)?\s*(n°|nº|nro|núm)?\s*\d{2,5}|d\.?s\.?\s*(n°|nº|nro|núm)?\s*\d{2,5}|constitución\s*política)/gi.test(text);

    if (temasDetectados === 3 && tieneLeyExplicita) {
        puntaje = 5.0;
        observaciones.push('✅ Plus 0.5: 3 temas con referencias normativas explícitas.');
    } else if (temasDetectados === 3 && !tieneLeyExplicita) {
        puntaje = 4.5;
    }

    return { puntaje: Math.min(5, puntaje), temasDetectados, detalle: resultados, observaciones };
}

// C2: Casos Reales Peruanos
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
            observaciones.push('Falta evidencia de caso real para: ' + tema.label);
        }
    }

    let puntaje = temasConEvidencia * 2.0;

    if (temasConEvidencia === 3 && temasConEnlace >= 2) {
        puntaje = 7.0;
        observaciones.push('✅ Plus 1.0: Casos reales con enlaces verificables en temas.');
    }

    return { puntaje: Math.min(7, puntaje), temasConEvidencia, detalle: resultados, observaciones };
}

// C3: Ética y Rol de RR.HH.
function evaluateC3(text, resultadosC1) {
    const observaciones = [];
    const palabras = text.split(/\s+/);
    const puntoCorte = Math.floor(palabras.length * 0.7);
    const bloqueReflexion = palabras.slice(puntoCorte).join(' ');

    const marcadoresEtica = ['ética', 'código de ética', 'postura', 'moral', 'valores', 'principios', 'deontología', 'integridad', 'responsabilidad', 'transparencia'];
    let scoreEtica = 0;
    for (const m of marcadoresEtica) {
        const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        scoreEtica += (bloqueReflexion.match(regex) || []).length;
    }
    const ptsEtica = scoreEtica >= 5 ? 2.5 : scoreEtica >= 2 ? 1.5 : scoreEtica >= 1 ? 0.8 : 0;
    if (ptsEtica < 1.5) observaciones.push('Postura ética débil.');

    const marcadoresRRHH = ['recursos humanos', 'rr.hh', 'rrhh', 'gestión humana', 'talento humano', 'área de personal', 'departamento de rrhh', 'profesional', 'liderazgo', 'cultura organizacional'];
    let scoreRRHH = 0;
    for (const m of marcadoresRRHH) {
        const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        scoreRRHH += (bloqueReflexion.match(regex) || []).length;
    }
    const ptsRRHH = scoreRRHH >= 4 ? 2.5 : scoreRRHH >= 2 ? 1.5 : scoreRRHH >= 1 ? 0.8 : 0;
    if (ptsRRHH < 1.5) observaciones.push('Falta rol del profesional de RR.HH.');

    const temasDetectados = resultadosC1 ? resultadosC1.temasDetectados : 0;
    let ptsAcciones = 0;
    if (temasDetectados >= 1) {
        const marcadoresAccion = ['protocolo', 'capacitación', 'prevención', 'estrategia', 'plan', 'política', 'programa', 'intervención', 'sensibilización', 'monitoreo', 'mejora', 'implementar'];
        let scoreAccion = 0;
        for (const m of marcadoresAccion) {
            const regex = new RegExp('\\b' + m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
            scoreAccion += (text.match(regex) || []).length;
        }
        ptsAcciones = Math.min(3.0, temasDetectados * 1.0);
        if (scoreAccion < temasDetectados * 2) {
            ptsAcciones = Math.min(3.0, Math.max(0.5, scoreAccion * 0.3));
        }
    }

    const puntaje = Math.round((ptsEtica + ptsRRHH + ptsAcciones) * 10) / 10;
    return { puntaje: Math.min(8, puntaje), detalle: { ptsEtica, ptsRRHH, ptsAcciones }, observaciones };
}

// Orquestador de Evaluación 
function evaluateContent(fileName, text) {
    const obs = [];
    const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;

    if (wordCount < 700) obs.push('⚠️ Extensión baja (' + wordCount + ' pal).');
    else if (wordCount < 1000) obs.push('📝 Extensión aceptable (' + wordCount + ' pal).');
    else obs.push('✅ Extensión adecuada (' + wordCount + ' pal).');

    const subtitulos = detectSubtitles(text);
    if (subtitulos.count > 3) obs.push('❌ Subtítulos detectados (' + subtitulos.count + '). Debe ser narrativa.');

    // ── C1: Normativa Perú (Checks por Tema 1, 2, 3) ──
    const resC1 = evaluateC1(text);
    const checksC1 = (resC1.detalle.beneficios.presente ? '✅' : '❌') + 
                     (resC1.detalle.acoso.presente ? '✅' : '❌') + 
                     (resC1.detalle.flexibilidad.presente ? '✅' : '❌');
    obs.push.apply(obs, resC1.observaciones);

    // ── C2: Casos Reales (Checks por Evidencia T1, T2, T3) ──
    const resC2 = evaluateC2(text);
    const checksC2 = (resC2.detalle.beneficios.presente ? '✅' : '❌') + 
                     (resC2.detalle.acoso.presente ? '✅' : '❌') + 
                     (resC2.detalle.flexibilidad.presente ? '✅' : '❌');
    obs.push.apply(obs, resC2.observaciones);

    // ── C3: Ética y RR.HH. (Checks por Ética, Postura RRHH, Acciones) ──
    const resC3 = evaluateC3(text, resC1);
    const checksC3 = (resC3.detalle.ptsEtica >= 0.8 ? '✅' : '❌') + 
                     (resC3.detalle.ptsRRHH >= 0.8 ? '✅' : '❌') + 
                     (resC3.detalle.ptsAcciones > 0 ? '✅' : '❌');
    obs.push.apply(obs, resC3.observaciones);

    // Conectores & Bibliografía
    let conectores = 0;
    CONECTORES.forEach(c => { if (text.includes(c)) conectores++; });
    if (conectores < 3) obs.push('Faltan conectores lógicos.');

    const resBib = evaluateBibliografia(text);
    obs.push(resBib.observacion);

    const notaFinal = Math.round((resC1.puntaje + resC2.puntaje + resC3.puntaje) * 10) / 10;
    const estudiante = extractStudentIdentity(fileName, text);

    return {
        estudiante: estudiante,
        c1: resC1.puntaje,
        c1Checks: checksC1,
        c2: resC2.puntaje,
        c2Checks: checksC2,
        c3: resC3.puntaje,
        c3Checks: checksC3,
        notaFinal: notaFinal,
        wordCount: wordCount,
        conectoresHallados: conectores,
        bibliografia: resBib,
        observacion: obs.join(' | ')
    };
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
        page.cleanup(); // Liberar memoria de la página

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
    return fullText.toLowerCase();
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    if (DOM['status-text']) {
        DOM['status-text'].innerHTML = 'Extrayendo DOCX: <strong>' + file.name.substring(0, 25) + '...</strong>';
    }
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

// ─── PROCESAMIENTO ESTRICTO EN FILA INDIA ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

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
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Procesando ' + procesados + ' de ' + total;
            if (DOM['overlay-progress']) DOM['overlay-progress'].value = Math.round((procesados / total) * 100);
            if (DOM['overlay-percent']) DOM['overlay-percent'].textContent = Math.round((procesados / total) * 100) + '%';
            if (DOM['progress-bar']) DOM['progress-bar'].value = Math.round((procesados / total) * 100);

            try {
                let text = '';
                if (item.type === 'pdf') text = await extractTextFromPDF(item.file);
                else if (item.type === 'docx') text = await extractTextFromDOCX(item.file);

                if (!text || text.trim().length < 50) addError(item.name, 'Documento vacío o ilegible.');
                else resultadosEvaluacion.push(evaluateContent(item.name, text));
                text = null;
            } catch (err) {
                addError(item.name, 'Error: ' + err.message);
            }

            item.file = null; item = null;
            await yieldUI();
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
            if (DOM['status-text']) DOM['status-text'].textContent = 'No hubo archivos válidos o proceso cancelado.';
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
        // Aquí se inyectan los Checks visuales (✅/❌) exactamente debajo del puntaje.
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
