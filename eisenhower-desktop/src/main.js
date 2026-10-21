import { db, auth } from './firebase.js';
import { 
    signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut 
} from "firebase/auth";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { getCurrentWindow } from '@tauri-apps/api/window'; // NUEVO: API de ventana

import flatpickr from "flatpickr";
import { Spanish } from "flatpickr/dist/l10n/es.js";
import confirmDatePlugin from 'flatpickr/dist/plugins/confirmDate/confirmDate.js';

let currentUser = null;
let tareasActuales = []; 
let cuadranteSeleccionado = "";
let recordatoriosTemporales = []; 
let editingTaskId = null; 
let draggedElement = null;

const appWindow = getCurrentWindow(); // NUEVO

// Elementos UI
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const btnLogin = document.getElementById('btn-login');
const btnSignup = document.getElementById('btn-signup');
const btnLogout = document.getElementById('btn-logout');
const authMessage = document.getElementById('auth-message');
const modalForm = document.getElementById('modal-form');
const modalColors = document.getElementById('modal-colors');

// --- CONFIGURACIÓN DE VENTANA Y TEMA ---
// Botón Fijar arriba
document.getElementById('btn-pin').addEventListener('click', async (e) => {
    const isPinned = await appWindow.isAlwaysOnTop();
    await appWindow.setAlwaysOnTop(!isPinned);
    e.target.classList.toggle('active');
});

// Modo Claro / Oscuro
const btnTheme = document.getElementById('btn-theme');
btnTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    btnTheme.textContent = isLight ? '🌙' : '☀️';
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

// Cargar tema guardado
if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    btnTheme.textContent = '🌙';
}

// --- PERSONALIZACIÓN DE COLORES ---
const btnColors = document.getElementById('btn-colors');
btnColors.addEventListener('click', () => {
    // Cargar valores actuales de CSS
    const style = getComputedStyle(document.documentElement);
    document.getElementById('color-do').value = rgbToHex(style.getPropertyValue('--color-do').trim());
    document.getElementById('color-schedule').value = rgbToHex(style.getPropertyValue('--color-schedule').trim());
    document.getElementById('color-delegate').value = rgbToHex(style.getPropertyValue('--color-delegate').trim());
    document.getElementById('color-eliminate').value = rgbToHex(style.getPropertyValue('--color-eliminate').trim());
    
    modalColors.style.display = 'flex';
});

window.cerrarColores = () => modalColors.style.display = 'none';

document.getElementById('btn-save-colors').addEventListener('click', () => {
    const cDo = document.getElementById('color-do').value;
    const cSched = document.getElementById('color-schedule').value;
    const cDel = document.getElementById('color-delegate').value;
    const cElim = document.getElementById('color-eliminate').value;

    document.documentElement.style.setProperty('--color-do', cDo);
    document.documentElement.style.setProperty('--color-schedule', cSched);
    document.documentElement.style.setProperty('--color-delegate', cDel);
    document.documentElement.style.setProperty('--color-eliminate', cElim);

    // Guardar en localStorage
    localStorage.setItem('color-do', cDo);
    localStorage.setItem('color-schedule', cSched);
    localStorage.setItem('color-delegate', cDel);
    localStorage.setItem('color-eliminate', cElim);

    cerrarColores();
});

// Cargar colores guardados
['do', 'schedule', 'delegate', 'eliminate'].forEach(c => {
    const saved = localStorage.getItem(`color-${c}`);
    if (saved) document.documentElement.style.setProperty(`--color-${c}`, saved);
});

// Utilidad para convertir rgb a hex para el input color
function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    const colors = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!colors) return "#000000";
    function hex(x) { return ("0" + parseInt(x).toString(16)).slice(-2); }
    return "#" + hex(colors[1]) + hex(colors[2]) + hex(colors[3]);
}

