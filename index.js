/* ============================================================
   index.js — Auditor Estructural de Evaluación Automatizada
   Procesamiento en Fila India | Memoria Optimizada | Rúbrica 0-20
   (FORTALECIDO: Eventos Desbloqueados y Minuciosidad Estricta)
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
        // jsPDF a veces se carga como window.jspdf o window.jsPDF
        if (typeof window[globalName] === 'undefined' && globalName !== 'jspdf') {
            missing.push(label);
        } else if (globalName === 'jspdf' && typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            missing.push(label);
        }
    }
    const alertEl = document.getElementById('cdn-alert');
    const alertText = document.getElementById('cdn-alert-text');
    
    if (alertEl && alertText && missing.length > 0) {
        alertEl.classList.remove('hidden');
        alertText.textContent = 'Faltan librerías o cargan lento: ' + missing.join(', ') + '. El sistema intentará funcionar de todos modos.';
        return false;
    }
    if (alertEl) alertEl.classList.add('hidden');
    return true;
}

function configurePDFJS() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

// ─── Utilidades ───
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
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
        .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
        .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
        .replace(/ñ/g, 'ni')
        .replace(/\s+/g, ' ')
        .trim();
}

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
    const ids = [
        'drop-zone', 'file-input', 'folder-input', 'btn-folder',
        'folder-fallback-msg', 'file-list', 'file-list-items', 'file-count',
        'stat-pdf', 'stat-docx', 'stat-zip',
        'status-text', 'progress-bar',
        'btn-clear', 'btn-export-pdf', 'btn-export-csv',
        'error-panel', 'error-list', 'btn-dismiss-errors',
        'table-body', 'filter-input', 'results-count',
        'loading-overlay', 'loading-title', 'loading-detail',
        'overlay-progress', 'overlay-percent', 'btn-cancel',
        'cdn-alert', 'cdn-alert-text'
    ];
    ids.forEach(id => { DOM[id] = document.getElementById(id); });
}

// ─── Gestión de Lista de Archivos ───
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
    DOM['file-count'].textContent = archivosDetectados.length;
    if (DOM['status-text']) DOM['status-text'].innerHTML = archivosDetectados.length + ' archivo(s) listos para evaluar.';

    let cPDF = 0, cDOCX = 0, cZIP = 0;
    archivosDetectados.forEach(f => {
        if (f.type === 'pdf') cPDF++;
        else if (f.type === 'docx') cDOCX++;
        else if (f.type === 'zip') cZIP++;
    });

    const toggleStat = (el, c) => {
        if (!el) return;
        if (c > 0) { el.classList.remove('hidden'); el.textContent = c; }
        else el.classList.add('hidden');
    };
    toggleStat(DOM['stat-pdf'], cPDF);
    toggleStat(DOM['stat-docx'], cDOCX);
    toggleStat(DOM['stat-zip'], cZIP);

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
            const isDuplicate = archivosDetectados.some(
                f => f.name === files[i].name && f.size === files[i].size
            );
            if (!isDuplicate) {
                archivosDetectados.push({
                    name: files[i].name,
                    type: type,
                    file: files[i],
                    size: files[i].size
                });
                added++;
            }
        }
    }
    if (added > 0) updateFileListUI();
}

// ─── Lectura Recursiva de Carpetas (Drag & Drop) ───
async function collectFilesFromDataTransfer(dataTransfer) {
    const files = [];
    const items = dataTransfer.items;
    if (!items) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
            files.push(dataTransfer.files[i]);
        }
        return files;
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;

        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item.getAsEntry ? item.getAsEntry() : null);

        if (entry && entry.isDirectory) {
            const dirFiles = await readDirectory(entry);
            files.push(...dirFiles);
        } else if (entry && entry.isFile) {
            files.push(item.getAsFile());
        } else {
            const f = item.getAsFile();
            if (f) files.push(f);
        }
    }
    return files;
}

async function readDirectory(entry) {
    const files = [];
    const reader = entry.createReader();

    const readAllEntries = () => {
        return new Promise((resolve) => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) { resolve([]); return; }
                const results = [];
                for (const e of entries) {
                    if (e.isFile) {
                        const file = await new Promise(res => e.file(res));
                        results.push(file);
                    } else if (e.isDirectory) {
                        const sub = await readDirectory(e);
                        results.push(...sub);
                    }
                }
                resolve(results);
            });
        });
    };

    let batch;
    do {
        batch = await readAllEntries();
        files.push(...batch);
    } while (batch.length > 0);

    return files;
}

// ─── EXTRACCIÓN DE TEXTO ───
async function extractTextFromPDF(file) {
    let arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + ' ';
        page.cleanup();

        if (DOM['status-text']) {
            DOM['status-text'].innerHTML =
                '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
                '<span>Leyendo: <strong>' + escapeHTML(file.name.substring(0, 25)) + '...</strong></span>' +
                '<span>Página ' + i + ' de ' + pdf.numPages + '</span>' +
                '<progress value="' + i + '" max="' + pdf.numPages + '" style="width:100%;height:6px;border-radius:3px;"></progress>' +
                '</div>';
        }
        await yieldUI();
    }

    await loadingTask.destroy();
    arrayBuffer = null;
    return fullText;
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    if (DOM['status-text']) {
        DOM['status-text'].innerHTML =
            '<div style="display:flex;flex-direction:column;gap:4px;margin-top:5px;font-size:0.9em;">' +
            '<span>Leyendo: <strong>' + escapeHTML(file.name.substring(0, 25)) + '...</strong></span>' +
            '<span>Extrayendo DOCX...</span>' +
            '<progress style="width:100%;height:6px;border-radius:3px;"></progress>' +
            '</div>';
    }
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer });
    let text = result.value;
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
                type: lower.endsWith('.pdf')
                    ? 'application/pdf'
                    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
            extracted.push({
                name: file.name,
                type: lower.endsWith('.pdf') ? 'pdf' : 'docx',
                file: file,
                size: blob.size
            });
            blob = null;
        }
        if (i % 3 === 0) await yieldUI();
    }
    return extracted;
}

// ═══════════════════════════════════════════════════════════
//  MOTOR DE EVALUACIÓN EXHAUSTIVO (FORTALECIDO C1, C2, C3)
// ═══════════════════════════════════════════════════════════

const DICCIONARIO = {
    T1: {
        normas: [
            'ley 29783', 'ley 27735', 'dl 713', 'dl 650', 'dl 892',
            'ds 005 2012', 'ley 25129', 'ley 26790', 'ley 30056'
        ],
        conceptos: [
            'seguridad y salud', 'compensacion por tiempo',
            'asignacion familiar', 'participacion en utilidades',
            'descanso vacacional', 'horas extras', 'riesgos laborales',
            'seguro de vida ley', 'beneficios laborales', 'pago de gratificaciones'
        ]
    },
    T2: {
        normas: [
            'ley 27942', 'convenio 190', 'ds 014 2019',
            'ley 31156', 'dl 1410'
        ],
        conceptos: [
            'hostigamiento sexual', 'acoso sexual', 'acoso laboral',
            'comite de intervencion', 'chantaje sexual', 'violencia laboral',
            'ambiente hostil', 'conducta no deseada'
        ]
    },
    T3: {
        normas: [
            'ley 28518', 'ds 011 2012', 'ley 31396'
        ],
        conceptos: [
            'modalidad formativa', 'practicas preprofesionales',
            'practicas profesionales', 'convenio de practicas',
            'jornada formativa', 'subvencion economica',
            'facilidades horarias', 'practicante'
        ]
    },
    NARRATIVA_CASO: {
        actores: [
            'el trabajador', 'la trabajadora', 'empleador', 'la empresa',
            'demandante', 'gerente', 'practicante', 'victima', 'sindicato', 'obrero'
        ],
        // C2 requiere una vulneración explícita
        conflictos: [
            'despidio', 'incumplio', 'vulnero', 'sufrio', 'acoso', 
            'accidento', 'omitio', 'afecto', 'obligo', 'coacciono', 
            'no pago', 'accidente de trabajo', 'fallecio', 'infraccion'
        ],
        // C2 requiere un desenlace formal o denuncia evidenciable
        consecuencias: [
            'demando', 'sanciono', 'reclamo', 'denuncio', 'multo', 
            'sunafil', 'tribunal constitucional', 'corte suprema', 
            'expediente', 'casacion', 'resolucion', 'sentencia', 'inspeccion', 'queja'
        ]
    }
};

function extractStudentIdentity(fileName, text) {
    const patterns = [
        /(?:estudiante|autor|presentado\s+por|elaborado\s+por|alumno|alumna)\s*:\s*([^\n\.]{3,60})/i,
        /nombre\s*(?:del\s*)?(?:estudiante|alumno|autor)\s*:\s*([^\n\.]{3,60})/i,
        /^([A-ZÁÉÍÓÚ][a-záéíóú]+\s+[A-ZÁÉÍÓÚ][a-záéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-záéíóú]+)?)/m
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].trim().length >= 5) {
            return match[1].trim();
        }
    }

    let name = fileName.replace(/\.(pdf|docx|doc)$/i, '');
    name = name.replace(/[_\-]/g, ' ').trim();
    if (name.length > 3) return name;

    return 'Sin identificar';
}

function evaluateContent(fileName, text) {
    const wordCount = text
        ? text.trim().split(/\s+/).filter(function(w) { return w.match(/[a-z0-9]/i); }).length
        : 0;
    const estudiante = extractStudentIdentity(fileName, text);
    const normText = normalizeText(text);

    if (wordCount < 50) {
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: [false, false, false],
            c2: 0, c2Checks: [false, false, false],
            c3: 0, c3Checks: [false, false, false],
            notaFinal: 0, wordCount: wordCount,
            bibliografia: { ok: false, detalle: 'Sin contenido suficiente' },
            observacion: 'Ausenta: Contenido mínimo. Documento insuficiente o vacío.'
        };
    }

    // Dividir en bloques densos para medir densidad y proximidad
    const bloques = text
        .split(/(?:\r?\n){2,}|\.\s+/)
        .map(function(p) { return normalizeText(p); })
        .filter(function(p) { return p.length > 30; });

    let palabrasT1 = 0, palabrasT2 = 0, palabrasT3 = 0;
    let hasT1_Case = false, hasT2_Case = false, hasT3_Case = false;

    bloques.forEach(function(bloque) {
        const palabrasEnBloque = bloque.split(/\s+/).length;

        const esT1 = DICCIONARIO.T1.normas.some(kw => bloque.includes(kw)) ||
                     DICCIONARIO.T1.conceptos.some(kw => bloque.includes(kw));
        const esT2 = DICCIONARIO.T2.normas.some(kw => bloque.includes(kw)) ||
                     DICCIONARIO.T2.conceptos.some(kw => bloque.includes(kw));
        const esT3 = DICCIONARIO.T3.normas.some(kw => bloque.includes(kw)) ||
                     DICCIONARIO.T3.conceptos.some(kw => bloque.includes(kw));

        // Filtro de densidad para C1
        if (esT1) palabrasT1 += palabrasEnBloque;
        if (esT2) palabrasT2 += palabrasEnBloque;
        if (esT3) palabrasT3 += palabrasEnBloque;

        // Tríada Narrativa Exhaustiva (C2)
        const tieneActor = DICCIONARIO.NARRATIVA_CASO.actores.some(kw => bloque.includes(kw));
        const tieneConflicto = DICCIONARIO.NARRATIVA_CASO.conflictos.some(kw => bloque.includes(kw));
        const tieneConsecuencia = DICCIONARIO.NARRATIVA_CASO.consecuencias.some(kw => bloque.includes(kw));

        // Condición Minuciosa: Un caso real debe mencionar un actor + un conflicto evidente. 
        // O debe apoyarse explícitamente en una entidad formal (Sunafil, expediente, etc).
        const esCasoReal = (tieneActor && tieneConflicto) || tieneConsecuencia;

        if (esCasoReal) {
            if (esT1) hasT1_Case = true;
            if (esT2) hasT2_Case = true;
            if (esT3) hasT3_Case = true;
        }
    });

    // ─── CRITERIO 1 (Normativa Estricta: Filtro Anti-Andreas) ───
    const UMBRAL_PALABRAS = 45; // Requiere que el contexto del tema tenga al menos 45 palabras reales.
    const hasT1_Norm = palabrasT1 >= UMBRAL_PALABRAS;
    const hasT2_Norm = palabrasT2 >= UMBRAL_PALABRAS;
    const hasT3_Norm = palabrasT3 >= UMBRAL_PALABRAS;

    const c1Checks = [hasT1_Norm, hasT2_Norm, hasT3_Norm];
    const c1Puntos = c1Checks.filter(Boolean).length * 2; 

    // ─── CRITERIO 2 (Efecto Dominó: El Caso no existe si la norma es insuficiente) ───
    hasT1_Case = hasT1_Case && hasT1_Norm;
    hasT2_Case = hasT2_Case && hasT2_Norm;
    hasT3_Case = hasT3_Case && hasT3_Norm;

    const c2Checks = [hasT1_Case, hasT2_Case, hasT3_Case];
    const c2Puntos = c2Checks.filter(Boolean).length * 2; 

    // ─── CRITERIO 3 (Ética Escalonada) ───
    const kwHumanista = [
        'dignidad', 'bienestar', 'justicia', 'equidad', 'vulnerabilidad',
        'empatia', 'derechos humanos', 'desarrollo integral', 'salud mental',
        'prevencion', 'integridad', 'respeto'
    ];
    const kwLegalista = [
        'multa', 'sancion', 'reglamento', 'contingencia', 'demanda',
        'indemnizacion', 'evitar sanciones', 'riesgos legales', 'reputacion'
    ];
    const kwDeficiente = [
        'exageracion', 'inevitable', 'costoso', 'tradicion', 'informalidad',
        'necesidades del negocio', 'no es obligatorio', 'trabajador debe adaptarse'
    ];

    const hitHumanista = kwHumanista.filter(k => normText.includes(k)).length;
    const hitLegalista = kwLegalista.filter(k => normText.includes(k)).length;
    const hitDeficiente = kwDeficiente.filter(k => normText.includes(k)).length;

    let c3Puntos = 0;
    let stanceMsg = '';
    let c3Checks = [false, false, false];

    if (hitDeficiente > 0) {
        c3Puntos = 0;
        stanceMsg = 'Ética Deficiente (justifica malas prácticas)';
        c3Checks = [true, false, false];
    } else if (hitHumanista >= 2) {
        if (c1Puntos === 6 && c2Puntos === 6) {
            c3Puntos = 8;
            stanceMsg = 'Ética Impecable (Desarrollo completo)';
            c3Checks = [true, true, true];
        } else if (c1Puntos >= 4 && c2Puntos >= 4) {
            c3Puntos = 6;
            stanceMsg = 'Ética Buena (Presenta omisiones temáticas)';
            c3Checks = [true, true, false];
        } else {
            c3Puntos = 4;
            stanceMsg = 'Ética Parcial (Vacíos graves en normas o casos)';
            c3Checks = [true, false, false];
        }
    } else if (hitLegalista >= 2) {
        c3Puntos = 4;
        stanceMsg = 'Ética Legalista (Enfocada en evitar multas)';
        c3Checks = [true, false, false];
    } else {
        c3Puntos = 0;
        stanceMsg = 'Sin reflexión crítica clara';
    }

    // ─── BIBLIOGRAFÍA Y DIAGNÓSTICO ───
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText);
    const biblioDetalle = hasAPA ? 'Fuentes verificables' : 'Sin fuentes estructuradas';

    const ausencias = [];
    // Especificamos si fue ausente total, o si fue "Insuficiente" (muy cortito)
    if (!hasT1_Norm) ausencias.push(palabrasT1 > 0 ? 'T1 (Insuficiente)' : 'T1 (Ausente)');
    if (!hasT2_Norm) ausencias.push(palabrasT2 > 0 ? 'T2 (Insuficiente)' : 'T2 (Ausente)');
    if (!hasT3_Norm) ausencias.push(palabrasT3 > 0 ? 'T3 (Insuficiente)' : 'T3 (Ausente)');

    if (!hasT1_Case && hasT1_Norm) ausencias.push('Caso T1');
    if (!hasT2_Case && hasT2_Norm) ausencias.push('Caso T2');
    if (!hasT3_Case && hasT3_Norm) ausencias.push('Caso T3');

    let diagnostico = 'Observaciones: ' +
        (ausencias.length > 0 ? ausencias.join(', ') : 'Ninguna omisión') +
        '. | ' + stanceMsg + '.';

    const notaFinal = Math.min(20, c1Puntos + c2Puntos + c3Puntos);

    return {
        estudiante: estudiante,
        c1: c1Puntos, c1Checks: c1Checks,
        c2: c2Puntos, c2Checks: c2Checks,
        c3: c3Puntos, c3Checks: c3Checks,
        notaFinal: notaFinal,
        wordCount: wordCount,
        bibliografia: { ok: hasAPA, detalle: biblioDetalle },
        observacion: diagnostico
    };
}

// ─── Panel de Errores ───
function addError(archivo, mensaje) {
    if (!DOM['error-panel'] || !DOM['error-list']) return;
    DOM['error-panel'].classList.remove('hidden');
    const li = document.createElement('li');
    li.textContent = '[' + archivo + '] ' + mensaje;
    DOM['error-list'].appendChild(li);
}

// ─── PROCESAMIENTO EN FILA INDIA ───
async function processAllFiles() {
    if (isProcessing) return;
    if (archivosDetectados.length === 0) return;

    isProcessing = true;
    abortController = new AbortController();
    const signal = abortController.signal;

    resultadosEvaluacion = [];
    if (DOM['table-body']) DOM['table-body'].innerHTML = '';
    if (DOM['error-list']) DOM['error-list'].innerHTML = '';
    if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
    if (DOM['progress-bar']) {
        DOM['progress-bar'].classList.remove('hidden');
        DOM['progress-bar'].value = 0;
    }

    if (DOM['loading-overlay']) DOM['loading-overlay'].classList.remove('hidden');
    if (DOM['btn-cancel']) DOM['btn-cancel'].classList.remove('hidden');

    try {
        let cola = [...archivosDetectados];
        let total = cola.length;
        let procesados = 0;

        while (cola.length > 0) {
            if (signal.aborted) break;

            let item = cola.shift();

            if (item.type === 'zip') {
                if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Extrayendo ZIP: ' + item.name + '...';
                try {
                    let extracted = await extractFilesFromZip(item.file);
                    cola.unshift(...extracted);
                    total += extracted.length - 1;
                } catch (e) {
                    addError(item.name, 'Error ZIP: ' + e.message);
                }
                item.file = null;
                item = null;
                continue;
            }

            procesados++;
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Procesando archivo ' + procesados + ' de ' + total;
            if (DOM['overlay-progress']) DOM['overlay-progress'].value = Math.round((procesados / total) * 100);
            if (DOM['overlay-percent']) DOM['overlay-percent'].textContent = Math.round((procesados / total) * 100) + '%';
            if (DOM['progress-bar']) DOM['progress-bar'].value = Math.round((procesados / total) * 100);

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
        if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');
        if (DOM['progress-bar']) DOM['progress-bar'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            if (DOM['status-text']) DOM['status-text'].textContent = '¡Completado! Evaluados ' + resultadosEvaluacion.length + ' de ' + archivosDetectados.length + ' archivos.';
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            renderTable();
            saveState();
        } else {
            if (DOM['status-text']) DOM['status-text'].textContent = 'Ocurrió un error general o no hubo archivos válidos.';
        }
    }
}

// ─── Renderizado de Tabla ───
function renderTable(filterText) {
    const tbody = DOM['table-body'];
    if (!tbody) return;

    tbody.innerHTML = '';
    let sorted = [...resultadosEvaluacion];

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

    let filtrados = filterText
        ? sorted.filter(function(r) { return r.estudiante.toLowerCase().includes(filterText.toLowerCase()); })
        : sorted;

    if (filtrados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin datos.</td></tr>';
        if (DOM['results-count']) DOM['results-count'].classList.add('hidden');
        return;
    }

    if (DOM['results-count']) {
        DOM['results-count'].classList.remove('hidden');
        DOM['results-count'].textContent = 'Mostrando ' + filtrados.length + ' de ' + resultadosEvaluacion.length;
    }

    filtrados.forEach(function(r) {
        var idx = resultadosEvaluacion.indexOf(r) + 1;
        var badgeClass = r.notaFinal >= 14 ? 'badge-success' : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        var biblioIcon = r.bibliografia && r.bibliografia.ok ? '✅' : '❌';
        var biblioTitle = r.bibliografia ? escapeHTML(r.bibliografia.detalle) : '';

        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' + idx + '</td>' +
            '<td><strong>' + escapeHTML(r.estudiante) + '</strong></td>' +
            '<td>' + r.c1 + ' / 6</td>' +
            '<td>' + r.c2 + ' / 6</td>' +
            '<td>' + r.c3 + ' / 8</td>' +
            '<td><span class="badge ' + badgeClass + '">' + r.notaFinal + ' / 20</span></td>' +
            '<td>' + r.wordCount + ' palabras</td>' +
            '<td title="' + biblioTitle + '">' + biblioIcon + '</td>' +
            '<td style="font-size:0.82rem;color:#475569;">' + escapeHTML(r.observacion) + '</td>';
        tbody.appendChild(tr);
    });
}

// ─── Persistencia en sessionStorage ───
function saveState() {
    try {
        sessionStorage.setItem('resultadosEvaluacion', JSON.stringify(resultadosEvaluacion));
    } catch (e) { /* storage lleno o no disponible */ }
}

