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
        document.getElementById('dark-mode-toggle').innerText = '☀️';
    }
}

function addInputField() {
    const currentFields = container.getElementsByClassName('input-group').length;
    if (currentFields >= 20) return alert("Maximal 20 Adressen möglich.");
    const div = document.createElement('div');
    div.className = 'input-group';
    div.innerHTML = `
        <input type="text" class="addr-input" placeholder="Adresse ${currentFields + 1}" oninput="this.classList.remove('input-error')">
        ${currentFields > 1 ? `<button class="remove-btn" onclick="animateRemove(this)">✕</button>` : '<div style="width:30px"></div>'}
    `;
    container.appendChild(div);
    scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: 'smooth' });
}

function animateRemove(button) {
    const row = button.parentElement;
    row.classList.add('fall-die-away');
    setTimeout(() => {
        row.remove();
        const inputs = document.querySelectorAll('.addr-input');
        inputs.forEach((input, index) => { input.placeholder = `Adresse ${index + 1}`; });
    }, 400);
}

function toggleDarkMode() {
    const body = document.getElementById('body');
    const btn = document.getElementById('dark-mode-toggle');
    const isDark = body.classList.toggle('dark-mode');
    btn.innerText = isDark ? '☀️' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// DIESE FUNKTION MUSS EXAKT SO AUSSEHEN
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    
    if (h > 0) {
        return h + " Std. " + m + " Min.";
    } else {
        return m + " Min.";
    }
}

async function planRoute() {
    const inputElements = Array.from(document.getElementsByClassName('addr-input'));
    const statusText = document.getElementById('status-text');
    const timeInfo = document.getElementById('time-info');
    const progBarCont = document.getElementById('progress-bar-container');
    const progBar = document.getElementById('progress-bar');

    inputElements.forEach(el => el.classList.remove('input-error'));
    const validInputs = inputElements.filter(i => i.value.trim() !== "");
    if (validInputs.length < 2) return alert("Bitte mindestens 2 Adressen ausfüllen!");
    
    statusText.innerText = "⏳ Suche Standorte...";
    progBarCont.style.display = "block";
    progBar.style.width = "10%";
    
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    markers = []; routeLines = [];

    let coords = [];
    for (let i = 0; i < inputElements.length; i++) {
        let addr = inputElements[i].value.trim();
        if (!addr) continue;
        try {
            await new Promise(r => setTimeout(r, 1100));
            const resp = await fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(addr) + "&countrycodes=de&limit=1");
            const data = await resp.json();
            if (data.length > 0) {
                coords.push({ latLng: [parseFloat(data[0].lat), parseFloat(data[0].lon)], name: addr });
                progBar.style.width = ((i + 1) / inputElements.length * 80) + "%";
            } else {
                inputElements[i].classList.add('input-error');
                statusText.innerText = "❌ Nicht gefunden: " + addr;
                progBarCont.style.display = "none";
                return;
            }
        } catch (e) { statusText.innerText = "⚠️ Fehler."; return; }
    }

    let start = coords.shift();
    let end = (coords.length > 0) ? coords.pop() : null;
    let optimized = [start];
    while (coords.length > 0) {
        let last = optimized[optimized.length - 1];
        coords.sort((a, b) => L.latLng(last.latLng).distanceTo(L.latLng(a.latLng)) - L.latLng(last.latLng).distanceTo(L.latLng(b.latLng)));
        optimized.push(coords.shift());
    }
    if (end) optimized.push(end);

    const osrmCoords = optimized.map(c => c.latLng[1] + "," + c.latLng[0]).join(';');
    try {
        const rResp = await fetch("https://router.project-osrm.org/route/v1/driving/" + osrmCoords + "?overview=full&geometries=geojson");
        const rData = await rResp.json();
        if (rData.code === 'Ok') {
            const line = L.geoJSON(rData.routes[0].geometry, { style: { color: '#3498db', weight: 6, opacity: 0.8 } }).addTo(map);
            routeLines.push(line);
            
            // HIER WIRD DIE FUNKTION AUFGERUFEN
            const durationInSeconds = rData.routes[0].duration;
            const distanceInKm = (rData.routes[0].distance / 1000).toFixed(1);
            
            timeInfo.innerHTML = "⏱️ Fahrzeit: " + formatTime(durationInSeconds) + "<br>📏 Strecke: " + distanceInKm + " km";
            timeInfo.style.display = "block";
        }
    } catch (e) { console.error(e); }

    optimized.forEach((c, i) => {
        const icon = L.divIcon({ html: '<div class="marker-number">' + (i+1) + '</div>', className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
        markers.push(L.marker(c.latLng, { icon: icon }).addTo(map).bindTooltip(c.name, { permanent: true, direction: 'right', className: 'map-label' }));
    });

    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    statusText.innerText = "✅ Route fertig!";
    progBar.style.width = "100%";
    setTimeout(() => progBarCont.style.display = "none", 500);
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
        document.getElementById('time-info').style.display = "none";
    }, 600);
}

init();
