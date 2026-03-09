// APD — Astrophotography Planning Dashboard
// Copyright © 2026 Giancarlo Erra — AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';

export function LandingPage() {
  const skyRef = useRef<HTMLDivElement>(null);
  const [dbOk, setDbOk] = useState<boolean | null>(null);
  const [featuresOpen, setFeaturesOpen] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setDbOk(d.ok === true))
      .catch(() => setDbOk(false));
  }, []);

  useEffect(() => {
    if (!skyRef.current) return;
    const container: HTMLDivElement = skyRef.current;

    let animId = 0;

    const starPhases = ['·', '✦', '✢', '✳', '✶', '✻', '✽', '✷', '⊹', '∗'];
    const dimStarPhases = ['·', '.', '∙', '⋅', '·', '˙', '·', '∘'];
    const brightStarPhases = ['✦', '✶', '✸', '✹', '✺', '✻', '✽', '❋', '✳', '✲'];
    const shootingChars = ['─', '━', '═', '─', '╌', '╍', '┄', '·'];
    const nebulaChars = ['░', '▒', '▓', '█', '╳', '╬', '╫', '╪', '┼', '╋', '│', '─', '╌', '╎', '·', '∴', '∵', '⋮', '⁞'];
    const nebulaLightChars = ['·', '∙', ':', '⋅', '.', '˙', ',', "'", '`'];
    const galaxyChars = ['◠', '◡', '◜', '◝', '◞', '◟', '╭', '╮', '╯', '╰', '~', '≈', '∼', '⌒'];
    const galaxyCoreChars = ['✦', '✧', '⊛', '◉', '◎', '⊙', '✵', '❂'];

    function rand(min: number, max: number) { return Math.random() * (max - min) + min; }
    function randInt(min: number, max: number) { return Math.floor(rand(min, max)); }
    function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length)]; }

    function starColor(temp: number) {
      if (temp < 0.3) return `hsl(${30 + temp * 60}, 80%, ${70 + temp * 20}%)`;
      if (temp < 0.7) return `hsl(${50 + temp * 20}, ${20 + temp * 30}%, ${85 + temp * 15}%)`;
      return `hsl(${200 + temp * 40}, ${50 + temp * 30}%, ${80 + temp * 15}%)`;
    }

    type Star = { el: HTMLSpanElement; phases: string[]; phaseIndex: number; direction: number; reverseMirror: boolean; speed: number; lastUpdate: number; baseOpacity: number; opacityPhase: number; opacitySpeed: number; breatheAmount: number };
    type Particle = { el: HTMLSpanElement; chars: string[]; baseOpacity: number; phase: number; speed: number; charSpeed: number; lastCharUpdate: number };

    const stars: Star[] = [];
    const nebulae: Particle[] = [];
    const galaxies: Particle[] = [];
    let shootingStar: { els: HTMLSpanElement[]; startX: number; startY: number; angle: number; speed: number; progress: number; length: number; maxDist: number } | null = null;

    function createStar(): Star {
      const el = document.createElement('span');
      el.style.cssText = 'position:absolute;font-family:Courier New,Consolas,monospace;line-height:1;pointer-events:none';
      const brightness = Math.random();
      let phases: string[], size: number, baseOpacity: number, color: string;
      if (brightness > 0.95) {
        phases = brightStarPhases; size = rand(14, 24); baseOpacity = rand(0.7, 1.0); color = starColor(Math.random());
      } else if (brightness > 0.6) {
        phases = starPhases; size = rand(8, 16); baseOpacity = rand(0.4, 0.8); color = starColor(0.3 + Math.random() * 0.4);
      } else {
        phases = dimStarPhases; size = rand(6, 11); baseOpacity = rand(0.15, 0.45); color = `hsl(220, 10%, ${60 + Math.random() * 30}%)`;
      }
      el.style.left = rand(0, 100) + '%';
      el.style.top = rand(0, 100) + '%';
      el.style.fontSize = size + 'px';
      el.style.color = color;
      el.style.opacity = String(baseOpacity);
      container.appendChild(el);
      const speed = rand(80, 400);
      return { el, phases, phaseIndex: randInt(0, phases.length), direction: 1, reverseMirror: Math.random() > 0.3, speed, lastUpdate: performance.now() - rand(0, speed), baseOpacity, opacityPhase: rand(0, Math.PI * 2), opacitySpeed: rand(0.3, 2.0), breatheAmount: rand(0.1, 0.4) };
    }

    function createNebula(cx: number, cy: number, color1: string, color2: string, charCount: number) {
      const spreadX = rand(8, 20), spreadY = rand(5, 15);
      for (let i = 0; i < charCount; i++) {
        const el = document.createElement('span');
        el.style.cssText = 'position:absolute;font-family:Courier New,Consolas,monospace;line-height:1;pointer-events:none';
        const angle = rand(0, Math.PI * 2);
        const dist = rand(0, 1) * rand(0, 1);
        const x = cx + Math.cos(angle) * dist * spreadX;
        const y = cy + Math.sin(angle) * dist * spreadY;
        const isCore = dist < 0.3;
        const chars = isCore ? nebulaChars : nebulaLightChars;
        const size = isCore ? rand(8, 16) : rand(6, 12);
        const baseOpacity = isCore ? rand(0.06, 0.15) : rand(0.03, 0.08);
        el.style.left = x + '%'; el.style.top = y + '%'; el.style.fontSize = size + 'px';
        el.style.color = Math.random() > 0.5 ? color1 : color2;
        el.style.opacity = String(baseOpacity);
        el.textContent = pick(chars);
        container.appendChild(el);
        nebulae.push({ el, chars, baseOpacity, phase: rand(0, Math.PI * 2), speed: rand(0.2, 0.8), charSpeed: rand(2000, 6000), lastCharUpdate: performance.now() - rand(0, 3000) });
      }
    }

    function createGalaxy(cx: number, cy: number, gSize: number, rotation: number) {
      const armCount = randInt(2, 4), totalChars = randInt(30, 60);
      for (let i = 0; i < totalChars; i++) {
        const el = document.createElement('span');
        el.style.cssText = 'position:absolute;font-family:Courier New,Consolas,monospace;line-height:1;pointer-events:none';
        const arm = i % armCount;
        const armAngle = (arm / armCount) * Math.PI * 2 + rotation;
        const dist = rand(0.1, 1.0);
        const spiralAngle = armAngle + dist * Math.PI * 1.5;
        const scatter = rand(-0.5, 0.5) * (1 - dist * 0.5);
        const x = cx + Math.cos(spiralAngle + scatter) * dist * gSize;
        const y = cy + Math.sin(spiralAngle + scatter) * dist * gSize * 0.4;
        const isCore = dist < 0.25;
        const chars = isCore ? galaxyCoreChars : galaxyChars;
        const fontSize = isCore ? rand(8, 14) : rand(6, 10);
        const baseOpacity = isCore ? rand(0.15, 0.3) : rand(0.04, 0.12);
        const color = isCore ? `hsl(${40 + rand(-10, 10)}, 60%, ${70 + rand(0, 20)}%)` : `hsl(${220 + rand(-30, 30)}, ${20 + rand(0, 30)}%, ${50 + rand(0, 30)}%)`;
        el.style.left = x + '%'; el.style.top = y + '%'; el.style.fontSize = fontSize + 'px';
        el.style.color = color; el.style.opacity = String(baseOpacity);
        el.textContent = pick(chars);
        container.appendChild(el);
        galaxies.push({ el, chars, baseOpacity, phase: rand(0, Math.PI * 2), speed: rand(0.15, 0.5), charSpeed: rand(3000, 8000), lastCharUpdate: performance.now() - rand(0, 4000) });
      }
    }

    function launchShootingStar() {
      if (shootingStar) return;
      const startX = rand(10, 80), startY = rand(5, 40);
      const angle = rand(0.3, 0.8), length = randInt(5, 12), speed = rand(15, 35);
      const els: HTMLSpanElement[] = [];
      for (let i = 0; i < length; i++) {
        const el = document.createElement('span');
        el.style.cssText = 'position:absolute;font-family:Courier New,Consolas,monospace;line-height:1;pointer-events:none';
        el.style.fontSize = (12 - i * 0.8) + 'px';
        el.style.color = i === 0 ? '#ffffff' : `hsla(200, 80%, ${90 - i * 8}%, ${1 - i / length})`;
        el.style.opacity = '0';
        el.textContent = i === 0 ? '✦' : shootingChars[i % shootingChars.length];
        container.appendChild(el);
        els.push(el);
      }
      shootingStar = { els, startX: (startX / 100) * window.innerWidth, startY: (startY / 100) * window.innerHeight, angle, speed, progress: 0, length, maxDist: rand(200, 500) };
    }

    function updateShootingStar() {
      if (!shootingStar) return;
      const s = shootingStar;
      s.progress += s.speed;
      if (s.progress > s.maxDist + s.length * 20) {
        s.els.forEach(el => el.remove());
        shootingStar = null;
        return;
      }
      for (let i = 0; i < s.els.length; i++) {
        const trailDist = s.progress - i * 18;
        if (trailDist < 0 || trailDist > s.maxDist) { s.els[i].style.opacity = '0'; continue; }
        const fade = 1 - trailDist / s.maxDist;
        s.els[i].style.left = (s.startX + Math.cos(s.angle) * trailDist) + 'px';
        s.els[i].style.top = (s.startY + Math.sin(s.angle) * trailDist) + 'px';
        s.els[i].style.opacity = String(fade * (1 - i / s.els.length));
        if (i > 0 && Math.random() > 0.7) s.els[i].textContent = pick(shootingChars);
      }
    }

    // Initialize
    const area = (window.innerWidth * window.innerHeight) / (1920 * 1080);
    const starCount = Math.floor(280 * area) + 60;
    for (let i = 0; i < starCount; i++) stars.push(createStar());

    const nebulaColors: [string, string][] = [
      ['hsla(340, 70%, 40%, 0.8)', 'hsla(270, 60%, 35%, 0.8)'],
      ['hsla(200, 60%, 35%, 0.8)', 'hsla(240, 50%, 30%, 0.8)'],
      ['hsla(15, 70%, 35%, 0.8)', 'hsla(340, 60%, 30%, 0.8)'],
      ['hsla(160, 50%, 30%, 0.8)', 'hsla(200, 60%, 35%, 0.8)'],
    ];
    const nebulaCount = randInt(2, 4);
    for (let i = 0; i < nebulaCount; i++) {
      createNebula(rand(10, 90), rand(10, 90), nebulaColors[i % nebulaColors.length][0], nebulaColors[i % nebulaColors.length][1], randInt(40, 80));
    }
    const galaxyCount = randInt(1, 3);
    for (let i = 0; i < galaxyCount; i++) {
      createGalaxy(rand(15, 85), rand(15, 85), rand(5, 12), rand(0, Math.PI * 2));
    }

    function animate(now: number) {
      for (const star of stars) {
        if (now - star.lastUpdate >= star.speed) {
          star.lastUpdate = now;
          if (star.reverseMirror) {
            star.phaseIndex += star.direction;
            if (star.phaseIndex >= star.phases.length - 1) star.direction = -1;
            else if (star.phaseIndex <= 0) star.direction = 1;
          } else {
            star.phaseIndex = (star.phaseIndex + 1) % star.phases.length;
          }
          star.el.textContent = star.phases[star.phaseIndex];
        }
        star.opacityPhase += star.opacitySpeed * 0.016;
        star.el.style.opacity = String(Math.max(0.03, Math.min(1, star.baseOpacity + Math.sin(star.opacityPhase) * star.breatheAmount)));
      }
      for (const n of nebulae) {
        n.phase += n.speed * 0.016;
        n.el.style.opacity = String(Math.max(0.01, n.baseOpacity + n.baseOpacity * Math.sin(n.phase) * 0.4));
        if (now - n.lastCharUpdate >= n.charSpeed) { n.lastCharUpdate = now; if (Math.random() > 0.5) n.el.textContent = pick(n.chars); }
      }
      for (const g of galaxies) {
        g.phase += g.speed * 0.016;
        g.el.style.opacity = String(Math.max(0.02, g.baseOpacity + g.baseOpacity * Math.sin(g.phase) * 0.3));
        if (now - g.lastCharUpdate >= g.charSpeed) { g.lastCharUpdate = now; if (Math.random() > 0.6) g.el.textContent = pick(g.chars); }
      }
      updateShootingStar();
      if (!shootingStar && Math.random() < 0.002) launchShootingStar();
      animId = requestAnimationFrame(animate);
    }
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      container.innerHTML = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#05050a]">
      {/* Star field background */}
      <div
        ref={skyRef}
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, #0a0a1a 0%, #050510 40%, #02020a 100%)' }}
      />

      {/* Central card */}
      <div className="relative z-10 flex items-center justify-center min-h-screen p-4">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 sm:p-10 md:p-12 max-w-lg w-full text-center animate-fade-in">
          <img src="/logo.png" alt="APD" className="w-20 h-20 mx-auto mb-4 rounded-xl" />
          <h1 className="text-5xl sm:text-6xl font-bold text-white tracking-tight mb-1" style={{ textShadow: '0 0 40px rgba(var(--accent-rgb),0.15)' }}>
            APD
          </h1>
          <p className="text-slate-400 text-sm sm:text-base mb-8">
            Astrophotography Planning Dashboard
          </p>

          {/* DB unavailable warning */}
          {dbOk === false && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-red-900/40 border border-red-500/40 text-red-300 text-sm text-left">
              <span className="font-semibold">Database unavailable.</span> Upstash Redis is not reachable. Check your{' '}
              <code className="text-xs bg-red-900/60 px-1 rounded">UPSTASH_REDIS_REST_URL</code> and{' '}
              <code className="text-xs bg-red-900/60 px-1 rounded">UPSTASH_REDIS_REST_TOKEN</code> environment variables, then restart the server.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
            {dbOk === false ? (
              <>
                <span
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium opacity-35 cursor-not-allowed bg-accent/[0.05] border border-accent/10 text-accent"
                  title="Database unavailable"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/></svg>
                  Weather Dashboard
                </span>
                <span
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium opacity-35 cursor-not-allowed bg-accent/[0.05] border border-accent/10 text-accent"
                  title="Database unavailable"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/><path strokeLinecap="round" strokeLinejoin="round" d="m13.56 11.747 4.332-.924"/><path strokeLinecap="round" strokeLinejoin="round" d="m16 21-3.105-6.21"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 21l3.105-6.21"/><circle cx="12" cy="4" r="2"/></svg>
                  Sky Dashboard
                </span>
              </>
            ) : (
              <>
                <a
                  href="/weather"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors bg-accent/[0.1] hover:bg-accent/[0.22] border border-accent/25 text-accent"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/></svg>
                  Weather Dashboard
                </a>
                <a
                  href="/skychart.html"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors bg-accent/[0.1] hover:bg-accent/[0.22] border border-accent/25 text-accent"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44"/><path strokeLinecap="round" strokeLinejoin="round" d="m13.56 11.747 4.332-.924"/><path strokeLinecap="round" strokeLinejoin="round" d="m16 21-3.105-6.21"/><path strokeLinecap="round" strokeLinejoin="round" d="M8 21l3.105-6.21"/><circle cx="12" cy="4" r="2"/></svg>
                  Sky Dashboard
                </a>
              </>
            )}
          </div>

          {/* What's inside toggle */}
          <div className="border-t border-white/[0.06] mt-6 pt-5">
            <button
              onClick={() => setFeaturesOpen(f => !f)}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mx-auto"
            >
              <span>What's inside</span>
              <svg
                className={`w-3 h-3 transition-transform duration-200 ${featuresOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {featuresOpen && (
              <div className="mt-4 grid grid-cols-2 gap-x-5 text-left">
                <div>
                  <div className="text-[0.62rem] font-semibold text-accent uppercase tracking-wider mb-2">🌙 Weather</div>
                  {[
                    'Night-only hourly forecasts',
                    'Meteoblue + Met Office',
                    'Astrophotography score 0–100',
                    'Weekly cloud heatmap',
                    'Moonlight & sky brightness',
                    'Solar section + SDO imagery',
                    'LLM summary endpoint for AI automations',
                  ].map(f => (
                    <div key={f} className="flex items-start gap-1.5 text-[0.7rem] text-slate-400 mb-1">
                      <span className="text-accent/50 flex-shrink-0 mt-px">✦</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[0.62rem] font-semibold text-accent uppercase tracking-wider mb-2">🔭 Sky</div>
                  {[
                    'Interactive sky map (Aladin)',
                    'Camera FOV + mosaic planner',
                    'Saved FOVs & favorites',
                    'DSO overlays: M, NGC, IC…',
                    'Time travel ±h / ±d / ±month',
                    'Telescopius highlights & lists',
                  ].map(f => (
                    <div key={f} className="flex items-start gap-1.5 text-[0.7rem] text-slate-400 mb-1">
                      <span className="text-accent/50 flex-shrink-0 mt-px">✦</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Utility links */}
          <div className="flex items-center justify-center gap-5 mt-5">
            <a
              href="/settings"
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Settings
            </a>
            <a
              href="/about"
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01"/></svg>
              About
            </a>
          </div>

          <p className="mt-8 text-[0.8rem] text-slate-600 italic tracking-wide">
            An opinionated planner for astrophotography
          </p>

          <p className="mt-6 text-[0.6rem] text-slate-700 tracking-wide">
            © 2026 Giancarlo Erra
          </p>
        </div>
      </div>
    </div>
  );
}
