// Globale Variablen & Initialisierung
const map = L.map('map').setView([51.1657, 10.4515], 6);
L.tileLayer('https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png', { 
    attribution: '© OpenStreetMap' 
}).addTo(map);

let markers = [];
let routeLines = [];
const geoCache = new Map(); // Cache für Adress-Koordinaten
const container = document.getElementById('address-container');

function init() {
    addInputField();
    addInputField();
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.getElementById('body').classList.add('dark-mode');
        document.getElementById('dark-mode-toggle').innerHTML = '<i class="fas fa-sun"></i>';
    }
}

// DRAG & DROP LOGIK
function setupDragAndDrop(el) {
    el.addEventListener('dragstart', () => el.classList.add('dragging'));
    el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        updatePlaceholders();
        
        // Auto-Update ohne Neu-Optimierung beim Verschieben
        const validInputs = Array.from(document.querySelectorAll('.addr-input')).filter(i => i.value.trim() !== "");
        if (validInputs.length >= 2) {
            planRoute(false); 
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

// ADRESS-GEOCACHING (Verhindert API-Spam)
async function getCoordinates(address) {
    if (!address) return null;
    if (geoCache.has(address)) return geoCache.get(address);

    try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=de&limit=1`);
        const data = await resp.json();
        if (data.length > 0) {
            const result = { latLng: [parseFloat(data[0].lat), parseFloat(data[0].lon)], name: address };
            geoCache.set(address, result);
            return result;
        }
    } catch (e) { console.error("Geocoding Fehler"); }
    return null;
}

// HAUPTFUNKTION: ROUTE PLANEN
async function planRoute(autoOptimize = true) {
    const inputElements = Array.from(document.getElementsByClassName('addr-input'));
    const statusText = document.getElementById('status-text');
    const progBarCont = document.getElementById('progress-bar-container');
    const progBar = document.getElementById('progress-bar');

    const validAddresses = inputElements.map(i => i.value.trim()).filter(a => a !== "");
    if (validAddresses.length < 2) return;

    statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Tour wird berechnet...';
    progBarCont.style.display = "block";
    progBar.style.width = "30%";

    // Koordinaten laden (aus Cache oder API)
    let coords = [];
    for (const addr of validAddresses) {
        const res = await getCoordinates(addr);
        if (res) coords.push(res);
    }

    if (coords.length < 2) {
        statusText.innerText = "Fehler: Adressen nicht gefunden.";
        return;
    }

    let routeToDraw = [...coords];

    // Optimierung nur wenn gewünscht (Haupt-Button)
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

    // OSRM API Call
    const osrmCoords = routeToDraw.map(c => `${c.latLng[1]},${c.latLng[0]}`).join(';');
    try {
        const rResp = await fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson&steps=true`);
        const rData = await rResp.json();
        
        if (rData.code === 'Ok') {
            updateMapAndUI(rData, routeToDraw);
        }
    } catch (e) { console.error(e); }

    statusText.innerHTML = '<i class="fas fa-check-circle"></i> Tour bereit!';
    progBar.style.width = "100%";
    setTimeout(() => progBarCont.style.display = "none", 500);
}

function updateMapAndUI(rData, routeToDraw) {
    // Reset
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    markers = []; routeLines = [];

    // Route zeichnen
    const line = L.geoJSON(rData.routes[0].geometry, { style: { color: '#3498db', weight: 6, opacity: 0.8 } }).addTo(map);
    routeLines.push(line);

    // Zeit & Strecke
    document.getElementById('time-info').innerHTML = `<strong><i class='fas fa-clock'></i> Fahrzeit:</strong> ${formatTime(rData.routes[0].duration)}<br><strong><i class='fas fa-road'></i> Strecke:</strong> ${(rData.routes[0].distance / 1000).toFixed(1)} km`;
    document.getElementById('route-summary').style.display = "block";

    // Marker & Details generieren
    let detailsHtml = "";
    const legs = rData.routes[0].legs;
    
    routeToDraw.forEach((stop, index) => {
        // Map Marker
        const icon = L.divIcon({ html: `<div class="marker-number">${index+1}</div>`, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
        markers.push(L.marker(stop.latLng, { icon: icon }).addTo(map).bindTooltip(stop.name, { direction: 'right', className: 'map-label' }));

        // Details Panel
        const iconClass = (index === 0) ? 'fa-house' : (index === routeToDraw.length-1 ? 'fa-flag-checkered' : 'fa-location-dot');
        detailsHtml += `
            <div class="detail-step">
                <i class="fas ${iconClass} main-icon"></i>
                <span class="step-addr">${stop.name}</span>
                ${index < legs.length ? `<span class="step-info">${formatTime(legs[index].duration)} (${(legs[index].distance / 1000).toFixed(1)} km)</span>` : ''}
            </div>`;
    });
    
    document.getElementById('route-details').innerHTML = detailsHtml;
    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
}

// Hilfsfunktionen
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

function updatePlaceholders() {
    document.querySelectorAll('.addr-input').forEach((input, i) => {
        input.placeholder = `Adresse ${i + 1}`;
    });
}

function animateRemove(button) {
    const row = button.parentElement;
    row.classList.add('fall-die-away');
    setTimeout(() => {
        row.remove();
        updatePlaceholders();
        planRoute(false);
    }, 500);
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h} Std. ${m} Min.` : `${m} Min.`;
}

function toggleDarkMode() {
    const isDark = document.getElementById('body').classList.toggle('dark-mode');
    document.getElementById('dark-mode-toggle').innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function toggleDetails() {
    const cont = document.getElementById('route-details');
    const isHidden = cont.style.display === "none";
    cont.style.display = isHidden ? "block" : "none";
    document.getElementById('btn-details').innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i> Details ausblenden' : '<i class="fas fa-chevron-down"></i> Details anzeigen';
}

function clearAll() {
    container.innerHTML = "";
    geoCache.clear(); // Cache leeren bei Neustart
    init();
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    document.getElementById('route-summary').style.display = "none";
    document.getElementById('route-details').style.display = "none";
    document.getElementById('status-text').innerText = "Bereit";
}

init();
