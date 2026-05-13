import USERS from './users.js';

// --- Firebase Setup ---
const db = firebase.database();
const bookingsRef = db.ref('bookings');

// --- State Management ---
let bookings = [];
let currentView = 'reservation';
let selectedDate = new Date().toISOString().split('T')[0];
let selectedTimeSlots = [];
let bookingToCancel = null;

const WORKING_HOURS = [
    '08:00', '09:00', '10:00', '11:00', '12:00', 
    '13:00', '14:00', '15:00', '16:00', '17:00'
];

// --- Initialization ---
function init() {
    setupEventListeners();
    populateUserList();
    updateDateDisplay();
    
    // Set default date in input
    document.getElementById('booking-date').value = selectedDate;

    // Migrate any existing localStorage data to Firebase (one-time)
    const localData = localStorage.getItem('sala05_bookings');
    if (localData) {
        try {
            const localBookings = JSON.parse(localData);
            localBookings.forEach(booking => {
                const { id, ...bookingData } = booking;
                bookingsRef.push(bookingData);
            });
            localStorage.removeItem('sala05_bookings');
            console.log('Dados locais migrados para Firebase com sucesso!');
        } catch (e) {
            console.error('Erro ao migrar dados locais:', e);
            localStorage.removeItem('sala05_bookings');
        }
    }

    // Firebase real-time listener — keeps data in sync across ALL users
    bookingsRef.on('value', (snapshot) => {
        bookings = [];
        const data = snapshot.val();
        if (data) {
            Object.keys(data).forEach(key => {
                bookings.push({ ...data[key], id: key });
            });
        }
        // Re-render everything when data changes
        renderTimeGrid();
        renderTodayBookings();
        updateDashboardStats();
        if (currentView === 'admin') renderAdminHistory();
    });
}

// --- DOM Elements ---
const navReservation = document.getElementById('nav-reservation');
const navAdmin = document.getElementById('nav-admin');
const reservationView = document.getElementById('reservation-view');
const adminView = document.getElementById('admin-view');
const userSelect = document.getElementById('user-select');
const timeGrid = document.getElementById('time-grid');
const bookingDateInput = document.getElementById('booking-date');
const fullDayToggle = document.getElementById('full-day-toggle');
const btnReserve = document.getElementById('btn-reserve');
const todayBookingList = document.getElementById('today-booking-list');
const historyTbody = document.getElementById('history-tbody');

// --- Functions ---

function populateUserList() {
    USERS.sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
        const option = document.createElement('option');
        option.value = user.name;
        option.textContent = user.name;
        userSelect.appendChild(option);
    });
}

function updateDateDisplay() {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const date = new Date(selectedDate + 'T12:00:00');
    document.getElementById('current-date-subtitle').textContent = date.toLocaleDateString('pt-BR', options);
}

function renderTimeGrid() {
    timeGrid.innerHTML = '';
    const dayBookings = bookings.filter(b => b.date === selectedDate && b.status === 'active');
    
    WORKING_HOURS.forEach(hour => {
        const slot = document.createElement('div');
        slot.className = 'time-slot';
        slot.textContent = hour;
        
        const isOccupied = dayBookings.some(b => b.time === hour || b.fullDay);
        
        if (isOccupied) {
            slot.classList.add('disabled');
            const booking = dayBookings.find(b => b.time === hour || b.fullDay);
            slot.title = `Reservado por: ${booking.userName}`;
        } else {
            slot.addEventListener('click', () => toggleTimeSlot(hour, slot));
        }
        
        timeGrid.appendChild(slot);
    });
}

function toggleTimeSlot(hour, element) {
    if (fullDayToggle.checked) return;
    
    if (selectedTimeSlots.includes(hour)) {
        selectedTimeSlots = selectedTimeSlots.filter(t => t !== hour);
        element.classList.remove('selected');
    } else {
        selectedTimeSlots.push(hour);
        element.classList.add('selected');
    }
}

