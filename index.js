/* ============================================================
   index.js — Motor de Evaluación Automatizada con IA Integrada
   Versión Corregida: Detección de Nombre al Final + Alineación de Tabla
   ============================================================ */

// ─── CONFIGURACIÓN DE LA IA (API) ───
// Coloca tu API Key de Gemini aquí:
const AI_API_KEY = "TU_API_KEY_AQUI";
const AI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${AI_API_KEY}`;

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

const yieldUI = () => new Promise(resolve => setTimeout(resolve, 15));

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
    const ids = ['drop-zone', 'file-input', 'folder-input', 'btn-folder', 'file-list', 'file-list-items', 'file-count', 'stat-pdf', 'stat-docx', 'stat-zip', 'status-text', 'progress-bar', 'btn-clear', 'btn-export-pdf', 'btn-export-csv', 'error-panel', 'error-list', 'btn-dismiss-errors', 'table-body', 'filter-input', 'results-count', 'loading-overlay', 'loading-title', 'loading-detail', 'overlay-progress', 'overlay-percent', 'btn-cancel', 'cdn-alert', 'cdn-alert-text', 'btn-process'];
    ids.forEach(id => { 
        const el = document.getElementById(id);
        if(el) DOM[id] = el; 
    });
}

function escapeHTML(str) { if(!str) return ''; const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function getFileTypeIcon(type) { if (type === 'pdf') return '📄'; if (type === 'docx') return '📝'; if (type === 'zip') return '📦'; return '📎'; }
function detectFileType(file) { const name = file.name.toLowerCase(); if (name.endsWith('.pdf')) return 'pdf'; if (name.endsWith('.docx')) return 'docx'; if (name.endsWith('.zip')) return 'zip'; return 'other'; }

// ─── EXTRACCIÓN AVANZADA DE IDENTIDAD (INICIO Y FINAL DEL TEXTO) ───
function extractStudentIdentity(fileName, text) {
    if (!text) return fileName;

    // 1. Buscar con patrones explícitos
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

    // 2. Buscar al final del documento (como "VICTOR PAUCCA HUERTAS, SJ70499497")
    const lines = text.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const tailLines = lines.slice(-5); // Evaluar las últimas 5 líneas

    for (const line of tailLines) {
        // Coincide con NOMBRE APELLIDO, CÓDIGO/DNI o líneas completamente en Mayúsculas
        const matchFinal = line.match(/^([A-ZÁÉÍÓÚÑa-záéíóúñ\s]{5,50})(?:,\s*|\s+)([A-Z0-9]{5,12})$/i);
        if (matchFinal) {
            return matchFinal[1].trim() + ' (' + matchFinal[2].trim() + ')';
        }
        if (/^[A-ZÁÉÍÓÚÑ\s]{6,60}$/.test(line) && line.split(/\s+/).length >= 2) {
            return line.trim();
        }
    }

    // 3. Fallback: Nombre del archivo limpio
    return fileName.replace(/\.(pdf|docx)$/i, '').replace(/[_\-]/g, ' ');
}

// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN SEMÁNTICO (IA GEMINI)
// ═══════════════════════════════════════════════════════════
async function evaluateContentWithAI(fileName, text) {
    const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;
    const estudiante = extractStudentIdentity(fileName, text);
    
    if (wordCount < 50) {
        return {
            estudiante: estudiante, c1: 0, c1Checks: '❌ ❌ ❌', c2: 0, c2Checks: '❌ ❌ ❌', c3: 0, c3Checks: '❌ ❌ ❌',
            notaFinal: 0, wordCount: wordCount, bibliografia: { ok: false },
            observacion: '⚠️ Documento con texto insuficiente o ilegible.'
        };
    }

    const promptText = `
    Actúa como un docente evaluador universitario riguroso. Audita el siguiente texto académico:

    --- INICIO DEL TEXTO ---
    ${text.substring(0, 15000)}
    --- FIN DEL TEXTO ---

    EVALÚA ESTRICTAMENTE LOS SIGUIENTES 3 CRITERIOS. SI UN TEMA NO APARECE EN EL TEXTO, DEBES PONER FALSE Y RATING 0 EN ESE PUNTO.

    C1: NORMATIVA PERÚ (Máximo 5 puntos)
    - Tema 1: Beneficios laborales de Ley (¿Desarrolla sustento normativo peruano?)
    - Tema 2: Acoso y Hostigamiento Laboral / Sexual (¿Desarrolla sustento normativo peruano?)
    - Tema 3: Flexibilidad Horaria para Estudiantes (¿Desarrolla sustento normativo peruano?)
    * Regla C1: Asigna 1.5 pts por cada tema presente y sustentado normativamente. Max 5 pts. Si falta un tema, ese equivale a 0.

    C2: CASOS REALES Y EVIDENCIA (Máximo 7 puntos)
    - Caso Tema 1: ¿Presenta noticia/caso real peruano sobre Beneficios Laborales?
    - Caso Tema 2: ¿Presenta noticia/caso real peruano sobre Acoso/Hostigamiento Laboral?
    - Caso Tema 3: ¿Presenta noticia/caso real peruano sobre Flexibilidad Horaria?
    * Regla C2: Asigna 2.0 pts por cada caso real argumentado. Plus de 1.0 pt si coloca enlaces URL reales. Max 7 pts.

    C3: ÉTICA Y RESPONSABILIDAD PROFESIONAL EN RR.HH. (Máximo 8 puntos)
    - Check 1: ¿Presenta postura ética personal crítica? (Hasta 2.5 pts)
    - Check 2: ¿Define el rol estratégico y protector de RR.HH.? (Hasta 2.5 pts)
    - Check 3: ¿Propone acciones o estrategias de prevención/solución? (Hasta 3.0 pts)

    BIBLIOGRAFÍA:
    - ¿El texto incluye fuentes o enlaces bibliográficos al final? (true/false)

    Responde ÚNICAMENTE con un objeto JSON válido, sin formato markdown (\`\`\`json):
    {
      "c1_puntaje": numero,
      "c1_checks": [booleano_t1, booleano_t2, booleano_t3],
      "c2_puntaje": numero,
      "c2_checks": [booleano_c1, booleano_c2, booleano_c3],
      "c3_puntaje": numero,
      "c3_checks": [booleano_e1, booleano_e2, booleano_e3],
      "bibliografia_valida": booleano,
      "observaciones": "Comentario conciso resaltando lo que faltó (ejemplo: Omitió Tema 2 de Acoso)."
    }
    `;

    try {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
            })
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

        const data = await response.json();
        let aiResponseText = data.candidates[0].content.parts[0].text;
        aiResponseText = aiResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        const resIA = JSON.parse(aiResponseText);

        // Formateo de los booleans a palomitas/cruces
        const checksC1 = resIA.c1_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC2 = resIA.c2_checks.map(v => v ? '✅' : '❌').join(' ');
        const checksC3 = resIA.c3_checks.map(v => v ? '✅' : '❌').join(' ');

        const notaCalculada = resIA.c1_puntaje + resIA.c2_puntaje + resIA.c3_puntaje;
        const notaFinal = Math.min(20, Math.round(notaCalculada * 10) / 10);

        return {
            estudiante: estudiante,
            c1: resIA.c1_puntaje,
            c1Checks: checksC1,
            c2: resIA.c2_puntaje,
            c2Checks: checksC2,
            c3: resIA.c3_puntaje,
            c3Checks: checksC3,
            notaFinal: notaFinal,
            wordCount: wordCount,
            bibliografia: { ok: resIA.bibliografia_valida },
            observacion: resIA.observaciones
        };

    } catch (error) {
        console.error("Error API IA:", error);
        return {
            estudiante: estudiante,
            c1: 0, c1Checks: '❌ ❌ ❌',
            c2: 0, c2Checks: '❌ ❌ ❌',
            c3: 0, c3Checks: '❌ ❌ ❌',
            notaFinal: 0,
            wordCount: wordCount,
            bibliografia: { ok: false },
            observacion: '❌ Error de comunicación con la API de Evaluación. Verifica tu API Key.'
        };
    }
}

