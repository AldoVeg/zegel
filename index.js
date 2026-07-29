/* ============================================================
   index.js — Auditor Estructural de Evaluación Automatizada
   (FORTALECIDO: Normalización N°, C3 Desacoplado, Umbral 20)
   ============================================================ */

// ─── Verificación de Dependencias CDN ───
const REQUIRED_LIBS = {
    pdfjsLib: 'PDF.js',
    jspdf: 'jsPDF',
    mammoth: 'Mammoth.js',
    JSZip: 'JSZip'
};

function checkDependencies() {
    const missing = [];
    for (const key in REQUIRED_LIBS) {
        if (typeof window[key] === 'undefined' && key !== 'jspdf') {
            missing.push(REQUIRED_LIBS[key]);
        } else if (key === 'jspdf' && typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            missing.push(REQUIRED_LIBS[key]);
        }
    }
    const alertEl = document.getElementById('cdn-alert');
    const alertText = document.getElementById('cdn-alert-text');
    
    if (alertEl && alertText) {
        if (missing.length > 0) {
            alertEl.classList.remove('hidden');
            alertText.textContent = 'Aviso: Faltan librerías (' + missing.join(', ') + '). Algunas funciones podrían no estar disponibles.';
        } else {
            alertEl.classList.add('hidden');
        }
    }
}

function configurePDFJS() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ─── Utilidades ───
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getFileTypeIcon(type) {
    if (type === 'pdf') return '📄';
    if (type === 'docx') return '📝';
    if (type === 'zip') return '📦';
    return '📎';
}

function detectFileType(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) return 'pdf';
    if (name.endsWith('.docx')) return 'docx';
    if (name.endsWith('.zip')) return 'zip';
    return 'other';
}

function normalizeText(text) {
    return text.toLowerCase()
        // 1. Elimina N°, Nº, N. y espacios previos a números (ej. Ley N° 27735 -> ley 27735)
        .replace(/n[°º\.]?\s*(?=\d)/g, '') 
        .replace(/[áäâà]/g, 'a').replace(/[éëêè]/g, 'e').replace(/[íïîì]/g, 'i')
        .replace(/[óöôò]/g, 'o').replace(/[úüûù]/g, 'u')
        .replace(/ñ/g, 'ni')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Estado Global ───
let resultadosEvaluacion = [];
let archivosDetectados = [];
let abortController = null;
let isProcessing = false;
let sortColumn = null;
let sortDirection = 'asc';

const DOM = {};
function cacheDOM() {
    const ids = [
        'drop-zone', 'file-input', 'folder-input', 'btn-folder',
        'file-list', 'file-list-items', 'file-count',
        'stat-pdf', 'stat-docx', 'stat-zip',
        'status-text', 'progress-bar',
        'btn-clear', 'btn-export-pdf', 'btn-export-csv',
        'error-panel', 'error-list', 'btn-dismiss-errors',
        'table-body', 'filter-input', 'results-count',
        'loading-overlay', 'loading-title', 'loading-detail',
        'btn-cancel'
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

// ─── Gestión de UI de Archivos ───
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
    if (DOM['status-text']) DOM['status-text'].innerHTML = archivosDetectados.length + ' archivo(s) en cola.';

    archivosDetectados.forEach((f, i) => {
        const chip = document.createElement('li');
        chip.className = 'file-chip';
        const displayName = f.name.length > 28 ? f.name.slice(0, 25) + '...' : f.name;
        chip.innerHTML =
            '<span class="chip-icon">' + getFileTypeIcon(f.type) + '</span> ' +
            '<span title="' + escapeHTML(f.name) + '">' + escapeHTML(displayName) + '</span> ' +
            '<button class="chip-remove" data-index="' + i + '">&times;</button>';
        listEl.appendChild(chip);
    });

    listEl.querySelectorAll('.chip-remove').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (isProcessing) return;
            archivosDetectados.splice(parseInt(this.dataset.index), 1);
            updateFileListUI();
        });
    });
}

