// ═══════════════════════════════════════════════════════════
// MOTOR DE EVALUACIÓN: RIGUROSIDAD ABSOLUTA Y DETECCIÓN DUAL
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
    
    // Diccionario para inferir casos narrados por el alumno
    const narrativeActorKw = ['la empresa', 'el empleador', 'trabajador', 'colaborador', 'gerente', 'jefe', 'organizacion', 'compañia', 'recursos humanos', 'personal'];
    const narrativeActionKw = ['vulnero', 'vulneracion', 'incumplio', 'incumplimiento', 'obligo', 'afecto', 'accidente', 'despido', 'queja', 'reclamo', 'infraccion', 'abuso', 'denuncio'];

    // Funciones Evaluadoras por Bloque
    const hasT1InBlock = (b) => regexT1.test(b) || t1Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT2InBlock = (b) => regexT2.test(b) || t2Compounds.filter(kw => b.includes(kw)).length >= 2;
    const hasT3InBlock = (b) => regexT3.test(b) || t3Compounds.filter(kw => b.includes(kw)).length >= 1;
    
    // Evaluador Dual de Casos
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

    // 4. C2: CASOS REALES (Condición EXCLUSIVA de Proximidad)
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
        stanceMsg = 'Postura Legalista-Corporativa (Enfocada en evitar multas y riesgos)';
        c3Checks = [true, false, false];
    } else {
        c3Puntos = 0;
        stanceMsg = 'No se evidencia reflexión crítica clara';
    }

    // 6. RADARES ADICIONALES (APA, Conectores)
    let fortalezasExtra = [];
    const hasAPA = /\(\s*\d{4}\s*\).{0,60}?(recuperado|http|www|ley|resolucion|diario|sunafil)/i.test(normText);
    if (!hasAPA) fortalezasExtra.push('Formato APA');

    const conectores = ['sin embargo', 'por lo tanto', 'en consecuencia', 'debido a', 'adicionalmente', 'en conclusion', 'no obstante', 'asimismo', 'por ende', 'es decir'];
    if (conectores.filter(c => normText.includes(c)).length < 3) fortalezasExtra.push('Uso de conectores lógicos');

    const subtitulosProhibidos = ['tema 1', 'parte 1', 'parte 2', 'reflexion final', 'tema 2', 'tema 3'];
    if (subtitulosProhibidos.some(sub => normText.includes(sub))) fortalezasExtra.push('Redacción fluida sin subtítulos escolares');

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
