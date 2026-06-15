
// --- Firebase Setup ---
const db = firebase.database();
const bookingsRef = db.ref('bookings');

// --- State Management ---
let bookings = [];
let currentView = 'reservation';
let usageChartInstance = null;

// Initialize with local date (YYYY-MM-DD)
function getLocalDateString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return (new Date(now - offset)).toISOString().split('T')[0];
}

let selectedDate = getLocalDateString();
let selectedTimeSlots = [];
let bookingToCancel = null;

// Chart filters
const nowChart = new Date();
const firstDay = new Date(nowChart.getFullYear(), nowChart.getMonth(), 1);
const lastDay = new Date(nowChart.getFullYear(), nowChart.getMonth() + 1, 0);

let chartStartDate = new Date(firstDay - firstDay.getTimezoneOffset() * 60000).toISOString().split('T')[0];
let chartEndDate = new Date(lastDay - lastDay.getTimezoneOffset() * 60000).toISOString().split('T')[0];

const WORKING_HOURS = [
    '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', 
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'
];

function timeToMins(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function formatBookingTime(booking) {
    if (booking.fullDay) return 'Dia Inteiro (08h - 18h)';
    const start = timeToMins(booking.time);
    const duration = booking.duration || 60;
    const end = start + duration;
    const endH = Math.floor(end / 60).toString().padStart(2, '0');
    const endM = (end % 60).toString().padStart(2, '0');
    return `${booking.time} às ${endH}:${endM}`;
}


// --- Initialization ---
function init() {
    setupEventListeners();
    populateUserList();
    updateDateDisplay();
    setupConnectionListener();
    startLiveClock();
    
    // Set default date in input
    document.getElementById('booking-date').value = selectedDate;
    
    const now = new Date();
    document.getElementById('chart-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('chart-start-date').value = chartStartDate;
    document.getElementById('chart-end-date').value = chartEndDate;

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
        if (currentView === 'admin') {
            renderAdminHistory();
            renderUsageChart();
        }
    }, (error) => {
        console.error('Erro no Firebase Listener:', error);
        alert('Erro ao sincronizar dados. Por favor, verifique se sua conexão está ativa ou se as regras do banco expiraram.');
    });
}