async function addFilesToList(files) {
    const validTypes = ['pdf', 'docx', 'zip'];
    let added = 0;
    for (let i = 0; i < files.length; i++) {
        const type = detectFileType(files[i]);
        if (validTypes.includes(type)) {
            const isDuplicate = archivosDetectados.some(f => f.name === files[i].name && f.size === files[i].size);
            if (!isDuplicate) {
                archivosDetectados.push({ name: files[i].name, type: type, file: files[i], size: files[i].size });
                added++;
            }
        }
    }
    if (added > 0) updateFileListUI();
}

// ─── Extracción de Texto ───
async function extractTextFromPDF(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error("La librería PDF.js no está cargada.");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        page.cleanup();
    }
    return fullText;
}

async function extractTextFromDOCX(file) {
    if (typeof mammoth === 'undefined') throw new Error("La librería Mammoth no está cargada.");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value || '';
}

// ═══════════════════════════════════════════════════════════
// MOTOR AUDITOR: DICCIONARIOS Y EVALUACIÓN
// ═══════════════════════════════════════════════════════════

const DICCIONARIOS = {
    T1: {
        keywords: [
            'ley 29783', 'ley 27735', 'dl 650', 'dl 713', 'dl 892', 'dl 854', 'ley 854', 'ds 005 2012', 'ds 007 2002', 'ley 25129', 'ley 26790', 
            'sst', 'beneficios laborales', 'gratificacion', 'gratificaciones', 'cts', 'vacaciones', 'asignacion familiar', 'utilidades', 
            'horas extras', 'seguridad y salud', 'salud ocupacional', 'riesgos laborales', 'enfermedades ocupacionales', 'lesiones laborales',
            'compensacion', 'tiempos de servicios' // Agregado para "Lesly"
        ]
    },
    T2: {
        keywords: [
            'ley 27942', 'convenio 190', 'ds 014 2019', 'ley 31156', 'dl 1410', 
            'hostigamiento sexual', 'acoso sexual', 'acoso laboral', 'comite de intervencion', 'chantaje sexual', 
            'violencia laboral', 'ambiente hostil', 'conducta no deseada', 'violencia sexual', 'destituidos', 'destitucion'
        ]
    },
    T3: {
        keywords: [
            'ley 28518', 'ds 011 2012', 'ley 31396', 'ley general de educacion', 
            'modalidad formativa', 'modalidades formativas', 'practicas preprofesionales', 'practicas profesionales', 
            'convenio de practicas', 'jornada formativa', 'flexibilidad horaria', 'facilidades horarias', 'empleo juvenil'
        ]
    }
};

const PATRONES_CASO = {
    evidenciaDirecta: ['http', 'https', 'www', '.pe', '.com', 'gob.pe', 'equidad.pe', 'infobae', 'la republica', 'el peruano', 'cronicaviva', 'defensoria', 'sunafil', 'minedu', 'rpp', 'noticia', 'diario', 'fuente', 'segun', 'informo', 'comunicado', 'reporto', 'denuncia', 'en 202'],
    actores: ['trabajador', 'emplead', 'colaborad', 'demandant', 'gerent', 'jef', 'supervis', 'practicant', 'victim', 'inspect', 'sindicat', 'rrhh', 'docent', 'joven', 'personal', 'empresa', 'ripley', 'arcos dorados', 'call center', 'ministerio'],
    accionesConflictivas: ['despid', 'incumpl', 'vulner', 'sufri', 'acos', 'accident', 'omiti', 'afect', 'oblig', 'coaccion', 'pago', 'hostig', 'negligenci', 'infracci', 'abuso', 'denunci', 'huelg', 'reclam', 'sancion', 'mult', 'destitu', 'lesion', 'renunci']
};

function extractStudentIdentity(fileName, text) {
    const patterns = [
        /(?:estudiante|autor|presentado\s+por|elaborado\s+por|alumno|alumna)\s*:\s*([^\n\.]{3,60})/i,
        /nombre\s*(?:del\s*)?(?:estudiante|alumno|autor)\s*:\s*([^\n\.]{3,60})/i,
        /([A-ZÁÉÍÓÚÑ\s]{8,50})\s*,\s*[S|J0-9]{8,12}/i
    ];
    for (let i = 0; i < patterns.length; i++) {
        const match = text.match(patterns[i]);
        if (match && match[1] && match[1].trim().length >= 5) return match[1].trim();
    }
    return fileName.replace(/\.(pdf|docx|doc)$/i, '').replace(/[_\-]/g, ' ').trim();
}