// --- CALENDARIO ---
const configCalendario = {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    locale: Spanish,
    time_24hr: true,
    plugins: [ new confirmDatePlugin({ confirmText: "Aceptar", showAlways: true, theme: "dark" }) ]
};

const pickerTaskDate = flatpickr("#task-date", configCalendario);
const pickerReminderDate = flatpickr("#reminder-date", configCalendario);

modalForm.addEventListener('mousedown', (e) => {
    if (e.target === modalForm) cerrarFormulario();
});

// --- AUTENTICACIÓN Y FIREBASE (Sin cambios) ---
btnLogin.addEventListener('click', () => {
    signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value)
        .then(() => authMessage.textContent = "")
        .catch(() => authMessage.textContent = "Error: Correo o contraseña incorrectos.");
});

btnSignup.addEventListener('click', () => {
    createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value)
        .then(() => authMessage.textContent = "")
        .catch((error) => authMessage.textContent = "Error: " + error.message);
});

btnLogout.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authContainer.style.display = 'none';
        appContainer.style.display = 'flex'; // flex para que ocupe el 90vh
        cargarTareas(user.uid);
    } else {
        currentUser = null;
        authContainer.style.display = 'block';
        appContainer.style.display = 'none';
        limpiarListas();
    }
});

function cargarTareas(userId) {
    const docRef = doc(db, 'users', userId, 'tasks', 'sync_data');
    onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            tareasActuales = data.tasks || []; 
            renderizarTareas();
        }
    });
}

window.toggleCompletadas = (cuadrante) => {
    const lista = document.getElementById(`lista-completadas-${cuadrante}`);
    const arrow = lista.previousElementSibling.querySelector('.arrow');
    if (lista.style.display === 'none') {
        lista.style.display = 'block';
        arrow.classList.add('rotated');
    } else {
        lista.style.display = 'none';
        arrow.classList.remove('rotated');
    }
};

function renderizarTareas() {
    document.querySelectorAll('ul').forEach(ul => ul.innerHTML = '');
    let completadasCount = { do: 0, schedule: 0, delegate: 0, eliminate: 0 };
    tareasActuales.sort((a, b) => (a.order || 0) - (b.order || 0));

    tareasActuales.forEach(tarea => {
        if (!tarea.title) return;
        const cuadranteSeguro = ['do', 'schedule', 'delegate', 'eliminate'].includes(tarea.quadrant) ? tarea.quadrant : 'do';
        
        if (tarea.done) {
            agregarTareaALaPantalla(tarea, `lista-completadas-${cuadranteSeguro}`);
            completadasCount[cuadranteSeguro]++;
        } else {
            agregarTareaALaPantalla(tarea, `lista-${cuadranteSeguro}`);
        }
    });

    ['do', 'schedule', 'delegate', 'eliminate'].forEach(c => {
        const header = document.getElementById(`lista-completadas-${c}`).previousElementSibling;
        header.querySelector('span').textContent = `Completadas (${completadasCount[c]})`;
    });
}

