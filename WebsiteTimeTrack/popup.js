function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
}

let chart;

function updateListAndChart() {
    chrome.storage.local.get(null, (items) => {
        const list = document.getElementById("websiteList");
        list.innerHTML = "";

        const labels = [];
        const data = [];

        for (let domain in items) {
            labels.push(domain);
            data.push(items[domain]);
            const li = document.createElement("li");
            li.textContent = `${domain}: ${formatTime(items[domain])}`;
            list.appendChild(li);
        }

        const ctx = document.getElementById('timeChart').getContext('2d');

        if (chart) {
            chart.destroy(); // Vorherigen Chart löschen
        }

        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Zeit in Sekunden',
                    data: data,
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { beginAtZero: true }
                }
            }
        });
    });
}

document.getElementById("reset").addEventListener("click", () => {
    chrome.storage.local.clear(() => updateListAndChart());
});

updateListAndChart();