function loadState() {
    try {
        var saved = sessionStorage.getItem('resultadosEvaluacion');
        if (saved) {
            resultadosEvaluacion = JSON.parse(saved);
            renderTable();
            if (DOM['btn-export-pdf']) DOM['btn-export-pdf'].disabled = false;
            if (DOM['btn-export-csv']) DOM['btn-export-csv'].disabled = false;
            if (DOM['btn-clear']) DOM['btn-clear'].disabled = false;
            if (DOM['status-text']) DOM['status-text'].textContent = 'Sesión restaurada: ' + resultadosEvaluacion.length + ' evaluaciones previas.';
        }
    } catch (e) { /* ignorar */ }
}

// ─── Ordenamiento ───
function setupSortableHeaders() {
    var headers = document.querySelectorAll('.results-table th.sortable');
    headers.forEach(function(th) {
        th.addEventListener('click', function() {
            var col = this.dataset.sort;
            if (!col) return;

            if (sortColumn === col) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortColumn = col;
                sortDirection = 'asc';
            }

            headers.forEach(function(h) {
                h.classList.remove('asc', 'desc');
                if (h.dataset.sort) h.setAttribute('aria-sort', 'none');
            });
            this.classList.add(sortDirection);
            this.setAttribute('aria-sort', sortDirection === 'asc' ? 'ascending' : 'descending');

            renderTable(DOM['filter-input'] ? DOM['filter-input'].value : '');
        });
    });
}