function evaluateContent(fileName, text) {
    const rawWords = text ? text.trim().split(/\s+/) : [];
    const wordCount = rawWords.filter(w => w.match(/[a-z0-9]/i)).length;
    const estudiante = extractStudentIdentity(fileName, text);
    const normText = normalizeText(text);

    // Bajar validación de documento mínimo a 20 palabras
    if (wordCount < 20) {
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: [false, false, false],
            c2: 0, c2Checks: [false, false, false],
            c3: 0, c3Checks: [],
            notaFinal: 0, wordCount: wordCount,
            bibliografia: { ok: false, detalle: 'Documento vacío' },
            observacion: 'Error: Contenido mínimo insuficiente para ser evaluado.'
        };
    }

    // 1. Unificar viñetas (Agrupa los puntos de "Preeliminar" en un bloque continuo)
    let textoAgrupado = text.replace(/\n(?=[\•\-\*])/g, ' '); 

    // 2. Limpieza e Integración de Secciones
    const bloquesProcesados = textoAgrupado
        .replace(/[\•\-\*]/g, ' ') 
        .split(/(?:\r?\n){2,}|\n(?=[A-Z0-9\s]{4,}:)/)
        .map(b => normalizeText(b))
        .filter(b => b.length > 15);

    let t1Words = 0, t2Words = 0, t3Words = 0;
    let hasT1_Case = false, hasT2_Case = false, hasT3_Case = false;
    let activeTopic = null;

    bloquesProcesados.forEach(bloque => {
        const palabrasBloque = bloque.split(/\s+/).length;

        const isT1 = DICCIONARIOS.T1.keywords.some(kw => bloque.includes(kw));
        const isT2 = DICCIONARIOS.T2.keywords.some(kw => bloque.includes(kw));
        const isT3 = DICCIONARIOS.T3.keywords.some(kw => bloque.includes(kw));

        // Determinación del Tema por Contexto
        if (bloque.includes('tema 1') || (isT1 && !isT2 && !isT3)) activeTopic = 'T1';
        else if (bloque.includes('tema 2') || (isT2 && !isT1 && !isT3)) activeTopic = 'T2';
        else if (bloque.includes('tema 3') || bloque.includes('flexibilidad') || (isT3 && !isT1 && !isT2)) activeTopic = 'T3';

        const currentTopic = activeTopic || (isT1 ? 'T1' : isT2 ? 'T2' : isT3 ? 'T3' : null);

        if (currentTopic === 'T1') t1Words += palabrasBloque;
        if (currentTopic === 'T2') t2Words += palabrasBloque;
        if (currentTopic === 'T3') t3Words += palabrasBloque;

        // EJECUCIÓN DEL PIPELINE DE CASOS REALES (C2)
        const tieneEvidencia = PATRONES_CASO.evidenciaDirecta.some(kw => bloque.includes(kw));
        const tieneActor = PATRONES_CASO.actores.some(kw => bloque.includes(kw));
        const tieneAccion = PATRONES_CASO.accionesConflictivas.some(kw => bloque.includes(kw));

        // Caso validado: (Evidencia Directa/URL) O (Actor + Acción Conflictiva)
        const esCasoValido = tieneEvidencia || (tieneActor && tieneAccion);

        if (esCasoValido && currentTopic) {
            if (currentTopic === 'T1') hasT1_Case = true;
            if (currentTopic === 'T2') hasT2_Case = true;
            if (currentTopic === 'T3') hasT3_Case = true;
        }
    });

    // ─── C1: Filtro Teórico (UMBRAL BAJADO A 20 PALABRAS) ───
    const UMBRAL = 20;
    const hasT1_Norm = t1Words >= UMBRAL;
    const hasT2_Norm = t2Words >= UMBRAL;
    const hasT3_Norm = t3Words >= UMBRAL;

    const c1Checks = [hasT1_Norm, hasT2_Norm, hasT3_Norm];
    const c1Puntos = c1Checks.filter(Boolean).length * 2;

    // ─── C2: Casos Reales ───
    const c2Checks = [hasT1_Case, hasT2_Case, hasT3_Case];
    const c2Puntos = c2Checks.filter(Boolean).length * 2;

    // ─── C3: Ética y Postura Crítica (TOTALMENTE DESACOPLADO DE C1/C2) ───
    const kwHumanista = ['dignidad', 'bienestar', 'justicia', 'equidad', 'vulnerabilidad', 'empatia', 'derechos humanos', 'desarrollo integral', 'salud mental', 'prevencion', 'integridad', 'respeto', 'clima laboral', 'salud ocupacional', 'buenas practicas', 'calidad de vida', 'agente de transformacion', 'escudo protector', 'canal neutral', 'responsabilidad etica'];
    const kwLegalista = ['multa', 'sancion', 'reglamento', 'contingencia', 'demanda', 'indemnizacion', 'evitar sanciones', 'riesgos legales', 'reputacion', 'costos laborales'];
    const kwDeficiente = ['exageracion', 'inevitable', 'costoso', 'informalidad', 'no es obligatorio', 'exceso de proteccionismo'];

    const hitHumanista = kwHumanista.filter(k => normText.includes(k)).length;
    const hitLegalista = kwLegalista.filter(k => normText.includes(k)).length;
    const hitDeficiente = kwDeficiente.filter(k => normText.includes(k)).length;

    let c3Puntos = 0;
    let stanceMsg = '';

    if (hitDeficiente > 0) {
        c3Puntos = 0;
        stanceMsg = 'Ética Deficiente (justifica malas prácticas)';
    } else if (hitHumanista >= 2) {
        c3Puntos = 8; // Obtiene 8 puntos directo por excelente reflexión ética
        stanceMsg = 'Ética Impecable (Postura Humana Integral)';
    } else if (hitHumanista === 1) {
        c3Puntos = 6;
        stanceMsg = 'Ética Buena (Reflexión presente pero breve)';
    } else if (hitLegalista >= 1) {
        c3Puntos = 4;
        stanceMsg = 'Ética Legalista (Enfocada en evitar sanciones)';
    } else {
        c3Puntos = 0;
        stanceMsg = 'Sin reflexión crítica personal';
    }

    // ─── Diagnóstico Sintético de Omisiones ───
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText) || normText.includes('recuperado de');
    
    const ausencias = [];
    if (!hasT1_Norm) ausencias.push(t1Words > 0 ? 'T1 teórica (Insuficiente)' : 'T1 teórica (Ausente)');
    if (!hasT2_Norm) ausencias.push(t2Words > 0 ? 'T2 teórica (Insuficiente)' : 'T2 teórica (Ausente)');
    if (!hasT3_Norm) ausencias.push(t3Words > 0 ? 'T3 teórica (Insuficiente)' : 'T3 teórica (Ausente)');
    if (!hasT1_Case) ausencias.push('Caso T1');
    if (!hasT2_Case) ausencias.push('Caso T2');
    if (!hasT3_Case) ausencias.push('Caso T3');

    let diagnostico = '';
    if (ausencias.length > 0) diagnostico += 'Falta desarrollar: ' + ausencias.join(', ') + '. | ';
    else diagnostico += 'Desarrollo conforme a estructura. | ';
    
    diagnostico += stanceMsg + '.';
    const notaFinal = Math.min(20, c1Puntos + c2Puntos + c3Puntos);

    return {
        estudiante: estudiante,
        c1: c1Puntos, c1Checks: c1Checks,
        c2: c2Puntos, c2Checks: c2Checks,
        c3: c3Puntos, c3Checks: [],
        notaFinal: notaFinal,
        wordCount: wordCount,
        bibliografia: { ok: hasAPA, detalle: hasAPA ? 'Formato APA' : 'Sin APA' },
        observacion: diagnostico
    };
}

