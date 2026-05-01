// Win Probability tab + sticky sparkline in the game header.

let chart = null;
let sparkChart = null;
let homeAbbr = "HOME";
let awayAbbr = "AWAY";
let homeColor = "0e0e14";
let awayColor = "3ddbd3";

export function mountWinprob(opts) {
  homeAbbr = opts.homeAbbr;
  awayAbbr = opts.awayAbbr;
  homeColor = opts.homeColor || "0e0e14";
  awayColor = opts.awayColor || "3ddbd3";
}

export function updateWinprob(summary) {
  const arr = summary.winprobability || [];
  if (!arr.length) {
    const fullCanvas = document.getElementById("winprob-chart");
    const wrap = fullCanvas?.parentElement;
    if (wrap) wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-mute);font-size:13px;">Win probability will plot live once the game tips off.</div>`;
    return;
  }
  if (!window.Chart) return;
  // Restore canvas if it was replaced by the empty state.
  const wrap = document.querySelector(".wp-chart");
  if (wrap && !document.getElementById("winprob-chart")) {
    wrap.innerHTML = `<canvas id="winprob-chart"></canvas>`;
  }

  const labels = arr.map((_, i) => i);
  const homeWP = arr.map(p => (p.homeWinPercentage || 0) * 100);
  const awayWP = arr.map(p => 100 - (p.homeWinPercentage || 0) * 100);

  // Main full chart.
  const fullCanvas = document.getElementById("winprob-chart");
  if (fullCanvas) {
    const ctx = fullCanvas.getContext("2d");
    if (chart) chart.destroy();
    chart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${homeAbbr} win %`,
            data: homeWP,
            borderColor: `#${homeColor}`,
            backgroundColor: hexToRgba(homeColor, 0.15),
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: `${awayAbbr} win %`,
            data: awayWP,
            borderColor: `#${awayColor}`,
            backgroundColor: hexToRgba(awayColor, 0.15),
            fill: false,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => `${v}%` } },
          x: { display: false }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: { mode: "index", intersect: false }
        }
      }
    });
  }

  // Sparkline in the game header.
  const sparkCanvas = document.getElementById("winprob-spark");
  if (sparkCanvas) {
    const ctx = sparkCanvas.getContext("2d");
    if (sparkChart) sparkChart.destroy();
    sparkChart = new window.Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: homeWP,
          borderColor: "#3ddbd3",
          backgroundColor: "transparent",
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 1.5,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } },
        elements: { line: { borderJoinStyle: "round" } }
      }
    });
  }
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