// ─── Limpieza Total ───
function clearAll() {
    if (abortController) abortController.abort();
    isProcessing = false;
    resultadosEvaluacion = [];
    archivosDetectados = [];
    sortColumn = null;
    sortDirection = 'asc';

    if (DOM['table-body']) DOM['table-body'].innerHTML = '<tr><td colspan="9" class="empty-msg">Sube archivos para iniciar.</td></tr>';
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

    try { sessionStorage.removeItem('resultadosEvaluacion'); } catch (e) {}
}

// ─── Exportación CSV ───
function exportCSV() {
    if (resultadosEvaluacion.length === 0) return;
    var csvContent = '\uFEFFEstudiante,C1 Normativa (6P),C2 Casos (6P),C3 Ética (8P),Nota Final,Extensión (palabras),Bibliografía,Observaciones\n';
    resultadosEvaluacion.forEach(function(r) {
        csvContent +=
            '"' + r.estudiante + '",' +
            r.c1 + ',' + r.c2 + ',' + r.c3 + ',' +
            r.notaFinal + ',' + r.wordCount + ',' +
            (r.bibliografia && r.bibliografia.ok ? 'Sí' : 'No') + ',' +
            '"' + r.observacion + '"\n';
    });
    var encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    var link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'Reporte_Evaluacion_RRHH.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ─── Exportación PDF ───
function exportPDF() {
    if (resultadosEvaluacion.length === 0 || !window.jspdf) return;
    var doc = new window.jspdf.jsPDF({ orientation: 'landscape' });

    doc.setFontSize(16);
    doc.text('Reporte Consolidado de Evaluación Académica', 14, 15);
    doc.setFontSize(10);
    doc.text('Programa de Gestión Humana y Derecho Laboral | Escala Vigesimal (0-20)', 14, 22);
    doc.text('Generado: ' + new Date().toLocaleDateString('es-PE'), 14, 28);

    var tableData = resultadosEvaluacion.map(function(r, i) {
        return [
            i + 1,
            r.estudiante,
            r.c1 + '/6',
            r.c2 + '/6',
            r.c3 + '/8',
            r.notaFinal + '/20',
            r.wordCount,
            r.bibliografia && r.bibliografia.ok ? 'Sí' : 'No',
            r.observacion
        ];
    });

    doc.autoTable({
        startY: 34,
        head: [['#', 'Estudiante', 'C1 (6P)', 'C2 (6P)', 'C3 (8P)', 'Nota', 'Extensión', 'Biblio', 'Observaciones']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 119, 182] },
        styles: { fontSize: 7 },
        columnStyles: {
            1: { cellWidth: 35 },
            8: { cellWidth: 12 },
            9: { cellWidth: 50 }
        }
    });

    doc.save('Reporte_Consolidado_Evaluaciones.pdf');
}

