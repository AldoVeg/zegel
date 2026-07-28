// ═══════════════════════════════════════════════════════════
// 1. DICCIONARIOS EXHAUSTIVOS (FILTROS DE RECONOCIMIENTO)
// ═══════════════════════════════════════════════════════════

const DICCIONARIO = {
    T1: {
        normas: ['ley 29783', 'ley 27735', 'dl 713', 'dl 650', 'dl 892', 'ds 005 2012', 'ley 25129', 'ley 26790', 'ley 30056'],
        conceptos: ['seguridad y salud', 'cts', 'compensacion por tiempo', 'gratificacion', 'asignacion familiar', 'utilidades', 'descanso vacacional', 'horas extras', 'riesgos laborales', 'seguro de vida ley']
    },
    T2: {
        normas: ['ley 27942', 'convenio 190', 'ds 014 2019', 'ley 31156', 'dl 1410'],
        conceptos: ['hostigamiento sexual', 'acoso sexual', 'acoso laboral', 'comite de intervencion', 'chantaje sexual', 'violencia laboral', 'ambiente hostil', 'conducta no deseada', 'comite frente al hostigamiento']
    },
    T3: {
        normas: ['ley 28518', 'ds 011 2012', 'ley 31396'],
        conceptos: ['modalidad formativa', 'practicas preprofesionales', 'practicas profesionales', 'convenio de practicas', 'jornada formativa', 'subvencion economica', 'facilidades horarias', 'practicante']
    },
    NARRATIVA_CASO: {
        actores: ['trabajador', 'trabajadora', 'empleador', 'empresa', 'colaborador', 'demandante', 'gerente', 'jefe', 'practicante', 'victima', 'inspector', 'sindicato', 'recursos humanos', 'rrhh'],
        conflictos: ['despidio', 'incumplio', 'vulnero', 'demando', 'sanciono', 'sufrio', 'acoso', 'accidento', 'omitio', 'reclamo', 'denuncio', 'multo', 'afecto', 'obligo', 'coacciono', 'no pago', 'accidente de trabajo'],
        contextoLegal: ['sunafil', 'el peruano', 'tribunal constitucional', 'corte suprema', 'expediente', 'casacion', 'resolucion', 'sentencia', 'multa', 'inspeccion', 'demanda laboral', 'conciliacion']
    }
};

// ═══════════════════════════════════════════════════════════
// 2. MOTOR DE EVALUACIÓN MINUCIOSO (Reemplazar evaluateContent)
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
            observacion: 'Ausenta: Contenido mínimo. Documento insuficiente o vacío.'
        };
    }

    // Dividimos en bloques (párrafos) para evaluar el contexto de cerca
    const bloques = text.split(/(?:\r?\n){2,}|\.\s+/).map(function(p) { return normalizeText(p); }).filter(function(p) { return p.length > 30; });

    // Variables para medir la DENSIDAD de cada tema (soluciona el "desarrollo insuficiente" de C1)
    let palabrasT1 = 0, palabrasT2 = 0, palabrasT3 = 0;
    let hasT1_Case = false, hasT2_Case = false, hasT3_Case = false;

    // Evaluamos bloque a bloque
    bloques.forEach(function(bloque) {
        const palabrasEnBloque = bloque.split(/\s+/).length;

        // Detectar presencia de temas en el bloque
        const esT1 = DICCIONARIO.T1.normas.some(kw => bloque.includes(kw)) || DICCIONARIO.T1.conceptos.some(kw => bloque.includes(kw));
        const esT2 = DICCIONARIO.T2.normas.some(kw => bloque.includes(kw)) || DICCIONARIO.T2.conceptos.some(kw => bloque.includes(kw));
        const esT3 = DICCIONARIO.T3.normas.some(kw => bloque.includes(kw)) || DICCIONARIO.T3.conceptos.some(kw => bloque.includes(kw));

        // Acumular palabras si el tema se está desarrollando (Para C1)
        if (esT1) palabrasT1 += palabrasEnBloque;
        if (esT2) palabrasT2 += palabrasEnBloque;
        if (esT3) palabrasT3 += palabrasEnBloque;

        // Evaluación estricta de Casos Narrativos (Para C2)
        const tieneActor = DICCIONARIO.NARRATIVA_CASO.actores.some(kw => bloque.includes(kw));
        const tieneConflicto = DICCIONARIO.NARRATIVA_CASO.conflictos.some(kw => bloque.includes(kw));
        const tieneContextoLegal = DICCIONARIO.NARRATIVA_CASO.contextoLegal.some(kw => bloque.includes(kw));

        // Un caso real requiere: (Actor + Conflicto) O (Mención a expediente/Sunafil/Resolución)
        if ((tieneActor && tieneConflicto) || tieneContextoLegal) {
            if (esT1) hasT1_Case = true;
            if (esT2) hasT2_Case = true;
            if (esT3) hasT3_Case = true;
        }
    });

    // ─── CRITERIO 1: Análisis Normativo (Exige mínimo 40 palabras por tema para ser válido) ───
    // Esto atrapa el caso de "Andrea" donde T3 es muy cortito (insuficiente).
    const UMBRAL_PALABRAS = 40; 
    const hasT1_Norm = palabrasT1 >= UMBRAL_PALABRAS;
    const hasT2_Norm = palabrasT2 >= UMBRAL_PALABRAS;
    const hasT3_Norm = palabrasT3 >= UMBRAL_PALABRAS;

    const c1Checks = [hasT1_Norm, hasT2_Norm, hasT3_Norm];
    const c1Puntos = c1Checks.filter(Boolean).length * 2; // 2 puntos por tema bien desarrollado

    // ─── CRITERIO 2: Desarrollo de Casos ───
    const c2Checks = [hasT1_Case, hasT2_Case, hasT3_Case];
    const c2Puntos = c2Checks.filter(Boolean).length * 2; // 2 puntos por caso detectado

    // ─── CRITERIO 3: Reflexión Ética ───
    const kwHumanista = ['dignidad', 'bienestar', 'justicia', 'equidad', 'vulnerabilidad', 'empatia', 'derechos humanos', 'desarrollo integral', 'salud mental', 'prevencion', 'integridad', 'respeto'];
    const kwLegalista = ['multa', 'sancion', 'reglamento', 'contingencia', 'demanda', 'indemnizacion', 'evitar sanciones', 'riesgos legales', 'reputacion'];
    const kwDeficiente = ['exageracion', 'inevitable', 'costoso', 'tradicion', 'informalidad', 'necesidades del negocio', 'no es obligatorio', 'trabajador debe adaptarse'];

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

    // ─── DIAGNÓSTICO SINTÉTICO ───
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText);
    
    const ausencias = [];
    if (!hasT1_Norm) ausencias.push(palabrasT1 > 0 ? 'T1 (Insuficiente)' : 'T1 (Ausente)');
    if (!hasT2_Norm) ausencias.push(palabrasT2 > 0 ? 'T2 (Insuficiente)' : 'T2 (Ausente)');
    if (!hasT3_Norm) ausencias.push(palabrasT3 > 0 ? 'T3 (Insuficiente)' : 'T3 (Ausente)');
    
    if (!hasT1_Case && hasT1_Norm) ausencias.push('Caso T1');
    if (!hasT2_Case && hasT2_Norm) ausencias.push('Caso T2');
    if (!hasT3_Case && hasT3_Norm) ausencias.push('Caso T3');

    let diagnostico = 'Observaciones: ' + (ausencias.length > 0 ? ausencias.join(', ') : 'Ninguna omisión') + '. | ';
    diagnostico += stanceMsg + '.';

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
