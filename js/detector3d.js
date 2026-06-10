/* ============================================================
   COLLIDOSCOPE — 3D Event Display
   A simplified barrel detector modeled on CMS/ATLAS:
     beam pipe → silicon tracker → ECAL → HCAL → muon chambers
   Charged particles helix in the solenoid field, photons land
   in the ECAL, hadrons in the HCAL, muons punch through it all.
   ============================================================ */

const Detector3D = (() => {
  const LAYERS = {
    pipe:   0.12,
    tracker: 1.15,
    ecal:   1.75,
    hcal:   2.55,
    muon:   3.9,
  };
  const HALF_LEN = { tracker: 2.6, ecal: 3.2, hcal: 4.0, muon: 5.2 };
  const STOP_R = { ecal: LAYERS.ecal, hcal: LAYERS.hcal, exit: LAYERS.muon + 1.2 };

  let scene, camera, renderer, controls;
  let eventGroup, beamGroup, detectorGroup;
  let markers = [];          // clickable sprites -> particle index
  let trackMeshes = [];
  let raycaster, pointer;
  let clickCallback = null;
  let animating = [];        // tracks being progressively revealed
  let clock = { t: 0 };
  let flashLight, ringPulses = [];
  let canvasEl;

  /* ---------- textures ---------- */
  function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function questionTexture(color = '#ffffff') {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(48, 48, 4, 48, 48, 44);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, hexToRGBA(color, 0.75));
    g.addColorStop(1, hexToRGBA(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
    ctx.fillStyle = 'rgba(10,12,30,0.9)';
    ctx.beginPath(); ctx.arc(48, 48, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 48, 49);
    return new THREE.CanvasTexture(c);
  }

  function hexToRGBA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  let GLOW_TEX, SPARK_TEX;

  /* ---------- detector geometry ---------- */
  function buildDetector() {
    detectorGroup = new THREE.Group();

    const mkCyl = (r, len, color, opacity) => {
      const geo = new THREE.CylinderGeometry(r, r, len, 48, 1, true);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      return new THREE.Mesh(geo, mat);
    };
    const mkWire = (r, len, color, opacity, segs = 24) => {
      const group = new THREE.Group();
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      // rings
      for (const zf of [-0.5, 0, 0.5]) {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), zf * len));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
      // longitudinal bars
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const pts = [
          new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), -len / 2),
          new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), len / 2),
        ];
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      }
      return group;
    };

    // beam pipe
    detectorGroup.add(mkCyl(LAYERS.pipe, HALF_LEN.muon * 2.4, 0x88e0ff, 0.25));
    // tracker (cyan), ECAL (green), HCAL (orange), muon (red)
    detectorGroup.add(mkWire(LAYERS.tracker, HALF_LEN.tracker * 2, 0x22d3ee, 0.16, 28));
    detectorGroup.add(mkWire(LAYERS.ecal,    HALF_LEN.ecal * 2,    0x4ade80, 0.13, 32));
    detectorGroup.add(mkWire(LAYERS.hcal,    HALF_LEN.hcal * 2,    0xfb923c, 0.11, 36));
    detectorGroup.add(mkWire(LAYERS.muon,    HALF_LEN.muon * 2,    0xf87171, 0.09, 16));
    detectorGroup.add(mkCyl(LAYERS.tracker, HALF_LEN.tracker * 2, 0x22d3ee, 0.03));
    detectorGroup.add(mkCyl(LAYERS.ecal,    HALF_LEN.ecal * 2,    0x4ade80, 0.025));
    detectorGroup.add(mkCyl(LAYERS.hcal,    HALF_LEN.hcal * 2,    0xfb923c, 0.02));

    scene.add(detectorGroup);
  }

  /* ---------- beams ---------- */
  function buildBeams() {
    beamGroup = new THREE.Group();
    const mat = new THREE.SpriteMaterial({ map: GLOW_TEX, color: 0x7dd3fc, transparent: true, blending: THREE.AdditiveBlending });
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const s = new THREE.Sprite(mat.clone());
        s.scale.set(0.5, 0.5, 1);
        s.userData = { dir, offset: i * 1.4 };
        s.visible = false;
        beamGroup.add(s);
      }
    }
    scene.add(beamGroup);
  }

  /* ---------- public: init ---------- */
  function init(canvas) {
    canvasEl = canvas;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05060f, 0.018);

    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    camera.position.set(6.5, 4.5, 8.5);

    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.2;
    controls.maxDistance = 30;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    GLOW_TEX = glowTexture();
    SPARK_TEX = glowTexture('rgba(255,255,240,1)', 'rgba(255,200,80,0)');

    buildDetector();
    buildBeams();

    eventGroup = new THREE.Group();
    scene.add(eventGroup);

    flashLight = new THREE.PointLight(0xffffff, 0, 30);
    scene.add(flashLight);

    // ambient starfield dust
    const starGeo = new THREE.BufferGeometry();
    const starPos = [];
    for (let i = 0; i < 350; i++) {
      const r = 18 + Math.random() * 50;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x334155, size: 0.12, transparent: true, opacity: 0.7 })));

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    canvas.addEventListener('pointerdown', e => { canvas._downXY = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', e => {
      if (!canvas._downXY) return;
      const [dx, dy] = [e.clientX - canvas._downXY[0], e.clientY - canvas._downXY[1]];
      if (Math.hypot(dx, dy) < 6) handleClick(e);
    });

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(loop);
  }

  function resize() {
    const w = canvasEl.clientWidth || canvasEl.parentElement.clientWidth;
    const h = canvasEl.clientHeight || canvasEl.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function handleClick(e) {
    const rect = canvasEl.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(markers.filter(m => m.visible));
    if (hits.length && clickCallback) {
      controls.autoRotate = false;
      clickCallback(hits[0].object.userData.particleIndex, hits[0].object);
    }
  }

  function onParticleClick(cb) { clickCallback = cb; }

  /* ---------- track building ---------- */
  function addTrack(points, color, opts = {}) {
    const pts = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    if (pts.length < 2) return null;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setDrawRange(0, 0);
    const mat = opts.dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: opts.opacity || 0.9 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity || 0.9, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    if (opts.dashed) line.computeLineDistances();
    line.userData.totalPts = pts.length;
    eventGroup.add(line);
    trackMeshes.push(line);
    animating.push({ line, n: pts.length, shown: 0, speed: opts.speed || 1.6, delay: opts.delay || 0 });
    return { line, endPoint: pts[pts.length - 1], midPoint: pts[Math.floor(pts.length * 0.65)] };
  }

  function addBlob(pos, color, size = 0.5, delay = 0) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEX, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.position.set(pos.x, pos.y, pos.z);
    m.scale.set(size, size, 1);
    eventGroup.add(m);
    ringPulses.push({ sprite: m, t: -delay, fadeIn: true, baseSize: size });
    return m;
  }

  function addMarker(pos, color, particleIndex, delay = 0) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: questionTexture(color), transparent: true, opacity: 0,
      depthWrite: false, depthTest: false,
    }));
    m.position.set(pos.x, pos.y, pos.z);
    m.scale.set(0.62, 0.62, 1);
    m.userData = { particleIndex, pulse: Math.random() * Math.PI * 2, delay, born: clock.t };
    m.renderOrder = 999;
    eventGroup.add(m);
    markers.push(m);
    return m;
  }

  /* ---------- render one collision event ---------- */
  function renderEvent(event, bField) {
    clearEvent();
    const parts = event.particles;

    parts.forEach((p, idx) => {
      const sp = PARTICLES[p.species];
      const color = new THREE.Color(sp.color);
      const stopR = STOP_R[sp.stopAt] || STOP_R.hcal;
      const delay = p.isChild ? 0.35 : 0;
      let markerPos = null;

      switch (sp.kind) {
        case 'helix': {
          const pts = Physics.helixPoints(p, bField, stopR, HALF_LEN.hcal);
          const tr = addTrack(pts, color, { delay });
          if (!tr) break;
          if (sp.stopAt !== 'exit') addBlob(tr.endPoint, color, sp.stopAt === 'ecal' ? 0.55 : 0.75, delay + 0.5);
          else addBlob(tr.endPoint, color, 0.4, delay + 0.5);
          markerPos = tr.midPoint;
          break;
        }
        case 'photon': {
          const pts = Physics.linePoints(p, stopR, HALF_LEN.ecal);
          const tr = addTrack(pts, color, { opacity: 0.55, delay });
          if (!tr) break;
          addBlob(tr.endPoint, color, 0.8, delay + 0.4);
          markerPos = tr.endPoint;
          break;
        }
        case 'missing': {
          const pts = Physics.linePoints(p, STOP_R.exit, HALF_LEN.muon);
          const tr = addTrack(pts, 0x94a3b8, { dashed: true, opacity: 0.7, delay });
          if (!tr) break;
          markerPos = tr.endPoint;
          break;
        }
        case 'jet': {
          // collimated cone of 6–9 sub-tracks
          const nSub = 6 + Math.floor(Math.random() * 4);
          let mid = null;
          for (let i = 0; i < nSub; i++) {
            const sub = {
              ...p,
              pT: Math.max(0.6, p.pT * (0.25 + Math.random() * 0.5)),
              phi: p.phi + (Math.random() - 0.5) * 0.42,
              eta: p.eta + (Math.random() - 0.5) * 0.42,
              charge: Math.random() < 0.5 ? 1 : -1,
            };
            const pts = Physics.helixPoints(sub, bField, STOP_R.hcal, HALF_LEN.hcal);
            const tr = addTrack(pts, color, { opacity: 0.8, delay: delay + i * 0.04 });
            if (tr && i === 0) mid = tr.midPoint;
            if (tr && i < 3) addBlob(tr.endPoint, color, 0.6, delay + 0.6);
          }
          markerPos = mid;
          break;
        }
        case 'vee': {
          // invisible parent (faint dashed) to displaced vertex; children drawn separately
          const o = p.origin || { x: 0, y: 0, z: 0 };
          const vtx = p.decayVertex || { x: o.x + 0.4 * Math.cos(p.phi), y: o.y + 0.4 * Math.sin(p.phi), z: o.z };
          const tr = addTrack([o, vtx], color, { dashed: true, opacity: 0.35, delay });
          addBlob(vtx, color, 0.45, delay + 0.3);
          markerPos = vtx;
          break;
        }
        case 'boss': {
          // starburst at origin — the heavy particle itself
          const burst = new THREE.Sprite(new THREE.SpriteMaterial({
            map: SPARK_TEX, color, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          const sc = sp.rarity === 'legendary' ? 2.6 : 1.7;
          burst.position.set(p.origin.x, p.origin.y, p.origin.z);
          burst.scale.set(sc, sc, 1);
          eventGroup.add(burst);
          ringPulses.push({ sprite: burst, t: 0, fadeIn: true, baseSize: sc, throb: true });
          markerPos = { x: p.origin.x, y: p.origin.y + 0.45, z: p.origin.z };
          break;
        }
      }

      if (markerPos) addMarker(markerPos, sp.color, idx, delay);
    });

    flashLight.intensity = 3.5;
    controls.autoRotate = true;
  }

  function clearEvent() {
    markers.forEach(m => m.material.dispose());
    eventGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map !== GLOW_TEX && o.material.map !== SPARK_TEX) { /* keep shared */ } });
    while (eventGroup.children.length) eventGroup.remove(eventGroup.children[0]);
    markers = [];
    trackMeshes = [];
    animating = [];
    ringPulses = [];
  }

  function resolveMarker(marker, symbol, color) {
    // swap "?" for the particle's symbol once identified
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const ctx = c.getContext('2d');
    ctx.fillStyle = hexToRGBA(color, 0.18);
    ctx.beginPath(); ctx.arc(48, 48, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hexToRGBA(color, 0.9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(48, 48, 28, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px "Segoe UI Symbol", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(symbol, 48, 49);
    marker.material.map = new THREE.CanvasTexture(c);
    marker.material.needsUpdate = true;
    marker.userData.resolved = true;
  }

  /* ---------- beam / fire animation ---------- */
  let beamAnim = null;
  function playBeams(duration, onCollide) {
    beamAnim = { t: 0, duration, onCollide, collided: false };
    beamGroup.children.forEach(s => { s.visible = true; });
  }

  function flash() {
    flashLight.intensity = 14;
    const f = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0xffffff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    f.scale.set(6, 6, 1);
    eventGroup.add(f);
    ringPulses.push({ sprite: f, t: 0, flash: true, baseSize: 6 });
  }

  /* ---------- main loop ---------- */
  let lastT = 0;
  function loop(t) {
    // schedule the next frame FIRST — an exception below must never kill the loop
    requestAnimationFrame(loop);
    try { tick(t); } catch (e) { /* keep animating */ }
  }

  function tick(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    clock.t += dt;

    // progressive track reveal
    for (const a of animating) {
      if (a.delay > 0) { a.delay -= dt; continue; }
      a.shown = Math.min(a.n, a.shown + a.n * dt * a.speed);
      a.line.geometry.setDrawRange(0, Math.floor(a.shown));
    }

    // marker pulse
    for (const m of markers) {
      if (m.userData.delay > 0) { m.userData.delay -= dt; continue; }
      if (m.material.opacity < 1 && !m.userData.resolved) m.material.opacity = Math.min(1, m.material.opacity + dt * 2);
      const s = m.userData.resolved ? 0.55 : 0.58 + 0.1 * Math.sin(clock.t * 4 + m.userData.pulse);
      m.scale.set(s, s, 1);
    }

    // blobs / bursts
    for (const r of ringPulses) {
      r.t += dt;
      if (r.t < 0) continue;
      if (r.flash) {
        r.sprite.material.opacity = Math.max(0, 1 - r.t * 2.2);
        r.sprite.scale.setScalar(r.baseSize * (1 + r.t * 4));
        continue;
      }
      const o = Math.min(0.95, r.t * 2.5);
      r.sprite.material.opacity = r.throb ? o * (0.75 + 0.25 * Math.sin(clock.t * 5)) : o;
      if (r.throb) {
        const s = r.baseSize * (1 + 0.12 * Math.sin(clock.t * 5));
        r.sprite.scale.set(s, s, 1);
      }
    }

    // beams racing in
    if (beamAnim) {
      beamAnim.t += dt;
      const prog = beamAnim.t / beamAnim.duration;
      beamGroup.children.forEach(s => {
        const { dir, offset } = s.userData;
        const z = dir * (12 + offset) * (1 - prog);
        s.position.set(0, 0, z);
        s.material.opacity = Math.min(1, prog * 3);
        const sc = 0.3 + prog * 0.45;
        s.scale.set(sc, sc, 1);
      });
      if (prog >= 1 && !beamAnim.collided) {
        beamAnim.collided = true;
        beamGroup.children.forEach(s => { s.visible = false; });
        flash();
        const cb = beamAnim.onCollide;
        beamAnim = null;
        // isolate the game callback — its errors must not poison the render loop
        if (cb) { try { cb(); } catch (e) { /* game layer handles fallback */ } }
      }
    }

    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 12);

    controls.update();
    renderer.render(scene, camera);
  }

  function setAutoRotate(v) { controls.autoRotate = v; }
  function resetCamera() {
    camera.position.set(6.5, 4.5, 8.5);
    controls.target.set(0, 0, 0);
  }

  return { init, renderEvent, clearEvent, playBeams, onParticleClick, resolveMarker, setAutoRotate, resetCamera, resize };
})();