// ─── Configuración de Eventos (AHORA SE EJECUTA SIEMPRE) ───
function setupEvents() {
    var dz = DOM['drop-zone'];
    if (dz) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function(ev) {
            dz.addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); });
        });

        dz.addEventListener('dragover', function() {
            dz.classList.add('dragover');
        });

        dz.addEventListener('dragleave', function(e) {
            if (!dz.contains(e.relatedTarget)) {
                dz.classList.remove('dragover');
            }
        });

        dz.addEventListener('drop', async function(e) {
            dz.classList.remove('dragover');
            if (isProcessing) return;

            var files = await collectFilesFromDataTransfer(e.dataTransfer);
            if (files.length > 0) {
                await addFilesToList(files);
                processAllFiles();
            }
        });

        dz.addEventListener('click', function(e) {
            if (e.target === dz || e.target.closest('.drop-zone-content')) {
                if (DOM['file-input']) DOM['file-input'].click();
            }
        });

        dz.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (DOM['file-input']) DOM['file-input'].click();
            }
        });
    }

    if (DOM['file-input']) {
        DOM['file-input'].addEventListener('change', async function(e) {
            var files = Array.from(e.target.files);
            e.target.value = ''; 
            if (files.length > 0) {
                await addFilesToList(files);
                processAllFiles();
            }
        });
    }

    if (DOM['folder-input']) {
        DOM['folder-input'].addEventListener('change', async function(e) {
            var files = Array.from(e.target.files);
            e.target.value = '';
            if (files.length > 0) {
                await addFilesToList(files);
                processAllFiles();
            }
        });
    }

    if (DOM['btn-folder']) {
        DOM['btn-folder'].addEventListener('click', function() {
            if (DOM['folder-input']) DOM['folder-input'].click();
        });
    }

    if (DOM['btn-clear']) {
        DOM['btn-clear'].addEventListener('click', clearAll);
    }

    if (DOM['btn-cancel']) {
        DOM['btn-cancel'].addEventListener('click', function() {
            if (abortController) abortController.abort();
            isProcessing = false;
            if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');
            if (DOM['progress-bar']) DOM['progress-bar'].classList.add('hidden');
        });
    }

    if (DOM['btn-dismiss-errors']) {
        DOM['btn-dismiss-errors'].addEventListener('click', function() {
            if (DOM['error-panel']) DOM['error-panel'].classList.add('hidden');
            if (DOM['error-list']) DOM['error-list'].innerHTML = '';
        });
    }

    if (DOM['filter-input']) {
        DOM['filter-input'].addEventListener('input', function() {
            renderTable(this.value);
        });
    }

    if (DOM['btn-export-csv']) {
        DOM['btn-export-csv'].addEventListener('click', exportCSV);
    }
    if (DOM['btn-export-pdf']) {
        DOM['btn-export-pdf'].addEventListener('click', exportPDF);
    }

    setupSortableHeaders();
}

// ─── Inicialización Segura ───
function init() {
    cacheDOM();
    
    // CRÍTICO: Vincular los eventos de inmediato para evitar que la página "muera".
    setupEvents(); 
    
    // Luego se validan las dependencias (mostrará alerta si hay fallas, pero no romperá la UI)
    checkDependencies();
    configurePDFJS();
    
    // Cargar historial previo
    loadState();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