function setupConnectionListener() {
    const statusEl = document.getElementById('connection-status');
    const statusText = statusEl.querySelector('.status-text');
    const connectedRef = firebase.database().ref(".info/connected");

    connectedRef.on("value", (snap) => {
        if (snap.val() === true) {
            statusEl.classList.remove('offline');
            statusEl.classList.add('online');
            statusText.textContent = 'Conectado';
        } else {
            statusEl.classList.remove('online');
            statusEl.classList.add('offline');
            statusText.textContent = 'Offline';
        }
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
const durationRadios = document.getElementsByName('duration');
const btnReserve = document.getElementById('btn-reserve');
const todayBookingList = document.getElementById('today-booking-list');
const historyTbody = document.getElementById('history-tbody');

function getSelectedDuration() {
    for (const radio of durationRadios) {
        if (radio.checked) return radio.value;
    }
    return '60';
}

// --- Functions ---

function populateUserList() {
    USERS.sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
        const option = document.createElement('option');
        option.value = user.name;
        option.textContent = user.name;
        userSelect.appendChild(option);
    });
}

function startLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;
    
    function updateClock() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('pt-BR');
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

function updateDateDisplay() {
    const options = { weekday: 'long', day: 'numeric', month: 'long' };
    const date = new Date(selectedDate + 'T12:00:00');
    document.getElementById('current-date-subtitle').textContent = date.toLocaleDateString('pt-BR', options);
}

function renderTimeGrid() {
    timeGrid.innerHTML = '';
    const dayBookings = bookings.filter(b => b.date === selectedDate && b.status === 'active');
    const selectedDur = getSelectedDuration();
    
    if (selectedDur === 'fullday') {
        timeGrid.innerHTML = '<p style="text-align: center; grid-column: 1 / -1; color: var(--text-light); font-size: 0.9rem;">Você selecionou "Dia Todo". Nenhuma seleção de horário individual é necessária.</p>';
        return;
    }

    const slotDuration = parseInt(selectedDur, 10);
    
    WORKING_HOURS.forEach(hour => {
        const slot = document.createElement('div');
        slot.className = 'time-slot';
        slot.textContent = hour;
        
        const slotStart = timeToMins(hour);
        const slotEnd = slotStart + slotDuration;
        
        // Check if this slot overlaps with ANY existing booking
        const overlappingBooking = dayBookings.find(b => {
            if (b.fullDay) return true;
            const bStart = timeToMins(b.time);
            const bDuration = b.duration || 60; // Backward compatible
            const bEnd = bStart + bDuration;
            
            return slotStart < bEnd && slotEnd > bStart;
        });
        
        if (overlappingBooking) {
            slot.classList.add('disabled');
            slot.title = `Bloqueado por reserva de: ${overlappingBooking.userName}`;
        } else {
            // Check if it's visually selected or part of a selection
            const isSelected = selectedTimeSlots.some(selHour => {
                const selStart = timeToMins(selHour);
                const selEnd = selStart + slotDuration;
                return slotStart >= selStart && slotStart < selEnd;
            });

            if (isSelected) {
                slot.classList.add('selected');
            }
            
            slot.addEventListener('click', () => {
                // If it's the exact start of a selected slot, remove it
                if (selectedTimeSlots.includes(hour)) {
                    selectedTimeSlots = selectedTimeSlots.filter(t => t !== hour);
                } else {
                    // Check if adding this would overlap with an ALREADY SELECTED slot
                    const overlapsSelection = selectedTimeSlots.some(selHour => {
                        const selStart = timeToMins(selHour);
                        const selEnd = selStart + slotDuration;
                        return slotStart < selEnd && slotEnd > selStart;
                    });
                    if (!overlapsSelection) {
                        selectedTimeSlots.push(hour);
                    }
                }
                renderTimeGrid();
            });
        }
        
        timeGrid.appendChild(slot);
    });
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
                <span>${formatBookingTime(booking)}</span>
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
    const selectedDur = getSelectedDuration();
    const isFullDay = selectedDur === 'fullday';
    
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

    // Show loading state
    btnReserve.disabled = true;

    const timestamp = new Date().toISOString();
    const promises = [];

    if (isFullDay) {
        promises.push(bookingsRef.push({
            userName,
            date: selectedDate,
            time: '08:00',
            fullDay: true,
            status: 'active',
            keyReceived: false,
            timestamp
        }));
    } else {
        const duration = parseInt(selectedDur, 10);
        selectedTimeSlots.forEach(time => {
            promises.push(bookingsRef.push({
                userName,
                date: selectedDate,
                time,
                duration,
                fullDay: false,
                status: 'active',
                keyReceived: false,
                timestamp
            }));
        });
    }

    Promise.all(promises)
        .then(() => {
            showConfirmation(`Reserva realizada com sucesso para ${userName} no dia ${selectedDate}.`);
            // Reset selection
            selectedTimeSlots = [];
            document.getElementById('duration-60').checked = true;
            renderTimeGrid();
        })
        .catch(err => {
            console.error('Erro ao salvar no Firebase:', err);
            alert('Falha ao salvar reserva. Verifique sua internet ou se o banco de dados está disponível.');
        })
        .finally(() => {
            btnReserve.disabled = false;
        });
}

// --- Admin History ---
function renderUsageChart() {
    const ctxElement = document.getElementById('usage-chart');
    if (!ctxElement) return;
    const ctx = ctxElement.getContext('2d');

    // Filter bookings between start and end date and status 'active'
    const filtered = bookings.filter(b => {
        return b.status === 'active' && b.date >= chartStartDate && b.date <= chartEndDate;
    });

    // Aggregate hours per user
    const userHours = {};
    filtered.forEach(b => {
        const durationMins = b.fullDay ? 600 : (b.duration || 60);
        const hours = durationMins / 60;
        userHours[b.userName] = (userHours[b.userName] || 0) + hours;
    });

    const labels = Object.keys(userHours);
    const data = Object.values(userHours);

    // Sort by hours descending
    const sortedData = labels.map((label, index) => ({ label, value: data[index] }))
                             .sort((a, b) => b.value - a.value);

    const sortedLabels = sortedData.map(item => item.label);
    const sortedValues = sortedData.map(item => item.value);

    if (usageChartInstance) {
        usageChartInstance.destroy();
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, '#34d399'); // Lighter emerald
    gradient.addColorStop(1, '#059669'); // Darker emerald

    usageChartInstance = new Chart(ctxElement, {
        type: 'bar',
        data: {
            labels: sortedLabels,
            datasets: [{
                label: 'Total de Horas Reservadas',
                data: sortedValues,
                backgroundColor: gradient,
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 'flex',
                maxBarThickness: 50
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 800,
                easing: 'easeOutQuart'
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, font: { family: "'Plus Jakarta Sans', sans-serif" }, color: '#64748b' },
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { family: "'Plus Jakarta Sans', sans-serif", weight: '600' }, color: '#64748b' }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 14 },
                    bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    borderColor: 'rgba(0, 0, 0, 0.05)',
                    borderWidth: 1
                }
            }
        }
    });
}