// ─── Interfaz y Tabla ───
function renderPill(label, isOk) {
    if (isOk) {
        return '<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#dcfce7; color:#15803d; border:1px solid #86efac;">' + label + '</span>';
    } else {
        return '<span style="display:inline-block; padding:2px 6px; margin:1px; font-size:0.75rem; font-weight:700; border-radius:4px; background:#f3f4f6; color:#9ca3af; border:1px solid #d1d5db;">' + label + '</span>';
    }
}

function renderScoreBadge(score, max) {
    let color = '#ef4444', bg = '#fef2f2';
    const pct = score / max;
    if (pct >= 0.7) { color = '#10b981'; bg = '#ecfdf5'; }
    else if (pct >= 0.4) { color = '#f59e0b'; bg = '#fffbeb'; }
    return '<div style="display:inline-block; text-align:center; padding:2px 6px; border-radius:6px; background:' + bg + '; color:' + color + '; border:1px solid ' + color + '33;"><span style="font-size:0.85rem; font-weight:800;">' + score + '</span><span style="font-size:0.65rem; opacity:0.8;">/' + max + '</span></div>';
}

function renderFinalBadge(nota) {
    let bg = '#10b981';
    if (nota < 11) bg = '#ef4444';
    else if (nota < 14) bg = '#f59e0b';
    return '<span style="display:inline-block; padding:4px 10px; font-weight:800; font-size:0.85rem; border-radius:20px; color:#ffffff; background:' + bg + ';">' + nota + ' / 20</span>';
}