// ─── LECTORES (PDF/DOCX/ZIP) ───
async function extractTextFromPDF(file) {
    let arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        page.cleanup();
        await yieldUI();
    }
    await loadingTask.destroy();
    return fullText;
}

async function extractTextFromDOCX(file) {
    let arrayBuffer = await file.arrayBuffer();
    await yieldUI();
    let result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    return result.value;
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

// ─── MANEJO DE ARCHIVOS Y UI ───
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

// ─── PROCESAMIENTO EN FILA INDIA ───
async function processAllFiles() {
    if (isProcessing || archivosDetectados.length === 0) return;

    if(AI_API_KEY === "TU_API_KEY_AQUI" || !AI_API_KEY) {
        alert("Atención: Ingresa tu API Key de Gemini en la línea 8 de index.js");
        return;
    }

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
                    total += extracted.length - 1;
                } catch (e) { addError(item.name, 'Error ZIP: ' + e.message); }
                continue;
            }

            procesados++;
            if (DOM['loading-detail']) DOM['loading-detail'].textContent = 'Evaluando documento (' + procesados + '/' + total + '): ' + item.name;

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
            await new Promise(resolve => setTimeout(resolve, 1500)); // Pausa anti-saturación
        }
    } finally {
        isProcessing = false;
        if (DOM['loading-overlay']) DOM['loading-overlay'].classList.add('hidden');

        if (resultadosEvaluacion.length > 0) {
            renderTable();
        }
    }
}