function renderTodayBookings() {
    todayBookingList.innerHTML = '';
    const dayBookings = bookings.filter(b => b.date === selectedDate && b.status === 'active');
    
    if (dayBookings.length === 0) {
        todayBookingList.innerHTML = '<p style="text-align: center; color: var(--text-light); font-size: 0.8rem;">Nenhum agendamento para este dia.</p>';
        return;
    }

    // Group by user if it's the same full day
    const displayList = [];
    const fullDayBooking = dayBookings.find(b => b.fullDay);
    
    if (fullDayBooking) {
        displayList.push(fullDayBooking);
    } else {
        // Sort by time
        dayBookings.sort((a, b) => a.time.localeCompare(b.time)).forEach(b => displayList.push(b));
    }

    displayList.forEach(booking => {
        const item = document.createElement('div');
        item.className = 'booking-item';
        item.innerHTML = `
            <div class="booking-info">
                <h4>${booking.userName}</h4>
                <span>${booking.fullDay ? 'Dia Inteiro' : booking.time}</span>
            </div>
            <button class="btn-cancel" onclick="openCancelModal('${booking.id}')">Cancelar</button>
        `;
        todayBookingList.appendChild(item);
    });
}

function updateDashboardStats() {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = today.substring(0, 7);
    
    const todayBookings = bookings.filter(b => b.date === today && b.status === 'active').length;
    const monthBookings = bookings.filter(b => b.date.startsWith(thisMonth) && b.status === 'active').length;
    const todayCancels = bookings.filter(b => b.date === today && b.status === 'canceled').length;
    const monthCancels = bookings.filter(b => b.date.startsWith(thisMonth) && b.status === 'canceled').length;
    
    const totalMonthActions = monthBookings + monthCancels;
    const cancelRate = totalMonthActions > 0 ? Math.round((monthCancels / totalMonthActions) * 100) : 0;
    
    document.getElementById('stats-today-bookings').textContent = todayBookings;
    document.getElementById('stats-month-bookings').textContent = monthBookings;
    document.getElementById('stats-today-cancels').textContent = todayCancels;
    document.getElementById('stats-month-cancel-rate').textContent = `${cancelRate}%`;
}

function handleReserve() {
    const userName = userSelect.value;
    const isFullDay = fullDayToggle.checked;
    
    if (!userName) {
        alert('Por favor, selecione seu nome.');
        return;
    }
    
    if (!isFullDay && selectedTimeSlots.length === 0) {
        alert('Por favor, selecione ao menos um horário.');
        return;
    }

    const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        alert('Reservas permitidas apenas de segunda a sexta-feira.');
        return;
    }

    const timestamp = new Date().toISOString();

    if (isFullDay) {
        // Push full-day booking to Firebase
        bookingsRef.push({
            userName,
            date: selectedDate,
            time: '08:00 - 18:00',
            fullDay: true,
            status: 'active',
            keyReceived: false,
            timestamp
        });
    } else {
        // Push each time slot booking to Firebase
        selectedTimeSlots.forEach(time => {
            bookingsRef.push({
                userName,
                date: selectedDate,
                time,
                fullDay: false,
                status: 'active',
                keyReceived: false,
                timestamp
            });
        });
    }

    showConfirmation(`Reserva realizada com sucesso para ${userName} no dia ${selectedDate}.`);
    
    // Reset selection
    selectedTimeSlots = [];
    fullDayToggle.checked = false;
    // Firebase real-time listener will auto-refresh the UI
}

