const map = L.map('map').setView([51.1657, 10.4515], 6);
L.tileLayer('https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png', { 
    attribution: '© OpenStreetMap' 
}).addTo(map);

let markers = [];
let routeLines = [];
const container = document.getElementById('address-container');
const scrollArea = document.getElementById('scroll-area');

function init() {
    addInputField();
    addInputField();
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.getElementById('body').classList.add('dark-mode');
        document.getElementById('dark-mode-toggle').innerHTML = '<i class="fas fa-sun"></i>';
    }
}

// DRAG & DROP LOGIK MIT AUTO-UPDATE
function setupDragAndDrop(el) {
    el.addEventListener('dragstart', () => el.classList.add('dragging'));
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        updatePlaceholders();
        
        // AUTO-UPDATE: Wenn schon eine Route da war, berechne sie sofort neu
        const validInputs = Array.from(document.querySelectorAll('.addr-input')).filter(i => i.value.trim() !== "");
        if (validInputs.length >= 2) {
            console.log("Reihenfolge geändert - berechne neu...");
            planRoute(false); // false = nicht neu optimieren, sondern händische Folge nehmen
        }
    });
}

container.addEventListener('dragover', e => {
    e.preventDefault();
    const afterElement = getDragAfterElement(container, e.clientY);
    const dragging = document.querySelector('.dragging');
    if (afterElement == null) {
        container.appendChild(dragging);
    } else {
        container.insertBefore(dragging, afterElement);
    }
});

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.input-group:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updatePlaceholders() {
    const inputs = document.querySelectorAll('.addr-input');
    inputs.forEach((input, index) => {
        input.placeholder = `Adresse ${index + 1}`;
    });
}

function addInputField() {
    const currentFields = container.getElementsByClassName('input-group').length;
    if (currentFields >= 20) return alert("Maximal 20 Adressen möglich.");
    
    const div = document.createElement('div');
    div.className = 'input-group';
    div.draggable = true;
    div.innerHTML = `
        <i class="fas fa-grip-vertical drag-handle"></i>
        <i class="fas fa-location-dot"></i>
        <input type="text" class="addr-input" placeholder="Adresse ${currentFields + 1}" oninput="this.classList.remove('input-error')">
        ${currentFields > 1 ? `<button class="remove-btn" onclick="animateRemove(this)" title="Löschen"><i class="fas fa-circle-xmark"></i></button>` : '<div style="width:1.1rem"></div>'}
    `;
    
    setupDragAndDrop(div);
    container.appendChild(div);
}

function animateRemove(button) {
    const row = button.parentElement;
    row.classList.add('fall-die-away');
    setTimeout(() => {
        row.remove();
        updatePlaceholders();
        planRoute(false); // Auch beim Löschen auto-update
    }, 500);
}

