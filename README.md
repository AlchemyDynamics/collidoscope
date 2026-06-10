# ⚛️ COLLIDOSCOPE

**Run your own particle accelerator. Smash protons. Discover the universe.**

Collidoscope is a browser game for curious kids (and grown-ups) that turns real
particle physics into a discovery hunt. You operate a CERN-style collider:
crank the beam energy, squeeze the luminosity, fire the beams, and identify
the particles spraying through your 3D detector — logging every species in
your **Particle-Dex**, all the way to the legendary **Higgs boson**.

🎮 **Play it:** open `index.html` in any modern browser — Three.js is bundled,
so it runs fully offline — or visit the GitHub Pages site.

---

## How to play

1. **⚡ Set beam energy** — E = mc²: you can only create particles you can
   afford. 1 GeV gets you pions; 13.6 TeV is Higgs territory.
2. **🎚️ Crank beam intensity** — luminosity. Rare particles have tiny cross
   sections; more collisions per crossing means better odds.
3. **🧲 Tune the magnet** — the solenoid bends charged tracks
   (R = pT / 0.3·B, the real formula). Stronger field, tighter curls.
4. **🔥 FIRE** — beams race in at 99.9999991% c and smash in your detector.
5. **🔍 Click the `?` markers** in the 3D event display to identify particles.
   First identification of a species = a new Particle-Dex entry, science
   points, and sometimes an achievement.
6. **👑 Earn the Higgs** — discover the W, Z, and top quark first, then run
   above 5 TeV at high intensity. One candidate proves nothing: collect
   enough twin-photon events at 125 GeV to reach **5σ significance**,
   exactly like ATLAS & CMS did on July 4, 2012.

## The physics is real

- **32 species** with true PDG masses, charges, spins, lifetimes, decay
  channels, and discovery history — from the electron (1897) to the Higgs (2012).
- **Energy thresholds**: particles only appear when √s can pay for them.
- **Cross-section flavored rarity**: a Higgs is ~1 in 10 billion collisions at
  the LHC; here luminosity boosts your odds, like in real life.
- **Honest detector**: barrel layers modeled on CMS — silicon tracker, ECAL,
  HCAL, muon chambers. Electrons/photons stop in the ECAL, hadrons in the
  HCAL, muons punch through everything, neutrinos appear only as missing
  energy. Charged tracks helix with R = pT/(0.3 B).
- **Real signatures**: quarks appear only as jets (confinement!), strange
  baryons decay in V's and cascades at displaced vertices, the Z shows up as a
  back-to-back muon pair, the Higgs as twin photons at 125 GeV.
- **Track multiplicity** grows with log(√s), like real minimum-bias pp data.
- The energy slider walks through accelerator history: Cyclotron → Bevatron →
  SPS → SppS → Tevatron → LHC.

## Tech

Vanilla HTML/CSS/JS + Three.js (CDN, no build step). WebAudio-synthesized
sound. Progress saved in `localStorage`.

```
index.html        shell & layout
css/style.css     control-room visual design
js/particles.js   the particle database (PDG 2024 values)
js/physics.js     event generation & track kinematics
js/detector3d.js  Three.js detector + event display
js/audio.js       synthesized SFX
js/game.js        game state, dex, achievements, Higgs hunt
```

## Sources

- Particle Data Group, *Review of Particle Physics* (pdg.lbl.gov)
- CERN — LHC machine facts & the 2012 Higgs discovery announcement
- Historical discovery records: SLAC, Fermilab, Brookhaven, DESY, Berkeley

*Made to make kids fall in love with the Standard Model.* 🌌
