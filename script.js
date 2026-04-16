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

function addInputField() {
    const currentFields = container.getElementsByClassName('input-group').length;
    if (currentFields >= 20) return alert("Maximal 20 Adressen möglich.");
    const div = document.createElement('div');
    div.className = 'input-group';
    div.innerHTML = `
        <i class="fas fa-location-dot"></i>
        <input type="text" class="addr-input" placeholder="Adresse ${currentFields + 1}" oninput="this.classList.remove('input-error')">
        ${currentFields > 1 ? `<button class="remove-btn" onclick="animateRemove(this)" title="Löschen"><i class="fas fa-circle-xmark"></i></button>` : '<div style="width:1.1rem"></div>'}
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
    }, 500);
}

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

async function planRoute() {
    const inputElements = Array.from(document.getElementsByClassName('addr-input'));
    const statusText = document.getElementById('status-text');
    const summary = document.getElementById('route-summary');
    const timeInfo = document.getElementById('time-info');
    const progBarCont = document.getElementById('progress-bar-container');
    const progBar = document.getElementById('progress-bar');
    const detailsCont = document.getElementById('route-details');

    inputElements.forEach(el => el.classList.remove('input-error'));
    const validInputs = inputElements.filter(i => i.value.trim() !== "");
    if (validInputs.length < 2) return alert("Bitte mindestens 2 Adressen ausfüllen!");
    
    statusText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Berechne Tour...';
    progBarCont.style.display = "block";
    progBar.style.width = "10%";
    summary.style.display = "none";
    detailsCont.style.display = "none";
    
    markers.forEach(m => map.removeLayer(m));
    routeLines.forEach(l => map.removeLayer(l));
    markers = []; routeLines = [];

    let coords = [];
    for (let i = 0; i < inputElements.length; i++) {
        let addr = inputElements[i].value.trim();
        if (!addr) continue;
        try {
            await new Promise(r => setTimeout(r, 1100));
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&countrycodes=de&limit=1`);
            const data = await resp.json();
            if (data.length > 0) {
                coords.push({ latLng: [parseFloat(data[0].lat), parseFloat(data[0].lon)], name: addr });
                progBar.style.width = `${((i + 1) / inputElements.length * 80)}%`;
            } else {
                inputElements[i].classList.add('input-error');
                statusText.innerText = `Nicht gefunden: ${addr}`;
                progBarCont.style.display = "none";
                return;
            }
        } catch (e) { statusText.innerText = "Fehler bei der Suche."; return; }
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

    const osrmCoords = optimized.map(c => `${c.latLng[1]},${c.latLng[0]}`).join(';');
    try {
        const rResp = await fetch(`https://router.project-osrm.org/route/v1/driving/${osrmCoords}?overview=full&geometries=geojson`);
        const rData = await rResp.json();
        if (rData.code === 'Ok') {
            const line = L.geoJSON(rData.routes[0].geometry, { style: { color: '#3498db', weight: 6, opacity: 0.8 } }).addTo(map);
            routeLines.push(line);
            
            const durationInSeconds = rData.routes[0].duration;
            const distanceInKm = (rData.routes[0].distance / 1000).toFixed(1);
            timeInfo.innerHTML = `<strong><i class='fas fa-clock'></i> Fahrzeit:</strong> ${formatTime(durationInSeconds)}<br><strong><i class='fas fa-road'></i> Strecke:</strong> ${distanceInKm} km`;
            summary.style.display = "block";
            
            let detailsHtml = "";
            const legs = rData.routes[0].legs;
            optimized.forEach((stop, index) => {
                const iconClass = (index === 0 || index === optimized.length - 1) ? 'fa-location-dot' : 'fa-arrow-down-long';
                detailsHtml += `
                    <div class="detail-step">
                        <i class="fas ${iconClass} main-icon"></i>
                        <span class="step-addr">${stop.name}</span>
                        ${index < legs.length ? `
                            <span class="step-info">
                                ${formatTime(legs[index].duration)} (${(legs[index].distance / 1000).toFixed(1)} km)
                            </span>
                        ` : ''}
                    </div>`;
            });
            detailsCont.innerHTML = detailsHtml;
        }
    } catch (e) { console.error(e); }

    optimized.forEach((c, i) => {
        const icon = L.divIcon({ html: `<div class="marker-number">${i+1}</div>`, className: '', iconSize: [26, 26], iconAnchor: [13, 13] });
        markers.push(L.marker(c.latLng, { icon: icon }).addTo(map).bindTooltip(c.name, { permanent: true, direction: 'right', className: 'map-label' }));
    });

    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
    statusText.innerHTML = '<i class="fas fa-check-circle"></i> Tour geplant!';
    progBar.style.width = "100%";
    setTimeout(() => progBarCont.style.display = "none", 500);
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