// ─── RENDERIZADO DE TABLA (ALINEACIÓN EXACTA CON LAS COLUMNAS HTML) ───
function renderTable(fText) {
    fText = fText || '';
    const tbody = DOM['table-body'];
    if (!tbody) return;
    
    tbody.innerHTML = '';
    let fil = fText ? resultadosEvaluacion.filter(r => r.estudiante.toLowerCase().includes(fText.toLowerCase())) : resultadosEvaluacion;
    
    if (fil.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin resultados.</td></tr>';
        return;
    }
    
    fil.forEach((r, idx) => {
        const badgeClass = r.notaFinal >= 14 ? 'badge-success' : (r.notaFinal >= 11 ? 'badge-warning' : 'badge-danger');
        const bibIcon = r.bibliografia && r.bibliografia.ok ? '✅ Válida' : '❌ Ausente';
        
        const tr = document.createElement('tr');
        
        // Celdas perfectamente alineadas a los 9 encabezados de tu tabla HTML
        tr.innerHTML =
            `<td>${idx + 1}</td>` +
            `<td><strong>${escapeHTML(r.estudiante)}</strong></td>` +
            `<td style="text-align:center;">${r.c1} / 5<br><span style="font-size:1.1rem; letter-spacing: 2px;">${r.c1Checks}</span></td>` +
            `<td style="text-align:center;">${r.c2} / 7<br><span style="font-size:1.1rem; letter-spacing: 2px;">${r.c2Checks}</span></td>` +
            `<td style="text-align:center;">${r.c3} / 8<br><span style="font-size:1.1rem; letter-spacing: 2px;">${r.c3Checks}</span></td>` +
            `<td style="text-align:center;"><span class="badge ${badgeClass}">${r.notaFinal} / 20</span></td>` +
            `<td style="text-align:center;">${r.wordCount} pág/palabras</td>` +
            `<td style="text-align:center;">${bibIcon}</td>` +
            `<td style="font-size:0.85rem; color: #444;">${escapeHTML(r.observacion)}</td>`;
            
        tbody.appendChild(tr);
    });
}

// ─── INICIALIZACIÓN ───
document.addEventListener('DOMContentLoaded', () => {
    cacheDOM();
    checkDependencies();
    configurePDFJS();

    const dropZone = DOM['drop-zone'];
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }, false));
        dropZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) addFilesToList(e.dataTransfer.files); });
    }

    if (DOM['file-input']) DOM['file-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['folder-input']) DOM['folder-input'].addEventListener('change', function() { if (this.files.length) addFilesToList(this.files); });
    if (DOM['btn-folder']) DOM['btn-folder'].addEventListener('click', () => { if (DOM['folder-input']) DOM['folder-input'].click(); });
    if (DOM['btn-process']) DOM['btn-process'].addEventListener('click', processAllFiles);
    if (DOM['filter-input']) DOM['filter-input'].addEventListener('input', function() { renderTable(this.value); });
});
