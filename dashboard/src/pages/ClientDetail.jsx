import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useMobile from '../hooks/useMobile';
import { useClient, useUpdateClient, useDeleteClient } from '../hooks/useApi';
import { getClientPhotos, uploadClientPhoto, deleteClientPhoto } from '../api';
import { getPhoneFlag } from '../utils/phone';
import { formatPrice } from '../utils/format';

/**
 * Fiche client.
 *
 * Ce que le barbier veut savoir avant que le client s'assoie : à quoi
 * ressemblait la dernière coupe, ce qu'il ne faut surtout pas faire, et s'il
 * est en retard sur son rythme. Le reste (état civil, historique) vient après.
 *
 * L'édition n'est plus un crayon par champ mais un seul mode : on bascule la
 * fiche entière en formulaire, on corrige ce qu'on veut, on enregistre une
 * fois. Quatre allers-retours réseau pour corriger un nom et un mail, c'était
 * quatre occasions d'échouer à moitié.
 */

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const Icon = {
  Back: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>,
  Pencil: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  Plus: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  Trash: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  Camera: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
};

/** Réduit une photo avant l'envoi : le back plafonne à ~200 Ko, un cliché de téléphone en fait 3 Mo. */
function reduireImage(file, maxPx = 900) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Lecture impossible'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible'));
      img.onload = () => {
        const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.78));
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(file);
  });
}

function joursDepuis(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000);
}

function dateCourte(iso, avecAnnee = false) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'short', ...(avecAnnee ? { year: 'numeric' } : {}),
  });
}

/**
 * Le client est-il en retard sur son propre rythme ?
 * On ne se prononce qu'à partir de 3 visites : sur deux passages, l'écart
 * n'est pas encore une habitude.
 */
function lireRythme(client) {
  const median = client.median_interval_days;
  if (!median || !client.last_visit) return null;
  const ecoule = joursDepuis(client.last_visit);
  const attendu = new Date(new Date(client.last_visit + 'T00:00:00').getTime() + median * 86400000);
  const attenduISO = attendu.toISOString().slice(0, 10);
  const retard = ecoule - median;
  return {
    median,
    ecoule,
    attenduISO,
    // Une marge de 30 % avant de parler de retard : personne ne revient au jour près.
    enRetard: retard > Math.max(7, median * 0.3),
    retard,
  };
}

