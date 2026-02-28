// Karte initialisieren
const map = L.map('map').setView([51.1657, 10.4515], 6);
L.tileLayer('https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png', { 
    attribution: '© OpenStreetMap' 
}).addTo(map);

let markers = [];
let routeLines = [];
const container = document.getElementById('address-container');
const scrollArea = document.getElementById('scroll-area');

// App starten
function init() {
    addInputField(); // Erstes Feld
    addInputField(); // Zweites Feld
    
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.getElementById('body').classList.add('dark-mode');
        document.getElementById('dark-mode-toggle').innerText = '☀️';
    }
}

// Neues Adressfeld hinzufügen
function addInputField() {
    const currentFields = container.getElementsByClassName('input-group').length;
    if (currentFields >= 20) return alert("Maximal 20 Adressen möglich.");
    
    const div = document.createElement('div');
    div.className = 'input-group';
    div.innerHTML = `
        <input type="text" class="addr-input" placeholder="Adresse ${currentFields + 1}" oninput="this.classList.remove('input-error')">
        ${currentFields > 1 ? '<button class="remove-btn" onclick="this.parentElement.remove()" title="Löschen">✕</button>' : '<div style="width:28px"></div>'}
    `;
    container.appendChild(div);
    scrollArea.scrollTop = scrollArea.scrollHeight;
}

// Darkmode umschalten
function toggleDarkMode() {
    const body = document.getElementById('body');
    const btn = document.getElementById('dark-mode-toggle');
    const isDark = body.classList.toggle('dark-mode');
    btn.innerText = isDark ? '☀️' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Zeit-Formatierung
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? h + " Std. " + m + " Min." : m + " Min.";
}

// Hauptfunktion: Route berechnen
async function planRoute() {
    const inputElements = Array.from(document.getElementsByClassName('addr-input'));
    const statusText = document.getElementById('status-text');
    const timeInfo = document.getElementById('time-info');

    // Reset
    inputElements.forEach(el => el.classList.remove('input-error'));
    const validInputs = inputElements.filter(i => i.value.trim() !== "");
    if (validInputs.length < 2) return alert("Bitte mindestens 2 Adressen ausfüllen!");
    
    statusText.innerText = "⏳ Suche Standorte...";
    statusText.style.color = "";
    timeInfo.style.display = "none";
    
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    markers = []; routeLines = [];

    let coords = [];
    for (let el of inputElements) {
        let addr = el.value.trim();
        if (!addr) continue;
        try {
            await new Promise(r => setTimeout(r, 1100)); // Server-Pause
            const resp = await fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(addr) + "&countrycodes=de&limit=1");
            const data = await resp.json();
            if (data.length > 0) {
                coords.push({ latLng: [parseFloat(data[0].lat), parseFloat(data[0].lon)], name: addr });
            } else {
                el.classList.add('input-error');
                statusText.innerText = "❌ Nicht gefunden: " + addr;
                statusText.style.color = "#ff7675";
                return;
            }
        } catch (e) { statusText.innerText = "⚠️ Netzwerkfehler."; return; }
    }

    // --- VARIANTE B: START UND ENDE FEST ---
    let start = coords.shift();
    let end = (coords.length > 0) ? coords.pop() : null;
    let optimized = [start];

    while (coords.length > 0) {
        let last = optimized[optimized.length - 1];
        coords.sort((a, b) => L.latLng(last.latLng).distanceTo(L.latLng(a.latLng)) - L.latLng(last.latLng).distanceTo(L.latLng(b.latLng)));
        optimized.push(coords.shift());
    }
    if (end) optimized.push(end);

    statusText.innerText = "🛣️ Berechne Straßenroute...";
    const osrmCoords = optimized.map(c => c.latLng[1] + "," + c.latLng[0]).join(';');
    
    try {
        const rResp = await fetch("https://router.project-osrm.org/route/v1/driving/" + osrmCoords + "?overview=full&geometries=geojson");
        const rData = await rResp.json();
        if (rData.code === 'Ok') {
            const line = L.geoJSON(rData.routes[0].geometry, { style: { color: '#3498db', weight: 6, opacity: 0.8 } }).addTo(map);
            routeLines.push(line);
            
            const totalSeconds = rData.routes[0].duration;
            const totalKm = (rData.routes[0].distance / 1000).toFixed(1);
            timeInfo.innerHTML = "⏱️ Fahrzeit: " + formatTime(totalSeconds) + "<br>📏 Strecke: " + totalKm + " km";
            timeInfo.style.display = "block";
        }
    } catch (e) { console.error(e); }

    // Marker setzen
    optimized.forEach((c, i) => {
        const icon = L.divIcon({ html: '<div class="marker-number">' + (i+1) + '</div>', className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
        const m = L.marker(c.latLng, { icon: icon }).addTo(map)
            .bindTooltip("<b>" + (i+1) + ":</b> " + c.name, { permanent: true, direction: 'right', className: 'map-label', offset: [15, 0] });
        markers.push(m);
    });

    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    statusText.innerText = "✅ Route fertig!";
    statusText.style.color = "#2ecc71";
}

// Alles löschen
function clearAll() {
    const inputs = document.getElementsByClassName('addr-input');
    for(let i=0; i<inputs.length; i++) {
        inputs[i].value = "";
        inputs[i].classList.remove('input-error');
    }
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    document.getElementById('status-text').innerText = "Bereit";
    document.getElementById('status-text').style.color = "";
    document.getElementById('time-info').style.display = "none";
}

init();