async function planRoute(autoOptimize = true) {
    const inputElements = Array.from(document.getElementsByClassName('addr-input'));
    const statusText = document.getElementById('status-text');
    const summary = document.getElementById('route-summary');
    const timeInfo = document.getElementById('time-info');
    const progBarCont = document.getElementById('progress-bar-container');
    const progBar = document.getElementById('progress-bar');
    const detailsCont = document.getElementById('route-details');

    const validInputs = inputElements.filter(i => i.value.trim() !== "");
    if (validInputs.length < 2) return;
    
    statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aktualisiere Tour...';
    progBarCont.style.display = "block";
    progBar.style.width = "30%";

    // Wir speichern Geocoding-Ergebnisse zwischen, um die API nicht zu spammen
    let coords = [];
    for (let i = 0; i < inputElements.length; i++) {
        let addr = inputElements[i].value.trim();
        if (!addr) continue;
        try {
            // Ein kleiner Cache oder schnellere Abfrage
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&countrycodes=de&limit=1`);
            const data = await resp.json();
            if (data.length > 0) {
                coords.push({ latLng: [parseFloat(data[0].lat), parseFloat(data[0].lon)], name: addr });
            }
        } catch (e) { console.error("Geocoding Fehler"); }
    }

    // Die Reihenfolge aus den Input-Feldern übernehmen
    let routeToDraw = [...coords];

    // Nur optimieren, wenn der User den Haupt-Button klickt, nicht beim Verschieben
    if (autoOptimize && coords.length > 2) {
        let start = coords.shift();
        let end = coords.pop();
        let optimized = [start];
        while (coords.length > 0) {
            let last = optimized[optimized.length - 1];
            coords.sort((a, b) => L.latLng(last.latLng).distanceTo(L.latLng(a.latLng)) - L.latLng(last.latLng).distanceTo(L.latLng(b.latLng)));
            optimized.push(coords.shift());
        }
        optimized.push(end);
        routeToDraw = optimized;
    }

    const osrmCoords = routeToDraw.map(c => `${c.latLng[1]},${c.latLng[0]}`).join(';');
    try {
        const rResp = await fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson&steps=true`);
        const rData = await rResp.json();
        
        if (rData.code === 'Ok') {
            // Alte Linien/Marker löschen
            markers.forEach(m => map.removeLayer(m));
            routeLines.forEach(l => map.removeLayer(l));
            markers = []; routeLines = [];

            const line = L.geoJSON(rData.routes[0].geometry, { style: { color: '#3498db', weight: 6, opacity: 0.8 } }).addTo(map);
            routeLines.push(line);
            
            timeInfo.innerHTML = `<strong><i class='fas fa-clock'></i> Fahrzeit:</strong> ${formatTime(rData.routes[0].duration)}<br><strong><i class='fas fa-road'></i> Strecke:</strong> ${(rData.routes[0].distance / 1000).toFixed(1)} km`;
            summary.style.display = "block";
            
            // Details Update
            let detailsHtml = "";
            const legs = rData.routes[0].legs;
            routeToDraw.forEach((stop, index) => {
                const iconClass = (index === 0) ? 'fa-house' : (index === routeToDraw.length-1 ? 'fa-flag-checkered' : 'fa-location-dot');
                detailsHtml += `
                    <div class="detail-step">
                        <i class="fas ${iconClass} main-icon"></i>
                        <span class="step-addr">${stop.name}</span>
                        ${index < legs.length ? `<span class="step-info">${formatTime(legs[index].duration)} (${(legs[index].distance / 1000).toFixed(1)} km) bis nächster Stopp</span>` : ''}
                    </div>`;
            });
            detailsCont.innerHTML = detailsHtml;

            // Marker neu setzen
            routeToDraw.forEach((c, i) => {
                const icon = L.divIcon({ html: `<div class="marker-number">${i+1}</div>`, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
                markers.push(L.marker(c.latLng, { icon: icon }).addTo(map).bindTooltip(c.name, { direction: 'right', className: 'map-label' }));
            });
            map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
        }
    } catch (e) { console.error(e); }

    statusText.innerHTML = '<i class="fas fa-check-circle"></i> Tour aktualisiert!';
    progBar.style.width = "100%";
    setTimeout(() => progBarCont.style.display = "none", 500);
}

// ... Restliche Funktionen (toggleDarkMode, formatTime, clearAll, toggleDetails) bleiben gleich wie vorher ...

function toggleDarkMode() {
    const body = document.getElementById('body');
    const btn = document.getElementById('dark-mode-toggle');
    const isDark = body.classList.toggle('dark-mode');
    btn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

function toggleDetails() {
    const cont = document.getElementById('route-details');
    const btn = document.getElementById('btn-details');
    const isHidden = cont.style.display === "none";
    cont.style.display = isHidden ? "block" : "none";
    btn.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i> Details ausblenden' : '<i class="fas fa-chevron-down"></i> Details anzeigen';
}

function clearAll() {
    const rows = Array.from(container.getElementsByClassName('input-group'));
    rows.forEach((row, index) => { setTimeout(() => { row.classList.add('fall-down-out'); }, index * 50); });
    setTimeout(() => {
        container.innerHTML = "";
        init();
        markers.forEach(m => map.removeLayer(m));
        routeLines.forEach(l => map.removeLayer(l));
        markers = []; routeLines = [];
        document.getElementById('status-text').innerText = "Bereit";
        document.getElementById('route-summary').style.display = "none";
        document.getElementById('route-details').style.display = "none";
    }, 600);
}

init();
