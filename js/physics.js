/* ============================================================
   COLLIDOSCOPE — Collision Physics Engine
   Simplified but physically honest event generation:
   - Only particles with production threshold ≤ √s can appear
     (you can't make what you can't pay for: E = mc²)
   - Rare particles have tiny "cross sections" — higher beam
     intensity (luminosity) raises your odds, just like at CERN
   - Track multiplicity grows with log(√s), like real pp data
   - Charged tracks curl with radius R = pT / (0.3 · B)
   ============================================================ */

const Physics = (() => {

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  /* Sample transverse momentum (GeV) — soft exponential spectrum,
     like real minimum-bias collisions. */
  function softPT(sqrtS) {
    const scale = 0.35 + 0.15 * Math.log10(Math.max(1, sqrtS));
    return Math.max(0.15, -scale * Math.log(Math.random()));
  }

  /* Stiff pT for featured/heavy decay products. */
  function hardPT(sqrtS, massGeV) {
    const avail = Math.max(0.5, (sqrtS - massGeV) / 2);
    return Math.min(60, Math.max(0.8, avail * rand(0.15, 0.5), massGeV * 0.35));
  }

  function randomDirection() {
    return {
      phi: rand(0, Math.PI * 2),
      eta: rand(-1.4, 1.4),   // keep tracks in the barrel where they look best
    };
  }

  function makeParticle(speciesId, opts = {}) {
    const sp = PARTICLES[speciesId];
    const dir = randomDirection();
    return {
      species: speciesId,
      kind: sp.kind,
      charge: opts.charge !== undefined ? opts.charge
        : (typeof sp.charge === 'number' ? Math.sign(sp.charge) : (Math.random() < 0.5 ? 1 : -1)),
      pT: opts.pT || softPT(opts.sqrtS || 10),
      phi: opts.phi !== undefined ? dirJitter(opts.phi, opts.jitter) : dir.phi,
      eta: opts.eta !== undefined ? opts.eta + rand(-(opts.jitter || 0), opts.jitter || 0) : dir.eta,
      origin: opts.origin || { x: 0, y: 0, z: 0 },
      parentIndex: opts.parentIndex !== undefined ? opts.parentIndex : null,
      featured: !!opts.featured,
    };
  }

  function dirJitter(phi, j) { return phi + rand(-(j || 0), j || 0); }

  /* Expand a boss/vee particle into itself + decay children. */
  function expandDecay(list, parent, sqrtS) {
    const sp = PARTICLES[parent.species];
    if (!sp.decay) return;
    const parentIdx = list.indexOf(parent);

    // Displaced vertex for 'vee' kinds, prompt for 'boss'
    let vtx = parent.origin || { x: 0, y: 0, z: 0 };
    if (sp.kind === 'vee') {
      const d = rand(0.25, 0.8); // meters in detector scale — exaggerated for visibility
      const po = parent.origin || { x: 0, y: 0, z: 0 };
      vtx = {
        x: po.x + d * Math.cos(parent.phi),
        y: po.y + d * Math.sin(parent.phi),
        z: po.z + d * Math.sinh(parent.eta) * 0.4,
      };
      parent.decayVertex = vtx;
    }

    // children fly roughly along parent direction, opened up
    const n = sp.decay.length;
    sp.decay.forEach((childKey, i) => {
      const child = CHILD_MAP[childKey];
      const spread = sp.kind === 'vee' ? 0.45 : 0.55;
      const offset = (i - (n - 1) / 2) * spread + rand(-0.1, 0.1);
      const childSp = PARTICLES[child.species];
      const p = makeParticle(child.species, {
        charge: child.charge,
        pT: hardPT(sqrtS, sp.massGeV) / Math.max(1.5, n) + rand(0.3, 1.5),
        phi: parent.phi + offset,
        eta: parent.eta + rand(-0.25, 0.25),
        origin: vtx,
        parentIndex: parentIdx,
        sqrtS,
      });
      p.isChild = true;
      list.push(p);
      // one level of cascade (Ξ → Λ → p π, B → J/ψ → μμ)
      if (childSp.decay && !child.leaf) return; // safety
      if (childSp.decay && child.leaf) expandDecay(list, p, sqrtS);
    });
  }

  /* Pick featured (headline) species using rarity weights + luminosity. */
  function pickFeatured(eligible, lumi, discovered) {
    const pool = eligible.filter(id => PARTICLES[id].rarity !== 'legendary');
    if (!pool.length) return null;
    const weights = pool.map(id => {
      const sp = PARTICLES[id];
      let w = RARITY[sp.rarity].weight;
      // luminosity boosts rare production (more collisions per crossing)
      if (sp.rarity === 'rare') w *= (0.5 + 2.2 * lumi);
      if (sp.rarity === 'epic') w *= (0.25 + 2.8 * lumi);
      // pity boost: heavily favor undiscovered species so the dex keeps growing
      if (!discovered.has(id)) w *= 3.2;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /* ------------------------------------------------------------
     buildEvent — the heart of the game.
     settings: { sqrtS (GeV), lumi (0..1), bField (Tesla) }
     state:    { discovered:Set, higgsHunt:{active, candidates, dryFires} }
     ------------------------------------------------------------ */
  function buildEvent(settings, state) {
    const { sqrtS, lumi } = settings;
    const particles = [];
    const eligible = Object.keys(PARTICLES).filter(id => PARTICLES[id].threshold <= sqrtS);

    /* --- Higgs candidate logic: the earned feat ------------------
       Requirements (mirrors reality):
       1. W, Z and top already discovered (you've mastered the heavy sector)
       2. √s ≥ 5 TeV (LHC-class energies)
       3. High luminosity helps — Higgs production is ~1 in 10 billion
       A pity counter nudges odds up after dry fires so the hunt is
       hard but never hopeless. 4 candidates = 5σ = DISCOVERY. */
    let higgsEvent = false;
    const prereqs = ['wboson', 'zboson', 'top'].every(id => state.discovered.has(id));
    if (prereqs && sqrtS >= 5000 && !state.discovered.has('higgs')) {
      const p = Math.min(0.85, 0.22 * lumi * (sqrtS / 13600) + 0.07 * (state.higgsDryFires || 0));
      if (Math.random() < p) higgsEvent = true;
    }

    /* --- Featured heavy particle(s) --- */
    const featuredIds = [];
    if (higgsEvent) {
      featuredIds.push('higgs');
    } else {
      const nFeatured = 1 + (lumi > 0.65 && Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < nFeatured; i++) {
        const id = pickFeatured(eligible, lumi, state.discovered);
        if (id) featuredIds.push(id);
      }
    }

    featuredIds.forEach(id => {
      const sp = PARTICLES[id];
      const p = makeParticle(id, {
        pT: hardPT(sqrtS, sp.massGeV),
        featured: true,
        sqrtS,
      });
      particles.push(p);
      if (sp.decay) expandDecay(particles, p, sqrtS);
    });

    /* --- Underlying event: soft spray of common particles ---
       Multiplicity ~ a + b·ln(s), like real pp collisions. */
    const commons = eligible.filter(id =>
      ['common'].includes(PARTICLES[id].rarity) && !PARTICLES[id].decay && PARTICLES[id].kind !== 'jet');
    const nSoft = Math.round((3 + 5.5 * Math.log10(Math.max(1, sqrtS))) * (0.55 + 0.65 * lumi));
    for (let i = 0; i < nSoft; i++) {
      if (!commons.length) break;
      // pions dominate real events ~70% — bias the spray accordingly
      const id = Math.random() < 0.55 ? (eligible.includes('piplus') ? 'piplus' : pick(commons)) : pick(commons);
      particles.push(makeParticle(id, { sqrtS }));
    }

    /* Occasionally sneak in an uncommon (neutrino, Λ, antiproton…) */
    const uncommons = eligible.filter(id => PARTICLES[id].rarity === 'uncommon');
    if (uncommons.length && Math.random() < 0.35 + 0.4 * lumi) {
      const id = pick(uncommons);
      const p = makeParticle(id, { pT: softPT(sqrtS) + 0.6, sqrtS });
      particles.push(p);
      if (PARTICLES[id].decay) expandDecay(particles, p, sqrtS);
    }

    /* Gluon three-jet special: if gluon featured, add the 2 quark jets */
    if (featuredIds.includes('gluon')) {
      ['up', 'down'].forEach(q => particles.push(makeParticle(q, { pT: hardPT(sqrtS, 0), sqrtS })));
    }

    return { particles, sqrtS, higgsEvent, featuredIds };
  }

  /* Helix geometry for charged tracks.
     R(meters) = pT(GeV) / (0.3 · B(Tesla)) — the real formula. */
  function helixPoints(p, bField, stopRadius, halfLength, steps = 90) {
    const R = Math.max(0.05, p.pT / (0.3 * Math.max(0.2, bField)));
    const dir = -p.charge; // curl direction
    const tanLambda = Math.sinh(p.eta);
    const cx = p.origin.x - dir * R * Math.sin(p.phi);
    const cy = p.origin.y + dir * R * Math.cos(p.phi);
    const pts = [];
    const maxTurn = Math.min(Math.PI * 2.4, (stopRadius * 3) / R);
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * maxTurn;
      const ang = p.phi - dir * Math.PI / 2 + dir * t;
      const x = cx + R * Math.cos(ang);
      const y = cy + R * Math.sin(ang);
      const z = p.origin.z + R * t * tanLambda;
      const r = Math.hypot(x, y);
      pts.push({ x, y, z });
      if (r >= stopRadius || Math.abs(z) >= halfLength) break;
    }
    return pts;
  }

  /* Straight line (photons, neutrals, neutrinos, jet axes). */
  function linePoints(p, stopRadius, halfLength, steps = 24) {
    const dx = Math.cos(p.phi), dy = Math.sin(p.phi), dz = Math.sinh(p.eta) * 0.55;
    const norm = Math.hypot(dx, dy);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const s = (i / steps) * stopRadius * 1.6;
      const x = p.origin.x + dx * s, y = p.origin.y + dy * s, z = p.origin.z + dz * s;
      pts.push({ x, y, z });
      if (Math.hypot(x, y) >= stopRadius / norm || Math.abs(z) >= halfLength) break;
    }
    return pts;
  }

  return { buildEvent, helixPoints, linePoints, softPT };
})();

if (typeof module !== 'undefined') module.exports = Physics;