function renderTable(filterText) {
    const tbody = DOM['table-body'];
    if (!tbody) return;

    tbody.innerHTML = '';
    let filtrados = filterText 
        ? resultadosEvaluacion.filter(r => r.estudiante.toLowerCase().includes(filterText.toLowerCase())) 
        : resultadosEvaluacion;

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg" style="text-align:center; padding:20px; color:#6b7280;">No se encontraron resultados de evaluación.</td></tr>';
        if (DOM['results-count']) DOM['results-count'].classList.add('hidden');
        return;
    }

    if (DOM['results-count']) {
        DOM['results-count'].classList.remove('hidden');
        DOM['results-count'].textContent = 'Mostrando ' + filtrados.length + ' de ' + resultadosEvaluacion.length;
    }

    filtrados.forEach((r, idx) => {
        const bibIcon = r.bibliografia.ok ? '<span style="color:#10b981; font-weight:bold;">✓</span>' : '<span style="color:#9ca3af;">—</span>';
        
        const c1Pills = renderPill('T1', r.c1Checks[0]) + renderPill('T2', r.c1Checks[1]) + renderPill('T3', r.c1Checks[2]);
        const c2Pills = renderPill('C1', r.c2Checks[0]) + renderPill('C2', r.c2Checks[1]) + renderPill('C3', r.c2Checks[2]);
        
        let c3Pills = '';
        if (r.c3 === 8) c3Pills = renderPill('Óptimo', true);
        else if (r.c3 === 6) c3Pills = renderPill('Bueno', true);
        else if (r.c3 === 4) c3Pills = renderPill('Parcial', true);
        else c3Pills = renderPill('Deficiente', false);

        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td style="text-align:center; font-weight:600; color:#6b7280; font-size:0.85rem;">' + (idx + 1) + '</td>' +
            '<td style="font-weight:600; color:#111827; font-size:0.85rem;">' + escapeHTML(r.estudiante) + '</td>' +
            '<td style="text-align:center;">' + renderScoreBadge(r.c1, 6) + '<br><div style="margin-top:4px;">' + c1Pills + '</div></td>' +
            '<td style="text-align:center;">' + renderScoreBadge(r.c2, 6) + '<br><div style="margin-top:4px;">' + c2Pills + '</div></td>' +
            '<td style="text-align:center;">' + renderScoreBadge(r.c3, 8) + '<br><div style="margin-top:4px;">' + c3Pills + '</div></td>' +
            '<td style="text-align:center;">' + renderFinalBadge(r.notaFinal) + '</td>' +
            '<td style="text-align:center; font-size:0.8rem; color:#4b5563;">' + r.wordCount + ' pal.</td>' +
            '<td style="text-align:center;">' + bibIcon + '</td>' +
            '<td style="font-size:0.8rem; color:#374151; line-height:1.35; padding: 8px;">' +
                '<div style="background:#f9fafb; border-left:3px solid #6366f1; padding:6px 8px; border-radius:0 4px 4px 0;">' + 
                   escapeHTML(r.observacion) + 
                '</div>' +
            '</td>';
        tbody.appendChild(tr);
    });
}

