import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  useWaitlist, useWaitlistCount, useAddToWaitlist, useUpdateWaitlistEntry, useDeleteWaitlistEntry,
  useNotifyWaitlistSms, useBarbers, useServices,
} from '../hooks/useApi';
import CreateBookingModal from '../components/planning/CreateBookingModal';
import { formatPhoneWithFlag } from '../utils/phone';
import { getClients } from '../api';

// ---- Icons ----
const IconPlus = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconPhone = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
const IconTrash = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
const IconClipboard = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48, color: 'var(--text-muted)', marginBottom: 12 }}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
const IconBooking = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>;

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildSmsPreview(entry) {
  const dateStr = new Date(entry.preferred_date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const firstName = (entry.client_name || '').split(/\s+/)[0];
  return `BarberClub - Bonne nouvelle ${firstName} ! Un creneau s'est libere le ${dateStr} avec ${entry.barber_name} pour ${entry.service_name}. Reservez vite au salon ou appelez-nous.`;
}

export default function Waitlist() {
  const [addModal, setAddModal] = useState(false);
  const [filter, setFilter] = useState('waiting');
  const [bookingEntry, setBookingEntry] = useState(null);
  const [smsPreview, setSmsPreview] = useState(null); // entry to preview SMS for
  const [toast, setToast] = useState(null);
  const [jourFiltre, setJourFiltre] = useState(null);

  const waitlistQuery = useWaitlist(filter === 'all' ? {} : { status: 'waiting' });
  const entries = useMemo(() => waitlistQuery.data || [], [waitlistQuery.data]);
  const waitlistCountQuery = useWaitlistCount();
  const barbersQuery = useBarbers();
  const servicesQuery = useServices();

  const waitlistCount = waitlistCountQuery.data?.count ?? 0;
  const barbers = (barbersQuery.data || []).filter(b => b.is_active);
  const services = servicesQuery.data || [];

  const deleteMutation = useDeleteWaitlistEntry();
  const updateMutation = useUpdateWaitlistEntry();
  const notifySms = useNotifyWaitlistSms();

  const toastTimer = useRef(null);
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  async function handleDelete(id) {
    if (!confirm('Retirer de la liste d\'attente ?')) return;
    try {
      await deleteMutation.mutateAsync(id);
      showToast('Retiré de la liste');
    } catch (err) { showToast(err.message, 'error'); }
  }

  function handleNotify(entry) {
    setSmsPreview(entry);
  }

  async function confirmSendSms() {
    if (!smsPreview) return;
    try {
      await notifySms.mutateAsync(smsPreview.id);
      showToast(`SMS envoyé à ${smsPreview.client_name}`);
    } catch (err) { showToast(err.message, 'error'); }
    setSmsPreview(null);
  }

  function handleBooked(entry) {
    setBookingEntry(entry);
  }

  async function handleBookingCreated() {
    if (bookingEntry) {
      try {
        await updateMutation.mutateAsync({ id: bookingEntry.id, data: { status: 'booked' } });
      } catch {}
    }
    setBookingEntry(null);
  }

  const statusLabel = { waiting: 'En attente', notified: 'Prévenu', booked: 'Réservé', expired: 'Expiré' };

  // ── Regroupement par personne ──
  // La table stocke un souhait par date : la même personne y figure autant de
  // fois qu'elle a coché de jours. Affichée telle quelle, la liste comptait
  // 17 « clients en attente » pour 7 personnes réelles, dont une répétée
  // quatre fois d'affilée.
  const personnes = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      const cle = e.client_id || e.client_phone || e.id;
      if (!m.has(cle)) {
        m.set(cle, { cle, nom: e.client_name, tel: e.client_phone, souhaits: [] });
      }
      m.get(cle).souhaits.push(e);
    }
    return [...m.values()]
      .map((p) => {
        p.souhaits.sort((a, b) => (a.preferred_date || '').localeCompare(b.preferred_date || ''));
        p.depuis = p.souhaits.reduce((min, e) => (!min || e.created_at < min ? e.created_at : min), null);
        p.enAttente = p.souhaits.filter((e) => e.status === 'waiting').length;
        return p;
      })
      // Le plus ancien inscrit en premier : c'est le seul ordre défendable
      // quand on doit choisir qui appeler.
      .sort((a, b) => (a.depuis || '').localeCompare(b.depuis || ''));
  }, [entries]);

  // ── Demande par jour ──
  // Le vrai déclencheur de cette page : un créneau se libère jeudi, qui le veut ?
  const jours = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      if (e.status !== 'waiting' || !e.preferred_date) continue;
      m.set(e.preferred_date, (m.get(e.preferred_date) || 0) + 1);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const visibles = useMemo(() => (
    jourFiltre
      ? personnes.filter((p) => p.souhaits.some((e) => e.preferred_date === jourFiltre))
      : personnes
  ), [personnes, jourFiltre]);

  const nbSouhaits = entries.filter((e) => e.status === 'waiting').length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Liste d'attente</h2>
          <p className="wl-sub">
            {/* Le compteur d'avant additionnait les souhaits et les appelait
                des clients. Les deux nombres sont utiles, pas confondus. */}
            <strong>{personnes.filter((p) => p.enAttente > 0).length}</strong> personne
            {personnes.filter((p) => p.enAttente > 0).length !== 1 ? 's' : ''}
            {' · '}{nbSouhaits} créneau{nbSouhaits !== 1 ? 'x' : ''} souhaité{nbSouhaits !== 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAddModal(true)}>
          <IconPlus /> Ajouter
        </button>
      </div>

      <div className="page-body">
        {/* ── Un créneau se libère ? ── */}
        {jours.length > 0 && (
          <section className="wl-days" aria-label="Demande par jour">
            <span className="wl-days-label">Un créneau se libère&nbsp;?</span>
            <div className="wl-days-scroll">
              {jours.map(([d, n]) => (
                <button
                  key={d}
                  type="button"
                  className={`wl-day ${jourFiltre === d ? 'on' : ''}`}
                  onClick={() => setJourFiltre(jourFiltre === d ? null : d)}
                  aria-pressed={jourFiltre === d}
                >
                  <span className="wl-day-date">{formatDate(d)}</span>
                  <span className="wl-day-n">{n}</span>
                </button>
              ))}
            </div>
            {jourFiltre && (
              <button type="button" className="wl-day-clear" onClick={() => setJourFiltre(null)}>
                Tout voir
              </button>
            )}
          </section>
        )}

        {/* ── Filtres de statut ── */}
        <div className="wl-tabs" role="group" aria-label="Filtrer par statut">
          {[
            { key: 'waiting', label: 'En attente' },
            { key: 'all', label: 'Tous' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`wl-tab ${filter === f.key ? 'on' : ''}`}
              aria-pressed={filter === f.key}
            >
              {f.label}
              {f.key === 'waiting' && waitlistCount > 0 && <span>{waitlistCount}</span>}
            </button>
          ))}
        </div>

        {waitlistQuery.isLoading ? (
          <div className="empty-state">Chargement...</div>
        ) : visibles.length === 0 ? (
          <div className="empty-state">
            <IconClipboard />
            {jourFiltre
              ? <>Personne n’attend pour le {formatDate(jourFiltre)}.</>
              : filter === 'waiting'
                ? <>Personne n’attend de créneau.</>
                : <>Aucune demande enregistrée.</>}
          </div>
        ) : (
          <ul className="wl-list">
            {visibles.map((p) => (
              <PersonneCard
                key={p.cle}
                personne={p}
                jourFiltre={jourFiltre}
                statusLabel={statusLabel}
                onNotify={handleNotify}
                onBook={handleBooked}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </div>
      {addModal && (
        <AddWaitlistModal
          barbers={barbers}
          services={services}
          onClose={() => setAddModal(false)}
        />
      )}

      {bookingEntry && (
        <CreateBookingModal
          barbers={barbers}
          services={services}
          onClose={() => setBookingEntry(null)}
          onCreated={handleBookingCreated}
          initialDate={bookingEntry.preferred_date}
          initialTime={bookingEntry.preferred_time_start?.slice(0, 5) || '09:00'}
          initialBarberId={bookingEntry.barber_id}
          initialServiceId={bookingEntry.service_id}
          initialFirstName={bookingEntry.client_name?.split(/\s+/)[0] || ''}
          initialLastName={bookingEntry.client_name?.split(/\s+/).slice(1).join(' ') || ''}
          initialPhone={bookingEntry.client_phone}
        />
      )}

      {/* SMS Preview Modal */}
      {smsPreview && (
        <div className="modal-backdrop" onClick={() => setSmsPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3 className="modal-title">Aperçu SMS</h3>
              <button className="btn-ghost" onClick={() => setSmsPreview(null)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Destinataire : <strong style={{ color: 'var(--text)' }}>{smsPreview.client_name}</strong> — {smsPreview.client_phone}
              </div>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12,
                padding: 16, fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)',
                fontFamily: 'monospace', whiteSpace: 'pre-wrap',
              }}>
                {buildSmsPreview(smsPreview)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'right' }}>
                {buildSmsPreview(smsPreview).length} caractères — {buildSmsPreview(smsPreview).length <= 160 ? '1 SMS' : '2 SMS'}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setSmsPreview(null)}>Annuler</button>
              <button
                className="btn btn-sm"
                style={{ background: '#3b82f6', color: '#fff', border: 'none' }}
                onClick={confirmSendSms}
                disabled={notifySms.isPending}
              >
                {notifySms.isPending ? 'Envoi...' : 'Envoyer le SMS'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>{toast.message}</div>
        </div>
      )}
    </>
  );
}

/**
 * Une carte par personne, ses jours souhaités en pastilles.
 *
 * Chaque pastille est le bouton d'envoi du SMS pour CE jour-là : c'est la
 * seule façon d'avoir un bouton « Prévenir » qui sache de quelle date il
 * parle quand la personne en a coché quatre.
 */
function PersonneCard({ personne, jourFiltre, statusLabel, onNotify, onBook, onDelete }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const clic = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener('mousedown', clic);
    return () => document.removeEventListener('mousedown', clic);
  }, [menu]);

  const jours = Math.max(0, Math.round((Date.now() - new Date(personne.depuis).getTime()) / 86400000));
  const ref = personne.souhaits.find((e) => e.preferred_date === jourFiltre) || personne.souhaits[0];
  const service = ref?.service_name;
  const barbier = ref?.barber_name;

  return (
    <li className="wl-card">
      <div className="wl-card-main">
        <div className="wl-id">
          <span className="wl-name">{personne.nom || 'Sans nom'}</span>
          <a className="wl-phone" href={`tel:${personne.tel}`}>{formatPhoneWithFlag(personne.tel)}</a>
        </div>

        <div className="wl-meta">
          {service && <span className="wl-service">{service}</span>}
          {barbier && <span className="wl-barber">{barbier}</span>}
          <span className="wl-since">
            {jours === 0 ? "inscrit aujourd'hui" : `attend depuis ${jours} j`}
          </span>
        </div>
      </div>

      <ul className="wl-chips">
        {personne.souhaits.map((e) => {
          const creneau = e.preferred_time_start
            ? `${e.preferred_time_start.slice(0, 5)}–${e.preferred_time_end?.slice(0, 5) || '?'}`
            : null;
          // Relancer quelqu'un déjà prévenu qui n'a pas répondu est un besoin
          // réel, et l'ancienne page le permettait (le bouton SMS était sur
          // chaque ligne). Seul un créneau déjà réservé n'a plus rien à dire.
          const actif = e.status !== 'booked';
          return (
            <li key={e.id}>
              <button
                type="button"
                className={`wl-chip ${e.status} ${e.preferred_date === jourFiltre ? 'cible' : ''}`}
                onClick={() => actif && onNotify(e)}
                disabled={!actif}
                title={!actif
                  ? 'Rendez-vous déjà pris'
                  : e.status === 'waiting'
                    ? `Prévenir par SMS pour le ${formatDate(e.preferred_date)}`
                    : `Relancer par SMS pour le ${formatDate(e.preferred_date)}`}
              >
                <span className="wl-chip-date">{formatDate(e.preferred_date)}</span>
                {/* L'ancienne liste écrivait « Toute la journée » sur chaque
                    ligne. C'est le défaut : on ne l'affiche que s'il y a
                    vraiment une plage. */}
                {creneau && <span className="wl-chip-slot">{creneau}</span>}
                {e.status !== 'waiting' && <span className="wl-chip-state">{statusLabel[e.status]}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="wl-actions">
        <a className="wl-act" href={`tel:${personne.tel}`} title="Appeler"><IconPhone /></a>
        <button type="button" className="wl-act" onClick={() => onBook(ref)} title="Créer le rendez-vous">
          <IconBooking />
        </button>
        <div className="wl-menu-wrap" ref={menuRef}>
          <button type="button" className="wl-act" onClick={() => setMenu((v) => !v)} aria-label="Plus d'actions" aria-expanded={menu}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
          </button>
          {menu && (
            <div className="wl-menu">
              {personne.souhaits.map((e) => (
                <button key={e.id} type="button" onClick={() => { setMenu(false); onDelete(e.id); }}>
                  <IconTrash /> Retirer {formatDate(e.preferred_date)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function AddWaitlistModal({ barbers, services, onClose }) {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [barberId, setBarberId] = useState(barbers[0]?.id || '');
  const [serviceId, setServiceId] = useState(services[0]?.id || '');
  const [date, setDate] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [error, setError] = useState('');
  const mutation = useAddToWaitlist();
  const saving = mutation.isPending;

  // Autocomplétion : recherche dans la base clients en tapant le nom (debounce 300ms)
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const skipSearch = useRef(false);
  const searchTimer = useRef();

  useEffect(() => {
    if (skipSearch.current) { skipSearch.current = false; return; }
    const term = clientName.trim();
    if (term.length < 2) { setSuggestions([]); setShowSuggest(false); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await getClients({ search: term, limit: 5 });
        setSuggestions(data.clients || []);
        setShowSuggest(true);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [clientName]);

  const pickClient = (c) => {
    skipSearch.current = true;
    setClientName(`${c.first_name || ''} ${c.last_name || ''}`.trim());
    if (c.phone) setClientPhone(c.phone);
    setShowSuggest(false);
    setSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await mutation.mutateAsync({
        client_name: clientName,
        client_phone: clientPhone,
        barber_id: barberId,
        service_id: serviceId,
        preferred_date: date,
        preferred_time_start: timeStart || undefined,
        preferred_time_end: timeEnd || undefined,
      });
      onClose();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3 className="modal-title">Ajouter en liste d'attente</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="input-row">
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="label">Nom du client</label>
                <input
                  className="input"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  autoComplete="off"
                  placeholder="Rechercher ou saisir..."
                  required
                />
                {showSuggest && suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxHeight: 240, overflowY: 'auto' }}>
                    {suggestions.map((c) => (
                      <div
                        key={c.id}
                        onMouseDown={(e) => { e.preventDefault(); pickClient(c); }}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.first_name} {c.last_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="label">Téléphone</label>
                <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} required placeholder="06..." />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Barber souhaité</label>
                <select className="input" value={barberId} onChange={(e) => setBarberId(e.target.value)} required>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Prestation</label>
                <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Date souhaitée</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Créneau début (optionnel)</label>
                <input className="input" type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} min="09:00" max="19:00" />
              </div>
              <div className="form-group">
                <label className="label">Créneau fin (optionnel)</label>
                <input className="input" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} min="09:00" max="19:00" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
