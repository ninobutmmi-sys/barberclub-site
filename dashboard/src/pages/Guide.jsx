import { useState } from 'react';
import { useAuth } from '../auth';

// ============================================
// Le guide — ce que tout le monde doit savoir
//
// On recrute. Un nouveau barbier apprend le metier de la maison en regardant
// les autres, mais deux gestes ne se voient pas : la note client et la vente
// d'un produit se font dans le dashboard, et personne ne les devine.
//
// Cette page reunit les regles du salon et ces gestes-la. Les captures d'ecran
// vieillissent des qu'on touche a l'interface : les schemas ci-dessous sont
// donc dessines en HTML, avec les vraies couleurs et les vrais libelles. Quand
// le bouton change, le schema change avec lui.
// ============================================

const SOMMAIRE = [
  { id: 'prestation', label: 'La prestation' },
  { id: 'note', label: 'La note client' },
  { id: 'produit', label: 'La vente' },
  { id: 'fin', label: 'Fin du RDV' },
  { id: 'rdv', label: 'Prendre un RDV' },
];

function allerA(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Les etapes d'une prestation. Le numero porte une information — c'est un
// ordre reel, du bonjour a l'encaissement — donc il est affiche.
const ETAPES = [
  {
    titre: 'Accueillir',
    texte: 'Demandez si la personne a un rendez-vous, et proposez-lui à boire pendant qu’elle patiente.',
  },
  {
    titre: 'Préparer le poste',
    texte: 'Le fauteuil et le plan de travail sont propres avant que le client s’installe. Pas après.',
  },
  {
    titre: 'Diagnostic',
    texte: 'Client installé, regardez ses cheveux. Cire, gel, ou épis : direction le bac à shampooing avant de commencer.',
  },
  {
    titre: 'Désinfecter',
    texte: 'Spray alcool sur le matériel entre chaque client. Lame de rasoir neuve à chaque client, sans exception.',
  },
  {
    titre: 'Valider au miroir',
    texte: 'En fin de prestation, montrez la coupe au miroir et faites valider. Si le shampooing n’a pas été proposé au début, proposez-le maintenant.',
  },
  {
    titre: 'Proposer un produit',
    texte: 'Cire, poudre, crème : celui qui correspond à la coupe que vous venez de faire. C’est le bon moment, le client voit le résultat.',
  },
  {
    titre: 'Enregistrer la vente',
    texte: 'Un produit vendu s’enregistre dans le rendez-vous, tout de suite.',
    obligatoire: true,
    lien: 'produit',
  },
  {
    titre: 'Écrire la note client',
    texte: 'Une note par client, à chaque passage. C’est votre mémoire, et celle du collègue qui le prendra la prochaine fois.',
    obligatoire: true,
    lien: 'note',
  },
  {
    titre: 'Demander un avis',
    texte: 'À l’encaissement, demandez un avis Google. S’il en a déjà laissé un, remerciez-le.',
  },
];

// ---- Les pieces d'interface, redessinees ----

function Bulle({ children, titre = 'Alexandre Martin', sous = 'Mardi 14:30 · Coupe + barbe' }) {
  return (
    <div className="g-mock">
      <div className="g-mock-head">
        <span className="g-mock-avatar">A</span>
        <span>
          <span className="g-mock-nom">{titre}</span>
          <span className="g-mock-sous">{sous}</span>
        </span>
      </div>
      {children}
    </div>
  );
}

function Reperage({ n }) {
  return <span className="g-repere">{n}</span>;
}

export default function Guide() {
  const { salon } = useAuth();
  const [noteRemplie, setNoteRemplie] = useState(false);
  // Le schema produit suit la vraie sequence : bouton, puis liste, puis vente.
  const [etapeProduit, setEtapeProduit] = useState(0);

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Guide</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Les règles de la maison, et les deux gestes à ne jamais oublier
          </p>
        </div>
      </div>

      <div className="page-body">
        <div className="g">
          {/* ---- Ouverture ---- */}
          <section className="g-hero">
            <h3 className="g-hero-titre">Bienvenue chez BarberClub</h3>
            <p className="g-hero-texte">
              Tout ce qui suit tient en cinq minutes de lecture. Le métier, vous le connaissez —
              cette page dit comment on le fait <em>ici</em>, et ce que le dashboard attend de vous
              après chaque client.
            </p>
            <nav className="g-sommaire" aria-label="Sommaire">
              {SOMMAIRE.map((s) => (
                <button key={s.id} onClick={() => allerA(s.id)}>{s.label}</button>
              ))}
            </nav>
          </section>

          {/* ---- 1. La prestation ---- */}
          <section id="prestation" className="g-section">
            <h3 className="g-titre">
              <span className="g-titre-num">1</span>
              Le déroulé d’une prestation
            </h3>
            <p className="g-intro">
              Du bonjour à l’encaissement. Deux étapes sont marquées <strong>obligatoire</strong> :
              ce sont celles qui se passent dans le dashboard, et ce sont les seules que personne ne
              peut faire à votre place.
            </p>

            <ol className="g-etapes">
              {ETAPES.map((e, i) => (
                <li key={i} className={`g-etape${e.obligatoire ? ' is-obligatoire' : ''}`}>
                  <span className="g-etape-num">{i + 1}</span>
                  <div className="g-etape-corps">
                    <span className="g-etape-titre">
                      {e.titre}
                      {e.obligatoire && <span className="g-badge">Obligatoire</span>}
                    </span>
                    <p className="g-etape-texte">{e.texte}</p>
                    {e.lien && (
                      <button className="g-lien" onClick={() => allerA(e.lien)}>
                        Voir comment faire
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {salon === 'meylan' && (
              <p className="g-salon">
                <strong>À Meylan :</strong> le parfum en fin de prestation. C’est la signature de la
                maison, on ne l’oublie pas.
              </p>
            )}
          </section>

          {/* ---- 2. La note client ---- */}
          <section id="note" className="g-section">
            <h3 className="g-titre">
              <span className="g-titre-num">2</span>
              La note client
            </h3>
            <p className="g-intro">
              La note est attachée <strong>au client</strong>, pas au rendez-vous : elle réapparaît à
              chacune de ses visites, chez vous comme chez un collègue. Un client qui retrouve sa
              coupe exacte six mois plus tard revient.
            </p>

            <div className="g-demo">
              <div className="g-demo-visuel">
                <Bulle>
                  <div className="g-mock-bloc">
                    <span className="g-mock-label">
                      <Reperage n="1" /> Notes client
                    </span>
                    <div
                      className={`g-mock-zone${noteRemplie ? ' is-remplie' : ''}`}
                      onClick={() => setNoteRemplie((v) => !v)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setNoteRemplie((v) => !v); } }}
                      aria-label="Exemple de note : cliquez pour voir le résultat"
                    >
                      {noteRemplie
                        ? 'Épi à droite sur le front. Dégradé bas, sabot 2. Aime discuter moto — nouvelle Ducati en juin.'
                        : 'Ex: Sabot 3mm sur les cotés, fondu bas...'}
                    </div>
                    <div className={`g-mock-bouton${noteRemplie ? '' : ' is-cache'}`}>
                      <Reperage n="2" /> Enregistrer la note
                    </div>
                    {!noteRemplie && (
                      <span className="g-mock-astuce">Touchez la zone grise pour voir le résultat</span>
                    )}
                  </div>
                </Bulle>
              </div>

              <ol className="g-pas">
                <li>
                  <span className="g-pas-num">1</span>
                  <div>
                    <strong>Ouvrez le rendez-vous</strong> dans le planning et descendez jusqu’à
                    « Notes client ». Écrivez dans la zone de texte.
                  </div>
                </li>
                <li>
                  <span className="g-pas-num">2</span>
                  <div>
                    <strong>Le bouton bleu apparaît</strong> dès que vous tapez quelque chose. Tant
                    que vous ne l’avez pas touché, rien n’est enregistré — c’est l’erreur la plus
                    fréquente.
                  </div>
                </li>
              </ol>
            </div>

            <div className="g-quoi">
              <span className="g-quoi-titre">Ce qu’on écrit</span>
              <ul>
                <li>La technique : longueur, sabot, hauteur du dégradé, forme de la barbe.</li>
                <li>Les particularités : un épi, une cicatrice, un cheveu qui rebique.</li>
                <li>L’humain : ce dont il vous a parlé et qu’il sera content de reprendre.</li>
              </ul>
              <span className="g-quoi-titre g-quoi-titre--non">Ce qu’on n’écrit pas</span>
              <ul>
                <li>Un jugement sur le client. La note se lit à plusieurs, et elle reste.</li>
              </ul>
            </div>
          </section>

          {/* ---- 3. La vente d'un produit ---- */}
          <section id="produit" className="g-section">
            <h3 className="g-titre">
              <span className="g-titre-num">3</span>
              Enregistrer une vente de produit
            </h3>
            <p className="g-intro">
              Une vente s’enregistre <strong>depuis le rendez-vous du client</strong>, jamais
              ailleurs. Ce clic fait deux choses d’un coup : il sort le produit du stock et il
              ajoute le montant au chiffre du jour. Un produit vendu sans ce clic, c’est un stock
              faux et un chiffre faux.
            </p>

            <div className="g-demo">
              <div className="g-demo-visuel">
                <Bulle>
                  <div className="g-mock-bloc">
                    <div className="g-mock-entete">
                      <span className="g-mock-label"><Reperage n="1" /> Produits</span>
                      {etapeProduit === 2 && <span className="g-mock-total">+18,00 €</span>}
                    </div>

                    {etapeProduit === 2 && (
                      <div className="g-mock-vendu">
                        <span className="g-mock-vendu-nom">Cire mate — 1</span>
                        <span className="g-mock-vendu-prix">18,00 €</span>
                        <span className="g-mock-vendu-x">×</span>
                      </div>
                    )}

                    <div
                      className={`g-mock-ajout${etapeProduit === 1 ? ' is-ouvert' : ''}`}
                      onClick={() => setEtapeProduit(etapeProduit === 0 ? 1 : 0)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setEtapeProduit(etapeProduit === 0 ? 1 : 0); } }}
                    >
                      <Reperage n="2" />
                      {etapeProduit === 2 ? 'Ajouter un autre produit' : '+ Ajouter un produit'}
                    </div>

                    {etapeProduit === 1 && (
                      <div className="g-mock-liste">
                        <span className="g-mock-liste-titre">Rechercher…</span>
                        <button className="g-mock-liste-item is-cible" onClick={() => setEtapeProduit(2)}>
                          <Reperage n="3" /> Cire mate <em>18,00 €</em>
                        </button>
                        <span className="g-mock-liste-item">Poudre volumisante <em>16,00 €</em></span>
                        <span className="g-mock-liste-item">Shampooing barbe <em>14,00 €</em></span>
                      </div>
                    )}

                    <span className="g-mock-astuce">
                      {etapeProduit === 0 && 'Touchez « + Ajouter un produit » pour dérouler le schéma'}
                      {etapeProduit === 1 && 'Touchez « Cire mate » : la vente est enregistrée'}
                      {etapeProduit === 2 && (
                        <button className="g-mock-rejouer" onClick={() => setEtapeProduit(0)}>Revoir depuis le début</button>
                      )}
                    </span>
                  </div>
                </Bulle>
              </div>

              <ol className="g-pas">
                <li>
                  <span className="g-pas-num">1</span>
                  <div>
                    <strong>Ouvrez le rendez-vous</strong> du client à qui vous venez de vendre. Le
                    bloc « Produits » est juste sous le créneau.
                  </div>
                </li>
                <li>
                  <span className="g-pas-num">2</span>
                  <div>
                    <strong>« + Ajouter un produit »</strong> ouvre la liste. Tapez les premières
                    lettres pour la filtrer.
                  </div>
                </li>
                <li>
                  <span className="g-pas-num">3</span>
                  <div>
                    <strong>Touchez le produit</strong> : c’est enregistré immédiatement, il n’y a
                    rien d’autre à valider. La croix à droite de la ligne annule la vente et remet
                    le produit en stock.
                  </div>
                </li>
              </ol>
            </div>

            <p className="g-avert">
              Un produit qui n’est plus en stock n’apparaît pas dans la liste. S’il vous manque,
              c’est que le stock est à zéro dans le dashboard : signalez-le, ne vendez pas sans
              enregistrer.
            </p>
          </section>

          {/* ---- 4. La fin du rendez-vous ---- */}
          <section id="fin" className="g-section">
            <h3 className="g-titre">
              <span className="g-titre-num">4</span>
              À la fin : terminé, ou faux plan
            </h3>
            <p className="g-intro">
              Chaque rendez-vous se ferme. C’est ce geste qui fait votre chiffre de la journée, et
              c’est lui qui déclenche la demande d’avis Google, une heure après la coupe.
            </p>

            <div className="g-choix">
              <div className="g-choix-carte g-choix-carte--ok">
                <span className="g-choix-bouton g-choix-bouton--ok">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  Terminé
                </span>
                <p>
                  Le client est venu, la coupe est faite. À toucher en fin de prestation, pas en fin
                  de journée : c’est ce qui met le rendez-vous dans votre chiffre.
                </p>
              </div>
              <div className="g-choix-carte g-choix-carte--non">
                <span className="g-choix-bouton g-choix-bouton--non">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  Faux plan
                </span>
                <p>
                  Le client n’est pas venu et n’a pas prévenu. Le marquer permet de le repérer la
                  prochaine fois qu’il appelle — et le bouton <strong>SMS faux plan</strong> lui
                  écrit en un clic. S’il repasse payer, <strong>Faux plan payé</strong> remet le
                  rendez-vous au propre.
                </p>
              </div>
            </div>

            <p className="g-avert">
              <strong>On ne supprime pas un rendez-vous</strong> parce que le client n’est pas venu.
              Supprimer efface l’historique ; « faux plan » le garde. La suppression est réservée
              aux erreurs de saisie.
            </p>
          </section>

          {/* ---- 5. Prendre un rendez-vous ---- */}
          <section id="rdv" className="g-section">
            <h3 className="g-titre">
              <span className="g-titre-num">5</span>
              Prendre un rendez-vous
            </h3>

            <div className="g-deux">
              <div className="g-carte">
                <span className="g-carte-titre">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  Au téléphone
                </span>
                <p className="g-phrase">« BarberClub {salon === 'grenoble' ? 'Grenoble' : salon === 'voiron' ? 'Voiron' : 'Meylan'}, bonjour… »</p>
                <ol className="g-script">
                  <li>Est-il déjà venu ? — pour savoir s’il faut créer une fiche client.</li>
                  <li>Quelle prestation ?</li>
                  <li>Quel jour, quelle heure ?</li>
                  <li>Prénom, nom, numéro de téléphone.</li>
                </ol>
              </div>

              <div className="g-carte">
                <span className="g-carte-titre">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></svg>
                  Au salon
                </span>
                <p>
                  Si l’agenda est plein, <strong>cherchez quand même</strong>. Un client qui vous
                  voit fouiller le planning repart content, même sans créneau. « Non, on est
                  complet » le fait partir ailleurs.
                </p>
                <p>
                  Sans rien de libre : dites-lui de s’y prendre à l’avance par téléphone, ou de
                  regarder les créneaux disponibles sur le site. Et mettez-le sur la{' '}
                  <strong>liste d’attente</strong> — dès qu’une place se libère, on le prévient par
                  SMS.
                </p>
              </div>
            </div>
          </section>

          <p className="g-fin">
            Une question sur une règle, ou quelque chose qui manque ici&nbsp;? Dites-le, la page est
            faite pour évoluer.
          </p>
        </div>
      </div>
    </>
  );
}