function renderAdminHistory() {
    historyTbody.innerHTML = '';
    
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localNow = new Date(now - offset);
    const currentDate = localNow.toISOString().split('T')[0];
    
    const filtered = bookings.filter(b => {
        return b.date >= chartStartDate && b.date <= chartEndDate;
    });

    const sorted = [...filtered].sort((a, b) => {
        // Ordenação estritamente cronológica
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return (a.time || '').localeCompare(b.time || '');
    });
    
    sorted.forEach(b => {
        const tr = document.createElement('tr');
        
        // Destacar se for hoje
        if (b.date === currentDate) {
            tr.classList.add('highlight-today');
        }
        const dateObj = new Date(b.date + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('pt-BR');
        
        let isEligibleForKey = false;
        if (b.status === 'active') {
            if (currentDate > b.date) {
                isEligibleForKey = true;
            } else if (currentDate === b.date) {
                if (b.fullDay) {
                    isEligibleForKey = true;
                } else {
                    const bookingStartMins = timeToMins(b.time);
                    const nowMins = now.getHours() * 60 + now.getMinutes();
                    if (nowMins >= bookingStartMins) {
                        isEligibleForKey = true;
                    }
                }
            }
        }
        
        tr.innerHTML = `
            <td>${formattedDate} <br><span style="font-size: 0.75rem; color: var(--text-light);">${formatBookingTime(b)}</span></td>
            <td>${b.userName}</td>
            <td>${b.fullDay ? 'Dia Todo' : 'Horário'}</td>
            <td>
                <span class="badge badge-${b.status}">${b.status === 'active' ? 'Ativo' : 'Cancelado'}</span>
                ${b.status === 'canceled' && b.canceledBy ? `<div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">por ${b.canceledBy}</div>` : ''}
            </td>
            <td>
                ${isEligibleForKey ? 
                    (b.keyReceived ? 
                        '<span class="badge badge-key-received">Chave Recebida</span>' : 
                        '<span class="badge badge-key">Pendente</span>'
                    ) : '-'
                }
            </td>
            <td>
                ${(isEligibleForKey && !b.keyReceived) ? 
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

    const monthInput = document.getElementById('chart-month');
    const startInput = document.getElementById('chart-start-date');
    const endInput = document.getElementById('chart-end-date');

    monthInput.addEventListener('change', (e) => {
        if (!e.target.value) return;
        const [year, month] = e.target.value.split('-');
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        
        const offsetFirst = firstDay.getTimezoneOffset() * 60000;
        const offsetLast = lastDay.getTimezoneOffset() * 60000;
        
        chartStartDate = (new Date(firstDay - offsetFirst)).toISOString().split('T')[0];
        chartEndDate = (new Date(lastDay - offsetLast)).toISOString().split('T')[0];
        
        startInput.value = chartStartDate;
        endInput.value = chartEndDate;
        
        if (currentView === 'admin') {
            renderAdminHistory();
            renderUsageChart();
        }
    });

    startInput.addEventListener('change', (e) => {
        chartStartDate = e.target.value;
        monthInput.value = ''; // limpa o mês
        if (currentView === 'admin') {
            renderAdminHistory();
            renderUsageChart();
        }
    });

    endInput.addEventListener('change', (e) => {
        chartEndDate = e.target.value;
        monthInput.value = ''; // limpa o mês
        if (currentView === 'admin') {
            renderAdminHistory();
            renderUsageChart();
        }
    });

    durationRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            selectedTimeSlots = [];
            renderTimeGrid();
        });
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
        renderUsageChart();
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
    const admins = USERS.filter(u => u.isAdmin);
    const managers = USERS.filter(u => u.canCancelOthers);

    let canceledBy = null;
    
    if (user && user.password && password === user.password) {
        canceledBy = user.name;
    }
    if (!canceledBy) {
        const matchingAdmin = admins.find(a => a.password && password === a.password);
        if (matchingAdmin) canceledBy = matchingAdmin.name;
    }
    if (!canceledBy) {
        const matchingManager = managers.find(m => m.password && password === m.password);
        if (matchingManager) canceledBy = matchingManager.name;
    }

    if (canceledBy) {
        // Update status in Firebase — real-time listener handles re-rendering
        bookingsRef.child(booking.id).update({ 
            status: 'canceled',
            canceledBy: canceledBy
        });
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
    const admins = USERS.filter(u => u.isAdmin);
    
    if (admins.some(a => a.password && password === a.password)) {
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