// ─── Proceso Principal ───
function addError(archivo, mensaje) {
    if (!DOM['error-panel']) return;
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = '[' + archivo + '] ' + mensaje;
    if (DOM['error-list']) DOM['error-list'].appendChild(li);
}

async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    isProcessing = true;
    abortController = new AbortController();
    resultadosEvaluacion = [];
    
    if (DOM['loading-overlay']) DOM['loading-overlay'].classList.remove('hidden');
    if (DOM['table-body']) DOM['table-body'].innerHTML = '';
    if (DOM['error-list']) DOM['error-list'].innerHTML = '';
    if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');

    try {
        for (let i = 0; i < archivosDetectados.length; i++) {
            if (abortController.signal.aborted) break;
            const item = archivosDetectados[i];
            
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Evaluando: ' + escapeHTML(item.name);
            
            try {
                let text = '';
                if (item.type === 'pdf') {
                    text = await extractTextFromPDF(item.file);
                } else if (item.type === 'docx') {
                    text = await extractTextFromDOCX(item.file);
                }

                if (!text || text.trim().length < 20) {
                    addError(item.name, 'No se pudo extraer texto. Documento vacío o protegido.');
                } else {
                    const resultado = evaluateContent(item.name, text);
                    resultadosEvaluacion.push(resultado);
                }
            } catch (err) {
                addError(item.name, 'Fallo de lectura: ' + err.message);
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
        } else {
            if (DOM['table-body']) DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg" style="text-align:center; padding:20px; color:#ef4444;">No se generaron evaluaciones. Revisa el panel de errores.</td></tr>';
        }
    }
}

// ─── Eventos e Inicialización ───
function setupEvents() {
    const dz = DOM['drop-zone'];
    if (dz) {
        dz.addEventListener('click', function(e) {
            if (e.target !== dz && e.target.closest('button')) return;
            if (DOM['file-input']) DOM['file-input'].click();
        });
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
            dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
        });
        dz.addEventListener('dragover', () => dz.classList.add('dragover'));
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', async function(e) {
            dz.classList.remove('dragover');
            if (isProcessing) return;
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                await addFilesToList(files);
                processAllFiles();
            }
        });
    }

    if (DOM['file-input']) {
        DOM['file-input'].addEventListener('change', async function(e) {
            if (this.files.length > 0) {
                await addFilesToList(this.files);
                this.value = '';
                processAllFiles();
            }
        });
    }

    if (DOM['btn-clear']) {
        DOM['btn-clear'].addEventListener('click', function() {
            if (abortController) abortController.abort();
            isProcessing = false;
            resultadosEvaluacion = [];
            archivosDetectados = [];
            updateFileListUI();
            if (DOM['table-body']) DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg" style="text-align:center; padding:20px;">Esperando documentos...</td></tr>';
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = true;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = true;
            if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
        });
    }

    if (DOM['filter-input']) {
        DOM['filter-input'].addEventListener('input', function() { renderTable(this.value); });
    }
    if (DOM['btn-cancel']) {
        DOM['btn-cancel'].addEventListener('click', function() {
            if (abortController) abortController.abort();
            isProcessing = false;
            if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');
        });
    }
    if (DOM['btn-dismiss-errors']) {
        DOM['btn-dismiss-errors'].addEventListener('click', function() {
            if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
        });
    }
}

function init() {
    cacheDOM();
    setupEvents();
    checkDependencies();
    configurePDFJS();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
