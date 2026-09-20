'use strict';

/* 烤炉热气/蒸汽特效 */

const steamParticles = [];

function spawnSteam(x, y, count) {
  for (let i = 0; i < count; i++) {
    steamParticles.push({
      x: x + rand(-18, 18),
      y,
      r: rand(10, 26),
      life: rand(0.8, 1.6),
      maxLife: 1.6,
      vy: rand(-40, -18),
      vx: rand(-14, 14),
    });
  }
}

function updateSteam(dt) {
  for (let i = steamParticles.length - 1; i >= 0; i--) {
    const p = steamParticles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.r += 14 * dt;
    if (p.life <= 0) steamParticles.splice(i, 1);
  }
}

function drawSteam(g) {
  g.save();
  for (const p of steamParticles) {
    const a = clamp(p.life / p.maxLife, 0, 1) * 0.35;
    g.globalAlpha = a;
    const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