export default function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMobile = useMobile();
  const { data: client, isLoading: loading, error, refetch } = useClient(id);
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();

  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [lightbox, setLightbox] = useState(null);

  const toastTimer = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    let annule = false;
    getClientPhotos(id).then((p) => { if (!annule) setPhotos(p || []); }).catch(() => {});
    return () => { annule = true; };
  }, [id]);

  const rythme = useMemo(() => (client ? lireRythme(client) : null), [client]);
  const panier = client && client.visit_count > 0
    ? Math.round(client.total_spent / client.visit_count) : 0;

  // Anniversaire dans les 30 jours : de quoi le souhaiter au fauteuil.
  const anniv = useMemo(() => {
    if (!client?.birth_date) return null;
    const n = new Date(client.birth_date + 'T00:00:00');
    const auj = new Date(); auj.setHours(0, 0, 0, 0);
    let prochain = new Date(auj.getFullYear(), n.getMonth(), n.getDate());
    if (prochain < auj) prochain = new Date(auj.getFullYear() + 1, n.getMonth(), n.getDate());
    const dans = Math.round((prochain - auj) / 86400000);
    const age = prochain.getFullYear() - n.getFullYear();
    return { dans, age, jour: n.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) };
  }, [client]);

  function ouvrirEdition() {
    setFormError('');
    setForm({
      first_name: client.first_name || '',
      last_name: client.last_name || '',
      phone: client.phone || '',
      email: client.email || '',
      birth_date: client.birth_date || '',
      preferences: client.preferences || '',
      notes: client.notes || '',
    });
    setEdit(true);
  }

  async function enregistrer(e) {
    e?.preventDefault();
    setFormError('');
    if (!form.first_name.trim()) { setFormError('Le prénom est obligatoire'); return; }

    // On n'envoie que ce qui a bougé : le back refuse un email vide mal formé
    // et normalise le téléphone, autant ne pas le solliciter pour rien.
    const patch = {};
    for (const k of ['first_name', 'last_name', 'phone', 'email', 'birth_date', 'preferences', 'notes']) {
      const avant = client[k] || '';
      const apres = (form[k] || '').trim();
      if (avant !== apres) patch[k] = apres;
    }
    if (Object.keys(patch).length === 0) { setEdit(false); return; }

    if (patch.phone && !window.confirm(
      `Changer le numéro de ${client.first_name} ?\n\n${client.phone || '—'}  →  ${patch.phone}\n\n` +
      'Les rappels SMS et le lien de gestion de RDV partiront sur ce nouveau numéro.'
    )) return;

    try {
      await updateMutation.mutateAsync({ id, data: patch });
      setEdit(false);
      showToast('Fiche enregistrée');
    } catch (err) {
      setFormError(err.message || 'Erreur');
    }
  }

  async function ajouterPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Format invalide (JPEG, PNG ou WebP)'); return;
    }
    setPhotoError(''); setPhotoBusy(true);
    try {
      await uploadClientPhoto(id, await reduireImage(file));
      setPhotos(await getClientPhotos(id));
      showToast('Photo ajoutée');
    } catch (err) {
      setPhotoError(err.message || 'Envoi impossible');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function retirerPhoto(photoId) {
    if (!window.confirm('Supprimer cette photo ?')) return;
    try {
      await deleteClientPhoto(id, photoId);
      setPhotos((p) => p.filter((x) => x.id !== photoId));
      setLightbox(null);
    } catch (err) {
      showToast(err.message || 'Suppression impossible', 'error');
    }
  }

  async function supprimerClient() {
    if (!window.confirm('Supprimer ce client (RGPD) ? Cette action est irréversible.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      navigate('/clients');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (loading) return <div className="page-body"><div className="empty-state">Chargement...</div></div>;
  if (!client) {
    return (
      <div className="page-body">
        <div className="empty-state">
          {error ? (typeof error === 'string' ? error : error.message) : 'Client introuvable'}
          {error && <button className="btn btn-secondary btn-sm" onClick={() => refetch()} style={{ marginTop: 12 }}>Réessayer</button>}
        </div>
      </div>
    );
  }

  const derniere = photos[0];
  const initiales = `${(client.first_name || '?')[0]}${(client.last_name || '')[0] || ''}`.toUpperCase();

  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="cd-back" onClick={() => navigate('/clients')} aria-label="Retour aux clients"><Icon.Back /></button>
          <div style={{ minWidth: 0 }}>
            <h2 className="page-title cd-name">{client.first_name} {client.last_name}</h2>
            <div className="cd-tags">
              {client.visit_count >= 10 && <span className="cd-tag vip">Fidèle · {client.visit_count} visites</span>}
              {client.has_account && <span className="cd-tag">Compte en ligne</span>}
              {anniv && anniv.dans <= 30 && (
                <span className="cd-tag anniv">
                  {anniv.dans === 0 ? "C’est son anniversaire" : `Anniversaire dans ${anniv.dans} j`}
                </span>
              )}
              {rythme?.enRetard && <span className="cd-tag late">En retard de {rythme.retard} j</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {!edit && (
            <button className="btn btn-secondary btn-sm" onClick={ouvrirEdition} style={{ gap: 6 }}>
              <span style={{ width: 14, height: 14, display: 'inline-flex' }}><Icon.Pencil /></span>
              {isMobile ? '' : 'Modifier'}
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={supprimerClient} title="Supprimer (RGPD)">
            {isMobile ? <span style={{ width: 16, height: 16, display: 'inline-flex' }}><Icon.Trash /></span> : 'Supprimer (RGPD)'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* ── Bandeau : la dernière coupe, et où on en est ── */}
        <section className="cd-hero">
          <button
            type="button"
            className={`cd-hero-photo ${derniere ? 'has' : ''}`}
            onClick={() => derniere && setLightbox(derniere)}
            aria-label={derniere ? 'Agrandir la dernière coupe' : 'Aucune photo'}
            disabled={!derniere}
          >
            {derniere
              ? <img src={derniere.photo_data} alt={`Dernière coupe de ${client.first_name}`} />
              : <span className="cd-hero-initials">{initiales}</span>}
          </button>

          <div className="cd-hero-info">
            <div className="cd-hero-block">
              <span className="cd-hero-label">Prochain rendez-vous</span>
              {client.next_booking ? (
                <>
                  <strong className="cd-hero-value">
                    {new Date(client.next_booking.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    {' à '}{client.next_booking.start_time.slice(0, 5)}
                  </strong>
                  <span className="cd-hero-sub">{client.next_booking.service_name} · {client.next_booking.barber_name}</span>
                </>
              ) : (
                <strong className="cd-hero-value muted">Aucun rendez-vous prévu</strong>
              )}
            </div>

            <div className="cd-hero-block">
              <span className="cd-hero-label">Rythme</span>
              {rythme ? (
                <>
                  <strong className={`cd-hero-value ${rythme.enRetard ? 'late' : ''}`}>
                    Revient tous les {rythme.median} jours
                  </strong>
                  <span className="cd-hero-sub">
                    {rythme.enRetard
                      ? `Attendu vers le ${dateCourte(rythme.attenduISO)} · ${rythme.retard} j de retard`
                      : `Dernière visite il y a ${rythme.ecoule} j · prochain passage vers le ${dateCourte(rythme.attenduISO)}`}
                  </span>
                </>
              ) : (
                <>
                  <strong className="cd-hero-value muted">Pas encore d’habitude</strong>
                  <span className="cd-hero-sub">
                    {client.visit_count > 0
                      ? `${client.visit_count} visite${client.visit_count > 1 ? 's' : ''} — il en faut 3 pour dégager un rythme`
                      : 'Aucune visite terminée'}
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── Chiffres ── */}
        <div className="cd-stats">
          <Stat label="Visites" value={client.visit_count} />
          <Stat label="Total dépensé" value={formatPrice(client.total_spent)} />
          <Stat label="Panier moyen" value={panier ? formatPrice(panier) : '—'} />
          <Stat label="Faux plans" value={client.no_show_count} alert={client.no_show_count > 0} />
          <Stat label="Annulations" value={client.cancelled_count} />
          <Stat label="Client depuis" value={client.first_visit ? dateCourte(client.first_visit, true) : '—'} small />
        </div>

        <div className="cd-cols">
          {/* ────────── Colonne gauche ────────── */}
          <div className="cd-col">
            {/* Coupes */}
            <section className="cd-card">
              <header className="cd-card-head">
                <h3>Coupes</h3>
                <label className="cd-photo-add" htmlFor="cd-photo">
                  <span style={{ width: 13, height: 13, display: 'inline-flex' }}><Icon.Plus /></span>
                  {photoBusy ? 'Envoi...' : 'Ajouter'}
                </label>
                <input id="cd-photo" type="file" accept="image/jpeg,image/png,image/webp"
                  onChange={ajouterPhoto} disabled={photoBusy} className="sr-only" />
              </header>
              {photoError && <p className="cd-err" role="alert">{photoError}</p>}
              {photos.length === 0 ? (
                <label htmlFor="cd-photo" className="cd-photo-empty">
                  <span style={{ width: 26, height: 26, display: 'inline-flex' }}><Icon.Camera /></span>
                  Photographier la coupe pour la retrouver la prochaine fois
                </label>
              ) : (
                <ul className="cd-gallery">
                  {photos.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setLightbox(p)} aria-label={`Photo du ${dateCourte(p.created_at?.slice(0, 10), true) || ''}`}>
                        <img src={p.photo_data} alt="" loading="lazy" />
                        <span className="cd-gallery-date">{dateCourte(p.created_at?.slice(0, 10))}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Préférences */}
            <section className="cd-card">
              <header className="cd-card-head">
                <h3>À savoir avant de couper</h3>
              </header>
              {edit ? (
                <textarea
                  className="input cd-textarea"
                  value={form.preferences}
                  onChange={(e) => setForm({ ...form, preferences: e.target.value })}
                  maxLength={1000}
                  rows={3}
                  placeholder="Ex : dégradé bas, jamais de tondeuse sur le dessus. Allergique au parfum."
                />
              ) : client.preferences ? (
                <p className="cd-prefs">{client.preferences}</p>
              ) : (
                <p className="cd-empty">Rien de noté. Ses habitudes de coupe, ce qu’il refuse, une allergie.</p>
              )}
            </section>

            {/* Notes internes */}
            <section className="cd-card">
              <header className="cd-card-head">
                <h3>Notes internes</h3>
                <span className="cd-card-hint">jamais visible du client</span>
              </header>
              {edit ? (
                <textarea
                  className="input cd-textarea"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  maxLength={2000}
                  rows={3}
                  placeholder="Retards répétés, litige, remarque à transmettre à l’équipe..."
                />
              ) : client.notes ? (
                <p className="cd-prefs">{client.notes}</p>
              ) : (
                <p className="cd-empty">Aucune note.</p>
              )}
            </section>
          </div>

          {/* ────────── Colonne droite ────────── */}
          <div className="cd-col">
            <section className="cd-card">
              <header className="cd-card-head"><h3>Fiche</h3></header>

              {edit ? (
                <form onSubmit={enregistrer} className="cd-form">
                  {formError && <p className="cd-err" role="alert">{formError}</p>}
                  <Champ label="Prénom" required>
                    <input className="input" value={form.first_name} autoFocus
                      onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
                  </Champ>
                  <Champ label="Nom">
                    <input className="input" value={form.last_name}
                      onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
                  </Champ>
                  <Champ label="Téléphone">
                    <input className="input" type="tel" value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </Champ>
                  <Champ label="Email">
                    <input className="input" type="email" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </Champ>
                  <Champ label="Date de naissance">
                    <input className="input" type="date" value={form.birth_date}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
                  </Champ>
                  <div className="cd-form-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdit(false)}>Annuler</button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="cd-facts">
                  <Fait label="Téléphone" value={client.phone
                    ? <a href={`tel:${client.phone}`}>{getPhoneFlag(client.phone)} {client.phone}</a> : null} />
                  <Fait label="Email" value={client.email
                    ? <a href={`mailto:${client.email}`}>{client.email}</a> : null} />
                  <Fait label="Naissance" value={anniv
                    ? `${anniv.jour} · ${anniv.age} ans à son prochain` : null} />
                  <Fait label="Habitude" value={client.usual_slot
                    ? `${JOURS[client.usual_slot.weekday - 1]} vers ${client.usual_slot.hour}h · ${client.usual_slot.count} fois`
                    : null} />
                  <Fait label="Prestation" value={client.favourite_service} />
                  <Fait label="Barbier" value={client.favourite_barber} />
                </dl>
              )}
            </section>

            {client.products?.length > 0 && (
              <section className="cd-card">
                <header className="cd-card-head"><h3>Produits achetés</h3></header>
                <ul className="cd-products">
                  {client.products.map((p) => (
                    <li key={p.name}>
                      <span className="cd-prod-qty">{p.quantity}</span>
                      <span className="cd-prod-name">{p.name}</span>
                      <span className="cd-prod-total">{formatPrice(p.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        {/* ── Historique ── */}
        <section className="cd-card cd-history">
          <header className="cd-card-head">
            <h3>Historique des rendez-vous</h3>
            <span className="cd-card-hint">{client.bookings?.length || 0} affichés</span>
          </header>
          {!client.bookings?.length ? (
            <p className="cd-empty">Aucun rendez-vous.</p>
          ) : (
            <ul className="cd-rdvs">
              {client.bookings.map((b) => (
                <li key={b.id} className={`cd-rdv ${b.status}`}>
                  <span className="cd-rdv-date">
                    {new Date(b.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="cd-rdv-time">{b.start_time.slice(0, 5)}</span>
                  <span className="cd-rdv-service">{b.service_name}</span>
                  <span className="cd-rdv-barber">{b.barber_name}</span>
                  <span className="cd-rdv-price">{formatPrice(b.price)}</span>
                  <span className={`cd-rdv-status ${b.status}`}>{STATUTS[b.status] || b.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {lightbox && (
        <div className="cd-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true" aria-label="Photo agrandie">
          <img src={lightbox.photo_data} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="cd-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span>{dateCourte(lightbox.created_at?.slice(0, 10), true)}</span>
            <button type="button" onClick={() => retirerPhoto(lightbox.id)}>Supprimer</button>
            <button type="button" onClick={() => setLightbox(null)}>Fermer</button>
          </div>
        </div>
      )}

      {toast && <div className={`tk-toast ${toast.type === 'error' ? 'err' : ''}`} role="status">{toast.message}</div>}
    </>
  );
}

const STATUTS = {
  completed: 'Honoré',
  confirmed: 'À venir',
  no_show: 'Faux plan',
  cancelled: 'Annulé',
};

function Stat({ label, value, alert, small }) {
  return (
    <div className={`cd-stat ${alert ? 'alert' : ''}`}>
      <span className="cd-stat-label">{label}</span>
      <span className={`cd-stat-value ${small ? 'sm' : ''}`}>{value}</span>
    </div>
  );
}

function Fait({ label, value }) {
  return (
    <div className="cd-fact">
      <dt>{label}</dt>
      <dd className={value ? '' : 'muted'}>{value || '—'}</dd>
    </div>
  );
}

function Champ({ label, required, children }) {
  return (
    <label className="cd-champ">
      <span>{label}{required && <em> *</em>}</span>
      {children}
    </label>
  );
}
