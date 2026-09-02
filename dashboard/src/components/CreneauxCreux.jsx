import { useState, useMemo } from 'react';
import useMobile from '../hooks/useMobile';

// ============================================
// Creneaux — ou reste-t-il de la place ?
//
// L'ancienne vue etait une grille de sept jours sur douze heures : quatre-vingt
// -quatre cases de chiffres qu'il fallait faire defiler lateralement sur un
// telephone. On y lisait le mois, pas la decision.
//
// La question posee a cette page est pourtant simple, et c'est une question de
// gerant : ou puis-je encore mettre des clients ? Elle repond donc dans cet
// ordre — les heures les plus vides d'abord, en clair et chiffrees en places
// disponibles ; puis une journee a la fois, lisible sans rien faire defiler ;
// la grille complete en dernier, pour qui veut la vue d'ensemble.
// ============================================

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// Une seule teinte, du clair au fonce : c'est la regle des echelles de
// grandeur. Un arc-en-ciel ferait croire a des categories.
const PALIERS = [
  { min: 80, bg: 'rgba(245,158,11,0.92)', ink: '#1a1206', label: '80 % et plus' },
  { min: 60, bg: 'rgba(245,158,11,0.62)', ink: '#1a1206', label: '60 – 79 %' },
  { min: 40, bg: 'rgba(245,158,11,0.36)', ink: 'var(--text)', label: '40 – 59 %' },
  { min: 20, bg: 'rgba(245,158,11,0.18)', ink: 'var(--text-secondary)', label: '20 – 39 %' },
  { min: 0, bg: 'rgba(var(--overlay),0.05)', ink: 'var(--text-muted)', label: 'moins de 20 %' },
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

function Jauge({ taux, hauteur = 8 }) {
  return (
    <div
      style={{
        height: hauteur, borderRadius: hauteur / 2, overflow: 'hidden',
        background: 'rgba(var(--overlay),0.07)', flex: 1, minWidth: 40,
      }}
    >
      <div
        className="cx-jauge-barre"
        style={{
          width: `${Math.min(taux, 100)}%`, height: '100%', borderRadius: hauteur / 2,
          background: palier(taux).bg,
        }}
      />
    </div>
  );
}

export default function CreneauxCreux({ data, monthLabel }) {
  const isMobile = useMobile();
  const cellules = useMemo(() => (data?.fill || []).filter((c) => c.open_minutes > 0), [data]);

  // Aujourd'hui : c'est le jour que l'on veut voir en arrivant.
  const aujourdhui = (new Date().getDay() + 6) % 7;
  const [jourActif, setJourActif] = useState(aujourdhui);
  const [grilleOuverte, setGrilleOuverte] = useState(!isMobile);

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

    const parJour = jours.map((d) => ({
      day: d,
      taux: moyenne(cellules.filter((c) => c.day === d)),
      libre: cellules.filter((c) => c.day === d).reduce((a, c) => a + (c.open_minutes - c.booked_minutes), 0),
    }));

    // La duree moyenne d'un rendez-vous, mesuree sur le mois : elle sert a
    // traduire un trou en nombre de clients, ce qui parle bien plus qu'un
    // pourcentage.
    const totalRdv = cellules.reduce((a, c) => a + c.bookings, 0);
    const totalVendu = cellules.reduce((a, c) => a + c.booked_minutes, 0);
    const dureeRdv = totalRdv > 0 ? Math.round(totalVendu / totalRdv) : 30;

    const avecLibre = cellules.map((c) => ({
      ...c,
      libre: c.open_minutes - c.booked_minutes,
      places: Math.floor((c.open_minutes - c.booked_minutes) / dureeRdv),
    }));

    // Les heures a remplir : on classe par temps de barbier inoccupe, pas par
    // pourcentage. Une heure a 10 % ou un seul barbier travaille represente
    // moins d'occasions manquees qu'une heure a 45 % ou ils sont quatre.
    //
    // Deux creneaux par jour au maximum : sinon une seule journee creuse
    // occupe toute la liste et on ne voit plus le reste de la semaine.
    const parJourVus = {};
    const aRemplir = avecLibre
      .filter((c) => c.fill_rate < 55 && c.places >= 1)
      .sort((a, b) => b.libre - a.libre)
      .filter((c) => {
        parJourVus[c.day] = (parJourVus[c.day] || 0) + 1;
        return parJourVus[c.day] <= 2;
      })
      .slice(0, isMobile ? 3 : 4);

    const plein = [...cellules].sort((a, b) => b.fill_rate - a.fill_rate)[0];
    const global = moyenne(cellules);
    const totalLibre = avecLibre.reduce((a, c) => a + c.libre, 0);

    return { heures, jours, grille, parJour, plein, global, dureeRdv, aRemplir, avecLibre, totalLibre };
  }, [cellules, isMobile]);

  if (!calcul) {
    return <div className="empty-state">Pas encore assez de rendez-vous sur cette p&eacute;riode</div>;
  }

  const { heures, jours, grille, parJour, plein, global, dureeRdv, aRemplir, avecLibre, totalLibre } = calcul;

  // Si le salon est ferme le jour choisi, on bascule sur le premier jour ouvert.
  const jourVu = jours.includes(jourActif) ? jourActif : jours[0];
  const heuresDuJour = avecLibre.filter((c) => c.day === jourVu).sort((a, b) => a.hour - b.hour);
  const infosJour = parJour.find((j) => j.day === jourVu);

  return (
    <div className="cx">
      {/* ---- Ce qu'il faut retenir, en une phrase ---- */}
      <p className="cx-resume">
        Sur {monthLabel}, l&apos;&eacute;quipe a vendu <strong>{global} %</strong> de son temps de
        travail. Il reste <strong>{dureeCourte(totalLibre)}</strong> de barbier sans client — le
        plus demand&eacute; &eacute;tant le {JOURS_LONGS[plein.day]} {plein.hour} h, &agrave;{' '}
        {plein.fill_rate} %.
      </p>

      {/* ---- Les heures a remplir ---- */}
      {aRemplir.length === 0 && (
        <p className="cx-complet">
          Aucun trou marquant ce mois-ci : tous vos cr&eacute;neaux ouverts sont remplis &agrave; plus de
          la moiti&eacute;. Pour prendre plus de monde, il faut ouvrir des heures, pas en remplir.
        </p>
      )}
      {aRemplir.length > 0 && (
        <section className="cx-bloc cx-bloc--remplir" aria-labelledby="cx-remplir-titre">
          <h4 id="cx-remplir-titre" className="cx-bloc-titre">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
            </svg>
            Les heures &agrave; remplir
          </h4>
          <ul className="cx-remplir-liste">
            {aRemplir.map((c) => (
              <li key={`${c.day}-${c.hour}`} className="cx-remplir-item">
                <span className="cx-remplir-quand">
                  {JOURS_COURTS[c.day]} {c.hour} h
                </span>
                <span className="cx-remplir-jauge">
                  <Jauge taux={c.fill_rate} />
                </span>
                <span className="cx-remplir-taux">{c.fill_rate} %</span>
                <span className="cx-remplir-detail">
                  {dureeCourte(c.libre)} libre{c.libre >= 120 ? 's' : ''} · la place pour {c.places} client
                  {c.places > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="cx-note">
            Class&eacute; par temps de barbier inoccup&eacute;, pas par pourcentage : une heure &agrave;
            moiti&eacute; vide o&ugrave; toute l&apos;&eacute;quipe travaille laisse passer plus de monde qu&apos;une
            heure vide o&ugrave; il n&apos;y a qu&apos;un barbier. Une place = {dureeCourte(dureeRdv)}, la dur&eacute;e
            moyenne d&apos;un rendez-vous ici.
          </p>
        </section>
      )}

      {/* ---- Une journee a la fois ---- */}
      <section className="cx-bloc" aria-labelledby="cx-jour-titre">
        <h4 id="cx-jour-titre" className="cx-bloc-titre">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          Heure par heure
        </h4>

        <div className="cx-jours" role="tablist" aria-label="Choisir un jour">
          {jours.map((d) => {
            const j = parJour.find((x) => x.day === d);
            const actif = d === jourVu;
            return (
              <button
                key={d}
                role="tab"
                aria-selected={actif}
                className={`cx-jour${actif ? ' is-actif' : ''}`}
                onClick={() => setJourActif(d)}
              >
                <span className="cx-jour-nom">{JOURS_COURTS[d]}</span>
                <span className="cx-jour-taux">{j.taux} %</span>
                <span className="cx-jour-barre" aria-hidden="true">
                  <span style={{ width: `${Math.max(j.taux, 3)}%`, background: palier(j.taux).bg }} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="cx-jour-entete">
          <span className="cx-jour-entete-nom">{JOURS_LONGS[jourVu]}</span>
          <span className="cx-jour-entete-detail">
            {infosJour.taux} % du temps vendu · {dureeCourte(infosJour.libre)} de libre
          </span>
        </div>

        <ul className="cx-heures">
          {heuresDuJour.map((c) => {
            const creux = c.fill_rate < 40;
            return (
              <li key={c.hour} className={`cx-heure${creux ? ' is-creux' : ''}`}>
                <span className="cx-heure-label">{c.hour} h</span>
                <span className="cx-heure-corps">
                  <span className="cx-heure-ligne">
                    <Jauge taux={c.fill_rate} hauteur={10} />
                    <span className="cx-heure-taux">{c.fill_rate} %</span>
                  </span>
                  <span className="cx-heure-detail">
                    {c.bookings} RDV
                    {creux && c.places >= 1 && (
                      <>
                        {' '}· <strong>{dureeCourte(c.libre)} libre</strong> · la place pour {c.places} client
                        {c.places > 1 ? 's' : ''}
                      </>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---- La grille complete, pour qui veut tout voir ---- */}
      <section className="cx-bloc">
        <button
          className="cx-grille-bascule"
          onClick={() => setGrilleOuverte((v) => !v)}
          aria-expanded={grilleOuverte}
        >
          <svg
            viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"
            aria-hidden="true" style={{ transform: grilleOuverte ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Vue d&apos;ensemble du mois
          <span className="cx-grille-sous">les {jours.length} jours d&apos;un coup d&apos;&oelig;il</span>
        </button>

        {grilleOuverte && (
          <>
            <div className="cx-grille-defile">
              <div
                className="cx-grille"
                style={{
                  gridTemplateColumns: isMobile
                    ? `34px repeat(${heures.length}, minmax(28px, 1fr))`
                    : `40px repeat(${heures.length}, minmax(34px, 1fr)) 46px`,
                }}
              >
                <div />
                {heures.map((h) => (
                  <div key={h} className="cx-grille-heure">{h} h</div>
                ))}
                {!isMobile && <div className="cx-grille-heure cx-grille-jourcol">Jour</div>}

                {jours.map((day) => {
                  const j = parJour.find((x) => x.day === day);
                  return (
                    <div key={day} style={{ display: 'contents' }}>
                      <div className="cx-grille-jour">{JOURS_COURTS[day]}</div>
                      {heures.map((h) => {
                        const c = grille[day]?.[h];
                        if (!c) {
                          return <div key={h} className="cx-case cx-case--ferme" title={`${JOURS_COURTS[day]} ${h} h — fermé`} />;
                        }
                        const p = palier(c.fill_rate);
                        const estLePlein = c.day === plein.day && c.hour === plein.hour;
                        return (
                          <div
                            key={h}
                            className={`cx-case${estLePlein ? ' is-plein' : ''}`}
                            title={`${JOURS_COURTS[day]} ${h} h — ${c.fill_rate} % du temps vendu : ${dureeCourte(c.booked_minutes)} vendues sur ${dureeCourte(c.open_minutes)} ouvertes, ${c.bookings} RDV`}
                            style={{ background: p.bg, color: p.ink }}
                          >
                            {c.fill_rate}
                          </div>
                        );
                      })}
                      {!isMobile && (
                        <div className="cx-case cx-case--total" style={{ color: j.taux >= 80 ? '#fbbf24' : 'var(--text-secondary)' }}>
                          {j.taux}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* L'echelle est fixe : la meme couleur veut dire la meme chose partout. */}
            <div className="cx-echelle">
              <span>Temps vendu</span>
              {[...PALIERS].reverse().map((p, i) => (
                <span key={i} className="cx-echelle-case" title={p.label} style={{ background: p.bg }} />
              ))}
              <span>0 &rarr; 100 %</span>
            </div>
          </>
        )}
      </section>

      <p className="cx-note cx-note--bas">
        Chaque chiffre est la part du temps de travail de l&apos;&eacute;quipe qui a &eacute;t&eacute; vendue sur ce
        cr&eacute;neau — pas le nombre de rendez-vous. Au-dessus de 90 %, un cr&eacute;neau ne peut plus
        absorber personne : c&apos;est l&agrave; qu&apos;il faut ouvrir des heures. En dessous de 40 %, la place
        existe d&eacute;j&agrave; ; il manque les clients.
      </p>
    </div>
  );
}
