import { useState, useMemo, useRef, useCallback } from 'react';
import useMobile from '../hooks/useMobile';

// ============================================
// Creneaux — le remplissage, heure par heure et jour par jour
//
// La question posee a cette page est une question de gerant : ou puis-je
// encore mettre des clients ? Les versions precedentes y repondaient par une
// grille de chiffres — quatre-vingt-quatre cases qu'il fallait comparer une a
// une pour reperer un creux.
//
// Un creux n'est pas une case, c'est une forme : le mardi qui s'affaisse a
// quatorze heures, le samedi qui sature de dix a treize. On trace donc des
// courbes — un axe des heures, une courbe par jour, une echelle de zero a cent
// pour cent — et la forme se lit d'un coup d'oeil.
//
// Sept courbes superposees font un plat de spaghettis. La grille de lecture
// est donc : toutes visibles en fond, une seule mise en avant a la fois. Le
// jour du jour est choisi en arrivant, parce que c'est celui qu'on veut voir.
//
// Chaque chiffre est la part du temps de travail de l'equipe qui a ete vendue
// sur ce creneau — pas un nombre de rendez-vous. Trois rendez-vous le mardi a
// 9 h avec un seul barbier de service, c'est complet ; trois le samedi avec
// quatre barbiers, c'est un quart de la capacite.
// ============================================

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Sept series, sept teintes : les jours sont des categories, pas des degres.
// Les valeurs vivent dans index.css et basculent avec le theme.
const couleurJour = (d) => `var(--jour-${d})`;

// Deux seuils, et ils veulent dire quelque chose de concret :
// sous 40 % la place existe deja et il manque les clients ; au-dessus de 85 %
// le creneau ne peut plus absorber personne, il faut ouvrir des heures.
const SEUIL_CREUX = 40;
const SEUIL_SATURE = 85;

// L'echelle du tableau chiffre. Une seule teinte du clair au fonce : c'est la
// regle des echelles de grandeur, un arc-en-ciel ferait croire a des categories.
const PALIERS = [
  { min: 80, bg: 'rgba(245,158,11,0.92)', ink: '#1a1206' },
  { min: 60, bg: 'rgba(245,158,11,0.62)', ink: '#1a1206' },
  { min: 40, bg: 'rgba(245,158,11,0.36)', ink: 'var(--text)' },
  { min: 20, bg: 'rgba(245,158,11,0.18)', ink: 'var(--text-secondary)' },
  { min: 0, bg: 'rgba(var(--overlay),0.05)', ink: 'var(--text-muted)' },
];
function palier(taux) {
  return PALIERS.find((p) => taux >= p.min) || PALIERS[PALIERS.length - 1];
}

// « 1 h 30 » se lit mieux que « 90 min », et « 45 min » mieux que « 0 h 45 ».
function dureeCourte(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste === 0 ? `${h} h` : `${h} h ${String(reste).padStart(2, '0')}`;
}