function agregarTareaALaPantalla(tarea, idLista) {
    const lista = document.getElementById(idLista);
    if (!lista) return;

    const li = document.createElement('li');
    li.className = 'task-item';
    li.draggable = true; 
    li.dataset.id = tarea.id; 
    li.dataset.quadrant = tarea.quadrant;
    
    const btnComplete = document.createElement('button');
    btnComplete.className = `btn-complete ${tarea.done ? 'is-done' : ''}`;
    btnComplete.innerHTML = tarea.done ? '✓' : '';
    btnComplete.onclick = (e) => { e.stopPropagation(); toggleCompletada(tarea.id); };

    const contentDiv = document.createElement('div');
    contentDiv.className = 'task-content';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'task-title';
    titleSpan.textContent = tarea.title;
    contentDiv.appendChild(titleSpan);

    if (tarea.dueAt) {
        const dateSpan = document.createElement('span');
        dateSpan.className = 'task-date';
        const fecha = new Date(tarea.dueAt);
        dateSpan.textContent = `📅 ${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
        contentDiv.appendChild(dateSpan);
    }

    contentDiv.onclick = () => abrirFormulario(tarea.quadrant, tarea);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete';
    btnDelete.innerHTML = '✕';
    btnDelete.onclick = (e) => { e.stopPropagation(); eliminarTarea(tarea.id); };

    li.appendChild(btnComplete);
    li.appendChild(contentDiv);
    li.appendChild(btnDelete);

    li.addEventListener('dragstart', (e) => {
        draggedElement = li;
        e.dataTransfer.setData('text/plain', tarea.id);
        setTimeout(() => li.style.display = 'none', 0);
    });

    li.addEventListener('dragend', () => {
        li.style.display = 'flex';
        draggedElement = null;
    });

    li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedElement && draggedElement !== li) li.classList.add('drag-over');
    });

    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));

    li.addEventListener('drop', async (e) => {
        e.preventDefault();
        li.classList.remove('drag-over');
        if (!draggedElement || draggedElement === li) return;

        const draggedId = parseInt(draggedElement.dataset.id);
        const targetId = parseInt(li.dataset.id);
        
        const draggedIndex = tareasActuales.findIndex(t => t.id === draggedId);
        const targetIndex = tareasActuales.findIndex(t => t.id === targetId);

        if (draggedIndex > -1 && targetIndex > -1) {
            tareasActuales[draggedIndex].quadrant = li.dataset.quadrant;
            const [movedTask] = tareasActuales.splice(draggedIndex, 1);
            tareasActuales.splice(targetIndex, 0, movedTask);
            tareasActuales.forEach((t, index) => { t.order = index; t.updatedAt = Date.now(); });
            await guardarEnFirebase(tareasActuales);
        }
    });

    lista.appendChild(li);
}

async function toggleCompletada(id) {
    const tareaIndex = tareasActuales.findIndex(t => t.id === id);
    if (tareaIndex > -1) {
        tareasActuales[tareaIndex].done = !tareasActuales[tareaIndex].done;
        tareasActuales[tareaIndex].updatedAt = Date.now();
        await guardarEnFirebase(tareasActuales);
    }
}

function limpiarListas() {
    document.querySelectorAll('ul').forEach(ul => ul.innerHTML = '');
}

window.abrirFormulario = (cuadrante, tareaAEditar = null) => {
    cuadranteSeleccionado = cuadrante;
    recordatoriosTemporales = []; 
    document.getElementById('lista-recordatorios').innerHTML = '';
    pickerTaskDate.clear();
    pickerReminderDate.clear();
    
    if (tareaAEditar) {
        editingTaskId = tareaAEditar.id;
        document.getElementById('modal-title').textContent = "Editar Tarea";
        document.getElementById('task-title').value = tareaAEditar.title;
        if (tareaAEditar.dueAt) pickerTaskDate.setDate(new Date(tareaAEditar.dueAt));

        if (tareaAEditar.reminders && tareaAEditar.reminders.length > 0) {
            recordatoriosTemporales = [...tareaAEditar.reminders];
            recordatoriosTemporales.forEach((ts, index) => agregarRecordatorioAListaUI(ts, index));
        }
    } else {
        editingTaskId = null;
        document.getElementById('modal-title').textContent = "Nueva Tarea";
        document.getElementById('task-title').value = '';
    }

    modalForm.style.display = 'flex';
    document.getElementById('task-title').focus();
};

window.cerrarFormulario = () => {
    modalForm.style.display = 'none';
    editingTaskId = null;
    pickerTaskDate.close();
    pickerReminderDate.close();
};

window.agregarRecordatorio = () => {
    const fechaSeleccionada = pickerReminderDate.selectedDates[0];
    if (!fechaSeleccionada) return alert("Selecciona fecha y hora");
    const timestamp = fechaSeleccionada.getTime();
    recordatoriosTemporales.push(timestamp);
    agregarRecordatorioAListaUI(timestamp, recordatoriosTemporales.length - 1);
    pickerReminderDate.clear(); 
};

window.borrarRecordatorioUI = (index) => {
    recordatoriosTemporales.splice(index, 1);
    document.getElementById('lista-recordatorios').innerHTML = '';
    recordatoriosTemporales.forEach((ts, i) => agregarRecordatorioAListaUI(ts, i));
};

function agregarRecordatorioAListaUI(timestamp, index) {
    const li = document.createElement('li');
    li.className = 'reminder-item';
    const fecha = new Date(timestamp);
    const span = document.createElement('span');
    span.textContent = `${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    const btnDel = document.createElement('button');
    btnDel.className = 'btn-remove-reminder';
    btnDel.innerHTML = '✕';
    btnDel.onclick = () => window.borrarRecordatorioUI(index);
    li.appendChild(span);
    li.appendChild(btnDel);
    document.getElementById('lista-recordatorios').appendChild(li);
}

document.getElementById('btn-save-task').addEventListener('click', async () => {
    const titulo = document.getElementById('task-title').value.trim();
    const fechaSeleccionada = pickerTaskDate.selectedDates[0];
    if (!titulo) return alert("Escribe un título");

    let dueAt = null;
    if (fechaSeleccionada) dueAt = fechaSeleccionada.getTime();

    if (editingTaskId) {
        const index = tareasActuales.findIndex(t => t.id === editingTaskId);
        if (index > -1) {
            tareasActuales[index].title = titulo;
            tareasActuales[index].dueAt = dueAt;
            tareasActuales[index].reminders = recordatoriosTemporales;
            tareasActuales[index].updatedAt = Date.now();
        }
    } else {
        const maxOrder = tareasActuales.length > 0 ? Math.max(...tareasActuales.map(t => t.order || 0)) + 1 : 0;
        const nuevaTarea = {
            id: Date.now(), title: titulo, quadrant: cuadranteSeleccionado, done: false,
            dueAt: dueAt, createdAt: Date.now(), updatedAt: Date.now(), order: maxOrder,
            reminders: recordatoriosTemporales, isEvent: false, advanceNoticeDays: 0,
            quadrantBeforeEvent: "", quadrantOnEventDay: "", recurrence: "NONE",
            recurrenceDayOfWeek: 0, recurrenceDayOfMonth: 0
        };
        tareasActuales.push(nuevaTarea);
    }

    await guardarEnFirebase(tareasActuales);
    cerrarFormulario();
});

async function eliminarTarea(id) {
    if (confirm("¿Seguro que quieres eliminar esta tarea?")) {
        const nuevasTareas = tareasActuales.filter(t => t.id !== id);
        await guardarEnFirebase(nuevasTareas);
    }
}

window.allowDrop = (ev) => ev.preventDefault();

window.drop = async (ev, nuevoCuadrante) => {
    ev.preventDefault();
    if (ev.target.tagName === 'LI' || ev.target.closest('li')) return;
    if (!draggedElement) return;
    const tareaId = parseInt(draggedElement.dataset.id);
    const tareaIndex = tareasActuales.findIndex(t => t.id === tareaId);
    if (tareaIndex > -1 && tareasActuales[tareaIndex].quadrant !== nuevoCuadrante) {
        tareasActuales[tareaIndex].quadrant = nuevoCuadrante;
        tareasActuales[tareaIndex].updatedAt = Date.now();
        tareasActuales[tareaIndex].order = Math.max(...tareasActuales.map(t => t.order || 0)) + 1;
        await guardarEnFirebase(tareasActuales);
    }
};

async function guardarEnFirebase(arrayDeTareas) {
    if (!currentUser) return;
    const docRef = doc(db, 'users', currentUser.uid, 'tasks', 'sync_data');
    await updateDoc(docRef, { tasks: arrayDeTareas });
}