// --- Admin History ---
function renderAdminHistory() {
    historyTbody.innerHTML = '';
    const sorted = [...bookings].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    sorted.forEach(b => {
        const tr = document.createElement('tr');
        const dateObj = new Date(b.date + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('pt-BR');
        
        tr.innerHTML = `
            <td>${formattedDate} ${b.fullDay ? '' : b.time}</td>
            <td>${b.userName}</td>
            <td>${b.fullDay ? 'Dia Todo' : 'Horário'}</td>
            <td><span class="badge badge-${b.status}">${b.status === 'active' ? 'Ativo' : 'Cancelado'}</span></td>
            <td>
                ${b.status === 'active' ? 
                    (b.keyReceived ? 
                        '<span class="badge badge-key-received">Chave Recebida</span>' : 
                        '<span class="badge badge-key">Pendente</span>'
                    ) : '-'
                }
            </td>
            <td>
                ${(b.status === 'active' && !b.keyReceived) ? 
                    `<button class="btn btn-primary" style="padding: 0.25rem 0.5rem; font-size: 0.7rem; width: auto;" onclick="confirmKey('${b.id}')">Recebi Chave</button>` : 
                    ''
                }
                ${b.status === 'active' ? 
                    `<button class="btn-cancel" onclick="openCancelModal('${b.id}')">Excluir</button>` : 
                    ''
                }
            </td>
        `;
        historyTbody.appendChild(tr);
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    navReservation.addEventListener('click', () => {
        switchView('reservation');
    });

    navAdmin.addEventListener('click', () => {
        openAdminAuth();
    });

    bookingDateInput.addEventListener('change', (e) => {
        selectedDate = e.target.value;
        updateDateDisplay();
        selectedTimeSlots = [];
        renderTimeGrid();
        renderTodayBookings();
    });

    fullDayToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            selectedTimeSlots = [];
            renderTimeGrid();
        }
    });

    btnReserve.addEventListener('click', handleReserve);

    // Modal Events
    document.getElementById('btn-close-modal').addEventListener('click', () => {
        document.getElementById('password-modal').classList.remove('display-flex');
        document.getElementById('password-modal').style.display = 'none';
    });

    document.getElementById('btn-confirm-cancel').addEventListener('click', handleCancel);

    document.getElementById('btn-close-confirm').addEventListener('click', () => {
        document.getElementById('confirm-modal').style.display = 'none';
    });

    document.getElementById('btn-close-admin-modal').addEventListener('click', () => {
        document.getElementById('admin-auth-modal').style.display = 'none';
    });

    document.getElementById('btn-login-admin').addEventListener('click', handleAdminLogin);
}

function switchView(view) {
    currentView = view;
    if (view === 'reservation') {
        reservationView.classList.remove('hidden');
        adminView.classList.add('hidden');
        navReservation.classList.add('active');
        navAdmin.classList.remove('active');
        updateDashboardStats();
    } else {
        reservationView.classList.add('hidden');
        adminView.classList.remove('hidden');
        navReservation.classList.remove('active');
        navAdmin.classList.add('active');
        renderAdminHistory();
    }
}

// --- Modals & Handlers ---

window.openCancelModal = function(id) {
    bookingToCancel = id;
    document.getElementById('password-modal').style.display = 'flex';
    document.getElementById('cancel-password').value = '';
};

function handleCancel() {
    const password = document.getElementById('cancel-password').value;
    const booking = bookings.find(b => b.id === bookingToCancel);
    
    if (!booking) return;

    const user = USERS.find(u => u.name === booking.userName);
    const admin = USERS.find(u => u.isAdmin);

    if (password === user.password || password === admin.password) {
        // Update status in Firebase — real-time listener handles re-rendering
        bookingsRef.child(booking.id).update({ status: 'canceled' });
        document.getElementById('password-modal').style.display = 'none';
        alert('Reserva cancelada com sucesso.');
    } else {
        alert('Senha incorreta.');
    }
}

function openAdminAuth() {
    document.getElementById('admin-auth-modal').style.display = 'flex';
    document.getElementById('admin-password').value = '';
}

function handleAdminLogin() {
    const password = document.getElementById('admin-password').value;
    const admin = USERS.find(u => u.isAdmin);
    
    if (password === admin.password) {
        document.getElementById('admin-auth-modal').style.display = 'none';
        switchView('admin');
    } else {
        alert('Senha administrativa incorreta.');
    }
}

window.confirmKey = function(id) {
    // Update keyReceived in Firebase — real-time listener handles re-rendering
    bookingsRef.child(id).update({ keyReceived: true });
};

function showConfirmation(msg) {
    document.getElementById('confirm-message').textContent = msg;
    document.getElementById('confirm-modal').style.display = 'flex';
}

// --- Start ---
init();