// ============================================
// Le trace
//
// Interpolation cubique monotone (Fritsch-Carlson) plutot qu'une spline
// cardinale : une spline ordinaire depasse ses points de passage, et une
// courbe qui monte a 104 % entre deux mesures a 98 % raconte une heure de
// travail qui n'existe pas. La monotone ne depasse jamais.
// ============================================
function cheminLisse(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const pentes = [];
  for (let i = 0; i < n - 1; i++) {
    pentes.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }

  const m = new Array(n);
  m[0] = pentes[0];
  m[n - 1] = pentes[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (pentes[i - 1] + pentes[i]) / 2;

  for (let i = 0; i < n - 1; i++) {
    if (pentes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / pentes[i];
      const b = m[i + 1] / pentes[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * pentes[i];
        m[i + 1] = t * b * pentes[i];
      }
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3;
    d += ` C ${pts[i].x + dx} ${pts[i].y + m[i] * dx}`;
    d += ` ${pts[i + 1].x - dx} ${pts[i + 1].y - m[i + 1] * dx}`;
    d += ` ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

// La barre porte la teinte de son jour, pas celle de l'echelle ambre : sur
// fond blanc, « 18 % d'ambre » ne se distingue plus de la piste vide.
function Jauge({ taux, couleur, hauteur = 8 }) {
  return (
    <div className="cx-jauge" style={{ height: hauteur, borderRadius: hauteur / 2 }}>
      <div
        className="cx-jauge-barre"
        style={{
          width: `${Math.min(taux, 100)}%`,
          borderRadius: hauteur / 2,
          background: couleur || palier(taux).bg,
        }}
      />
    </div>
  );
}

// ============================================
// Les courbes
// ============================================
function Courbes({ heures, jours, grille, parJour, jourActif, onJour, isMobile }) {
  const [survol, setSurvol] = useState(null); // index dans `heures`
  const svgRef = useRef(null);

  // Le viewBox vaut la largeur reelle du cadre, donc une unite SVG vaut un
  // pixel. Sans cette mesure, un viewBox fixe de 720 etire a 1 900 px grossit
  // tout d'un facteur 2,6 : des etiquettes de 25 px et un trait de 7 px.
  const [cadre, setCadre] = useState(null);
  const mesurer = useCallback((noeud) => {
    if (!noeud) return;
    setCadre(noeud.clientWidth);
    const ro = new ResizeObserver(([e]) => setCadre(e.contentRect.width));
    ro.observe(noeud);
  }, []);

  const W = Math.round(cadre || (isMobile ? 340 : 760));
  // La hauteur suit la largeur : sur un ecran large, un graphe de 268 px
  // aplatit les courbes jusqu'a effacer les creux qu'on vient y chercher.
  const H = isMobile ? 210 : Math.round(Math.min(360, Math.max(250, W * 0.23)));
  const PAD = isMobile
    ? { t: 14, r: 12, b: 28, l: 28 }
    : { t: 18, r: 44, b: 30, l: 34 };
  const larg = W - PAD.l - PAD.r;
  const haut = H - PAD.t - PAD.b;

  const nH = heures.length;
  const x = useCallback(
    (i) => (nH <= 1 ? PAD.l + larg / 2 : PAD.l + (i / (nH - 1)) * larg),
    [nH, PAD.l, larg]
  );
  const y = useCallback((taux) => PAD.t + haut - (Math.min(Math.max(taux, 0), 100) / 100) * haut, [PAD.t, haut]);

  // Un jour ferme a midi coupe sa courbe en deux : on ne relie pas deux
  // tronçons par-dessus un trou, ça inventerait des heures ouvertes.
  const traces = useMemo(() => {
    return jours.map((d) => {
      const segments = [];
      let courant = [];
      heures.forEach((h, i) => {
        const c = grille[d]?.[h];
        if (c) {
          courant.push({ x: x(i), y: y(c.fill_rate), i, cell: c });
        } else if (courant.length) {
          segments.push(courant);
          courant = [];
        }
      });
      if (courant.length) segments.push(courant);
      return { day: d, segments, points: segments.flat() };
    });
  }, [jours, heures, grille, x, y]);

  // Deplacer le viseur au clavier : le graphe est un element focusable, les
  // fleches parcourent les heures. Sans ça, tout ce bloc serait a la souris.
  function auClavier(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const pas = e.key === 'ArrowRight' ? 1 : -1;
      const base = survol === null ? (pas > 0 ? -1 : nH) : survol;
      setSurvol(Math.min(Math.max(base + pas, 0), nH - 1));
    } else if (e.key === 'Escape') {
      setSurvol(null);
    }
  }

  function auPointeur(e) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (nH <= 1) return setSurvol(0);
    const i = Math.round(((px - PAD.l) / larg) * (nH - 1));
    setSurvol(Math.min(Math.max(i, 0), nH - 1));
  }

  const heureVue = survol === null ? null : heures[survol];
  const actif = traces.find((t) => t.day === jourActif) || null;

  // Le releve : a l'heure visee, tous les jours ouverts, du plus plein au plus
  // vide. C'est la lecture verticale — l'axe des jours, a heure fixe.
  const releve = useMemo(() => {
    if (heureVue === null) return [];
    return jours
      .map((d) => ({ day: d, cell: grille[d]?.[heureVue] }))
      .filter((r) => r.cell)
      .sort((a, b) => b.cell.fill_rate - a.cell.fill_rate);
  }, [heureVue, jours, grille]);

  // « 12 h » fait une trentaine de pixels : en dessous, les etiquettes se
  // chevauchent et on n'en garde qu'une sur deux.
  const ecart = nH > 1 ? larg / (nH - 1) : larg;
  const pasEtiquette = ecart < 34 ? (ecart < 18 ? 3 : 2) : 1;
  // La derniere heure merite son etiquette, mais pas collee a la precedente :
  // avec une cadence de deux et douze heures, « 19 h » chevauchait « 20 h ».
  const etiquettes = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < nH; i += pasEtiquette) set.add(i);
    if (!set.has(nH - 1)) {
      for (let i = nH - pasEtiquette; i < nH - 1; i++) set.delete(i);
      set.add(nH - 1);
    }
    return set;
  }, [nH, pasEtiquette]);

  return (
    <div className="cx-graphe">
      <div className="cx-graphe-cadre" ref={mesurer}>
        <svg
          ref={svgRef}
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="cx-svg"
          role="img"
          aria-label={`Taux de remplissage de ${heures[0]} h a ${heures[nH - 1]} h, une courbe par jour. Le detail chiffre est dans le tableau plus bas.`}
          tabIndex={0}
          onKeyDown={auClavier}
          onMouseMove={auPointeur}
          onMouseLeave={() => setSurvol(null)}
          onTouchStart={(e) => auPointeur(e.touches[0])}
          onTouchMove={(e) => auPointeur(e.touches[0])}
          onBlur={() => setSurvol(null)}
        >
          {/* La zone basse : sous 40 %, la place existe deja. */}
          <rect
            x={PAD.l} y={y(SEUIL_CREUX)} width={larg} height={PAD.t + haut - y(SEUIL_CREUX)}
            className="cx-zone-creuse"
          />

          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line x1={PAD.l} y1={y(t)} x2={PAD.l + larg} y2={y(t)} className="cx-grille-ligne" />
              <text x={PAD.l - 7} y={y(t) + 3.5} textAnchor="end" className="cx-axe-y">
                {t}
              </text>
            </g>
          ))}

          {/* Le plafond : au-dessus, un creneau n'absorbe plus personne. */}
          <line x1={PAD.l} y1={y(SEUIL_SATURE)} x2={PAD.l + larg} y2={y(SEUIL_SATURE)} className="cx-seuil" />
          {!isMobile && (
            <text x={PAD.l + larg + 5} y={y(SEUIL_SATURE) + 3.5} className="cx-seuil-texte">
              plein
            </text>
          )}

          {/* Le viseur */}
          {survol !== null && (
            <line x1={x(survol)} y1={PAD.t} x2={x(survol)} y2={PAD.t + haut} className="cx-viseur" />
          )}

          {/* Les jours en fond, puis le jour choisi par-dessus : l'ordre du DOM
              fait l'ordre d'empilement en SVG. */}
          {traces
            .filter((t) => t.day !== jourActif)
            .map((t) => (
              <g key={t.day} className="cx-trace cx-trace--fond">
                {t.segments.map((seg, k) => (
                  <path key={k} d={cheminLisse(seg)} stroke={couleurJour(t.day)} />
                ))}
              </g>
            ))}

          {actif && (
            <g className="cx-trace cx-trace--actif">
              {actif.segments.map((seg, k) => (
                <path key={k} d={cheminLisse(seg)} stroke={couleurJour(actif.day)} />
              ))}
              {actif.points.map((p) => (
                <circle
                  key={p.i}
                  cx={p.x}
                  cy={p.y}
                  r={survol === p.i ? 5 : 3.2}
                  fill="var(--bg-card)"
                  stroke={couleurJour(actif.day)}
                  strokeWidth="2"
                />
              ))}
              {/* Les pourcentages, ecrits sur la courbe mise en avant. Sur
                  telephone on ne garde que le sommet et le creux, sinon les
                  etiquettes se marchent dessus. */}
              {actif.points
                .filter((p) => {
                  if (ecart >= 38) return true;
                  const taux = actif.points.map((q) => q.cell.fill_rate);
                  return (
                    p.cell.fill_rate === Math.max(...taux) || p.cell.fill_rate === Math.min(...taux)
                  );
                })
                .map((p) => (
                  <text
                    key={p.i}
                    x={p.x}
                    // Un jour a 100 % longe le bord haut : son etiquette
                    // passe sous le point plutot que hors du cadre.
                    y={p.y - 9 < PAD.t + 6 ? p.y + 15 : p.y - 9}
                    textAnchor="middle"
                    className="cx-valeur"
                    fill={couleurJour(actif.day)}
                  >
                    {p.cell.fill_rate}
                  </text>
                ))}
              {!isMobile && actif.points.length > 0 && (
                <text
                  x={actif.points[actif.points.length - 1].x + 8}
                  y={actif.points[actif.points.length - 1].y + 3.5}
                  className="cx-trace-nom"
                  fill={couleurJour(actif.day)}
                >
                  {JOURS_COURTS[actif.day]}
                </text>
              )}
            </g>
          )}

          {heures.map((h, i) => {
            // L'heure visee gagne toujours son etiquette, et fait taire
            // celles qu'elle toucherait.
            if (survol !== null && i !== survol && Math.abs(x(i) - x(survol)) < 30) return null;
            if (!etiquettes.has(i) && survol !== i) return null;
            return (
              <text
                key={h}
                x={x(i)}
                y={H - 10}
                textAnchor="middle"
                className={`cx-axe-x${survol === i ? ' is-vise' : ''}`}
              >
                {h} h
              </text>
            );
          })}

          <text x={PAD.l - 7} y={PAD.t - 5} textAnchor="end" className="cx-axe-unite">
            %
          </text>
        </svg>
      </div>

      {/* Le releve. Il occupe toujours la meme hauteur : sans ça, la page
          sautait de quarante pixels a chaque passage de souris. */}
      <div className="cx-releve" aria-live="polite">
        {heureVue === null ? (
          <span className="cx-releve-vide">
            Survolez ou parcourez au clavier (&larr; &rarr;) pour lire une heure jour par jour.
          </span>
        ) : (
          <>
            <span className="cx-releve-heure">{heureVue} h</span>
            <span className="cx-releve-liste">
              {releve.map((r) => (
                <span
                  key={r.day}
                  className={`cx-releve-jour${r.day === jourActif ? ' is-actif' : ''}`}
                  style={{ '--teinte': couleurJour(r.day) }}
                >
                  <i aria-hidden="true" />
                  {JOURS_COURTS[r.day]} <b>{r.cell.fill_rate} %</b>
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      {/* La legende est aussi le selecteur : un seul objet a comprendre. */}
      <div className="cx-legende" role="tablist" aria-label="Choisir un jour">
        {jours.map((d) => {
          const j = parJour.find((p) => p.day === d);
          const est = d === jourActif;
          return (
            <button
              key={d}
              role="tab"
              aria-selected={est}
              className={`cx-puce${est ? ' is-actif' : ''}`}
              style={{ '--teinte': couleurJour(d) }}
              onClick={() => onJour(d)}
            >
              <i aria-hidden="true" />
              <span className="cx-puce-nom">{JOURS_COURTS[d]}</span>
              <span className="cx-puce-taux">{j.taux} %</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
export default function CreneauxCreux({ data, monthLabel }) {
  const isMobile = useMobile();
  const cellules = useMemo(() => (data?.fill || []).filter((c) => c.open_minutes > 0), [data]);

  const aujourdhui = (new Date().getDay() + 6) % 7;
  const [jourChoisi, setJourChoisi] = useState(aujourdhui);
  // Ouvert sur grand ecran : c'est ce qui part dans l'export PDF, et un PDF
  // sans les chiffres ne sert a rien. Replie sur telephone, ou il ferait
  // defiler trois ecrans avant la suite.
  const [tableauOuvert, setTableauOuvert] = useState(!isMobile);

  const calcul = useMemo(() => {
    if (cellules.length === 0) return null;

    const heures = [...new Set(cellules.map((c) => c.hour))].sort((a, b) => a - b);
    const jours = [...new Set(cellules.map((c) => c.day))].sort((a, b) => a - b);

    const grille = {};
    cellules.forEach((c) => {
      if (!grille[c.day]) grille[c.day] = {};
      grille[c.day][c.hour] = c;
    });

    // Moyenne ponderee par le temps ouvert : sinon une heure ou un seul barbier
    // travaille pese autant qu'une heure a quatre.
    const moyenne = (liste) => {
      const ouvert = liste.reduce((a, c) => a + c.open_minutes, 0);
      const vendu = liste.reduce((a, c) => a + c.booked_minutes, 0);
      return ouvert > 0 ? Math.round((vendu / ouvert) * 100) : 0;
    };

    const parJour = jours.map((d) => {
      const duJour = cellules.filter((c) => c.day === d);
      return {
        day: d,
        taux: moyenne(duJour),
        libre: duJour.reduce((a, c) => a + (c.open_minutes - c.booked_minutes), 0),
        rdv: duJour.reduce((a, c) => a + c.bookings, 0),
      };
    });

    // La duree moyenne d'un rendez-vous, mesuree sur la periode : elle traduit
    // un trou en nombre de clients, ce qui parle bien plus qu'un pourcentage.
    const totalRdv = cellules.reduce((a, c) => a + c.bookings, 0);
    const totalVendu = cellules.reduce((a, c) => a + c.booked_minutes, 0);
    const dureeRdv = totalRdv > 0 ? Math.round(totalVendu / totalRdv) : 30;

    const avecLibre = cellules.map((c) => ({
      ...c,
      libre: c.open_minutes - c.booked_minutes,
      places: Math.floor((c.open_minutes - c.booked_minutes) / dureeRdv),
    }));

    // Les heures a remplir : classees par temps de barbier inoccupe, pas par
    // pourcentage. Une heure a 10 % ou un seul barbier travaille represente
    // moins d'occasions manquees qu'une heure a 45 % ou ils sont quatre.
    // Deux creneaux par jour au maximum, sinon une seule journee creuse occupe
    // toute la liste et on ne voit plus le reste de la semaine.
    const vus = {};
    const aRemplir = avecLibre
      .filter((c) => c.fill_rate < 55 && c.places >= 1)
      .sort((a, b) => b.libre - a.libre)
      .filter((c) => {
        vus[c.day] = (vus[c.day] || 0) + 1;
        return vus[c.day] <= 2;
      })
      .slice(0, isMobile ? 3 : 5);

    const plein = [...cellules].sort((a, b) => b.fill_rate - a.fill_rate)[0];
    const global = moyenne(cellules);
    const totalLibre = avecLibre.reduce((a, c) => a + c.libre, 0);
    const classement = [...parJour].sort((a, b) => b.taux - a.taux);

    return {
      heures, jours, grille, parJour, classement,
      plein, global, dureeRdv, aRemplir, avecLibre, totalLibre,
    };
  }, [cellules, isMobile]);

  if (!calcul) {
    return <div className="empty-state">Pas encore assez de rendez-vous sur cette p&eacute;riode</div>;
  }

  const {
    heures, jours, grille, parJour, classement,
    plein, global, dureeRdv, aRemplir, avecLibre, totalLibre,
  } = calcul;

  // Si le salon est ferme le jour choisi, on bascule sur le premier jour ouvert.
  const jourActif = jours.includes(jourChoisi) ? jourChoisi : jours[0];
  const maxLibre = Math.max(...classement.map((j) => j.libre), 1);

  return (
    <div className="cx">
      {/* ---- Ce qu'il faut retenir, en une phrase ---- */}
      <p className="cx-resume">
        Sur {monthLabel}, l&apos;&eacute;quipe a vendu <strong>{global} %</strong> de son temps de
        travail. Il reste <strong>{dureeCourte(totalLibre)}</strong> de barbier sans client — le
        cr&eacute;neau le plus demand&eacute; &eacute;tant le {JOURS_LONGS[plein.day]} {plein.hour} h,
        &agrave; {plein.fill_rate} %.
      </p>

      {/* ---- Les courbes ---- */}
      <section className="cx-bloc cx-bloc--large" aria-labelledby="cx-courbes-titre">
        <h4 id="cx-courbes-titre" className="cx-bloc-titre">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M6 14c2-6 4 2 6-3s3 4 6-4" />
          </svg>
          Le remplissage, heure par heure
          <span className="cx-bloc-sous">
            {JOURS_LONGS[jourActif]} en avant &middot; les autres jours en fond
          </span>
        </h4>

        <Courbes
          heures={heures}
          jours={jours}
          grille={grille}
          parJour={parJour}
          jourActif={jourActif}
          onJour={setJourChoisi}
          isMobile={isMobile}
        />

        <p className="cx-note">
          Chaque point est la part du temps de travail de l&apos;&eacute;quipe vendue sur ce
          cr&eacute;neau — pas un nombre de rendez-vous. Sous <strong>{SEUIL_CREUX} %</strong> (la
          bande basse), la place existe d&eacute;j&agrave; et il manque les clients. Au-dessus de{' '}
          <strong>{SEUIL_SATURE} %</strong>, le cr&eacute;neau n&apos;absorbe plus personne : c&apos;est
          l&agrave; qu&apos;il faut ouvrir des heures.
        </p>
      </section>

      {/* ---- Les heures a remplir ---- */}
      {aRemplir.length === 0 ? (
        <p className="cx-complet">
          Aucun trou marquant sur cette p&eacute;riode : tous vos cr&eacute;neaux ouverts sont remplis
          &agrave; plus de la moiti&eacute;. Pour prendre plus de monde, il faut ouvrir des heures, pas
          en remplir.
        </p>
      ) : (
        <section className="cx-bloc" aria-labelledby="cx-remplir-titre">
          <h4 id="cx-remplir-titre" className="cx-bloc-titre">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
            </svg>
            Les heures &agrave; remplir
          </h4>
          <ul className="cx-remplir-liste">
            {aRemplir.map((c) => (
              <li key={`${c.day}-${c.hour}`} className="cx-remplir-item">
                <button
                  className="cx-remplir-quand"
                  style={{ '--teinte': couleurJour(c.day) }}
                  onClick={() => setJourChoisi(c.day)}
                  title={`Voir la courbe du ${JOURS_LONGS[c.day]}`}
                >
                  <i aria-hidden="true" />
                  {JOURS_COURTS[c.day]} {c.hour} h
                </button>
                <span className="cx-remplir-jauge">
                  <Jauge taux={c.fill_rate} couleur={couleurJour(c.day)} />
                </span>
                <span className="cx-remplir-taux">{c.fill_rate} %</span>
                <span className="cx-remplir-detail">
                  {dureeCourte(c.libre)} libre{c.libre >= 120 ? 's' : ''} &middot; la place pour{' '}
                  {c.places} client{c.places > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="cx-note">
            Class&eacute; par temps de barbier inoccup&eacute;, pas par pourcentage : une heure &agrave;
            moiti&eacute; vide o&ugrave; toute l&apos;&eacute;quipe travaille laisse passer plus de monde
            qu&apos;une heure vide o&ugrave; il n&apos;y a qu&apos;un barbier. Une place ={' '}
            {dureeCourte(dureeRdv)}, la dur&eacute;e moyenne d&apos;un rendez-vous ici.
          </p>
        </section>
      )}

      {/* ---- Les jours, du plus plein au plus vide ---- */}
      <section className="cx-bloc" aria-labelledby="cx-jours-titre">
        <h4 id="cx-jours-titre" className="cx-bloc-titre">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          Les jours, du plus plein au plus vide
        </h4>
        <ul className="cx-classement">
          {classement.map((j) => (
            <li key={j.day}>
              <button
                className={`cx-rang${j.day === jourActif ? ' is-actif' : ''}`}
                style={{ '--teinte': couleurJour(j.day) }}
                onClick={() => setJourChoisi(j.day)}
                aria-pressed={j.day === jourActif}
              >
                <span className="cx-rang-nom">
                  <i aria-hidden="true" />
                  {JOURS_LONGS[j.day]}
                </span>
                <span className="cx-rang-barre" aria-hidden="true">
                  <span style={{ width: `${Math.max(j.taux, 2)}%` }} />
                </span>
                <span className="cx-rang-taux">{j.taux} %</span>
                <span className="cx-rang-libre">
                  {dureeCourte(j.libre)} libre{j.libre >= 120 ? 's' : ''}
                  {j.libre === maxLibre && classement.length > 1 && (
                    <em> &mdash; le plus gros gisement</em>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- Le tableau chiffre ----
          Un vrai <table> : c'est l'alternative accessible aux courbes, et la
          seule vue ou l'on peut comparer deux cases precises. */}
      <section className="cx-bloc cx-bloc--large">
        <button
          className="cx-tableau-bascule"
          onClick={() => setTableauOuvert((v) => !v)}
          aria-expanded={tableauOuvert}
        >
          <svg
            viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
            aria-hidden="true" style={{ transform: tableauOuvert ? 'rotate(90deg)' : 'none' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Tous les chiffres
          <span className="cx-tableau-sous">
            {jours.length} jours &times; {heures.length} heures, en pourcentage
          </span>
        </button>

        {tableauOuvert && (
          <>
            <div className="cx-tableau-defile">
              <table className="cx-tableau">
                <caption className="sr-only">
                  Part du temps de travail vendue, par jour et par heure, en pourcentage
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Jour</th>
                    {heures.map((h) => (
                      <th key={h} scope="col">{h} h</th>
                    ))}
                    <th scope="col" className="cx-tableau-total">Moy.</th>
                  </tr>
                </thead>
                <tbody>
                  {jours.map((d) => {
                    const j = parJour.find((p) => p.day === d);
                    return (
                      <tr key={d} className={d === jourActif ? 'is-actif' : ''}>
                        <th scope="row" style={{ '--teinte': couleurJour(d) }}>
                          <i aria-hidden="true" />
                          {JOURS_COURTS[d]}
                        </th>
                        {heures.map((h) => {
                          const c = grille[d]?.[h];
                          if (!c) {
                            return (
                              <td key={h} className="cx-case cx-case--ferme">
                                <span className="sr-only">ferm&eacute;</span>
                              </td>
                            );
                          }
                          const p = palier(c.fill_rate);
                          const info = avecLibre.find((a) => a.day === d && a.hour === h);
                          return (
                            <td
                              key={h}
                              className={`cx-case${c === plein ? ' is-plein' : ''}`}
                              style={{ background: p.bg, color: p.ink }}
                              title={`${JOURS_LONGS[d]} ${h} h — ${c.fill_rate} % : ${dureeCourte(c.booked_minutes)} vendues sur ${dureeCourte(c.open_minutes)} ouvertes, ${c.bookings} RDV, ${dureeCourte(info?.libre ?? 0)} de libre`}
                            >
                              {c.fill_rate}
                            </td>
                          );
                        })}
                        <td className="cx-case cx-case--total">{j.taux}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="cx-echelle">
              <span>Temps vendu</span>
              {[...PALIERS].reverse().map((p, i) => (
                <span key={i} className="cx-echelle-case" style={{ background: p.bg }} />
              ))}
              <span>0 &rarr; 100 %</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
