/* ============================================================
   index.js — Lógica del Sistema de Evaluación Automatizada
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Verificación de librerías CDN (Prometido en el HTML)
    const cdnAlert = document.getElementById('cdn-alert');
    const cdnAlertText = document.getElementById('cdn-alert-text');
    
    // Validamos si existen los objetos globales de las librerías
    const libsLoaded = (window.pdfjsLib && window.jspdf && window.mammoth && window.JSZip);
    
    if (libsLoaded) {
        cdnAlert.classList.add('hidden'); // Ocultamos la alerta si todo está bien
    } else {
        cdnAlertText.textContent = "Error: No se pudieron cargar algunas librerías. Verifica tu conexión a internet.";
        cdnAlert.classList.remove('hidden');
    }

    // 2. Referencias al DOM (Conectando con IDs de index.html)
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const btnFolder = document.getElementById('btn-folder');
    const folderInput = document.getElementById('folder-input');
    
    // Contenedores visuales
    const fileList = document.getElementById('file-list');
    const fileListItems = document.getElementById('file-list-items');
    const fileCount = document.getElementById('file-count');
    
    // 3. Lógica visual para la zona de arrastrar y soltar (Drag & Drop)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Efecto hover (activa tu clase .dragover del CSS)
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    // 4. Captura de archivos
    dropZone.addEventListener('drop', (e) => {
        let dt = e.dataTransfer;
        let files = dt.files;
        handleFiles(files);
    });

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    btnFolder.addEventListener('click', () => {
        folderInput.click();
    });

    folderInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    // Función base para procesar archivos detectados
    function handleFiles(files) {
        if (files.length > 0) {
            fileList.classList.remove('hidden');
            fileCount.textContent = files.length;
            // Aquí irá tu lógica para contar PDFs, DOCX, crear los chips visuales y evaluar.
            console.log("Archivos detectados:", files);
        }
    }
});
