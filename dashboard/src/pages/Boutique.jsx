import { useState, useMemo } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useProducts,
  useProductStats,
  useBarbers,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useStockMovement,
  useStockMovements,
  useGiftCards,
  useCreateGiftCard,
  useUpdateGiftCard,
} from '../hooks/useApi';
import { formatPrice } from '../utils/format';

// ============================================
// Helpers
// ============================================

function formatPriceCompact(cents) {
  const val = cents / 100;
  return val % 1 === 0
    ? val.toLocaleString('fr-FR') + ' \u20AC'
    : val.toFixed(2).replace('.', ',') + ' \u20AC';
}

const ACCENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899',
  '#14b8a6', '#22c55e', '#6366f1', '#0ea5e9',
];

function getCategoryColor(category) {
  if (!category) return '#64748b';
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length];
}

const SUGGESTED_CATEGORIES = ['Cires', 'Coiffage', 'Barbe', 'Parfum', 'Accessoires'];
const PAYMENT_METHODS = [
  { value: 'cb', label: 'CB' },
  { value: 'cash', label: 'Especes' },
  { value: 'lydia', label: 'Lydia' },
  { value: 'other', label: 'Autre' },
];

// Motifs de retrait de stock (sans impact CA — la vente passe par le RDV)
const STOCK_REASONS = [
  { value: 'restock', label: 'Réception commande' },
  { value: 'internal_use', label: 'Usage interne' },
  { value: 'loss', label: 'Perte / casse' },
  { value: 'inventory', label: 'Correction inventaire' },
];

const STOCK_REASON_LABELS = Object.fromEntries(STOCK_REASONS.map(r => [r.value, r.label]));

const KPI_ACCENTS = {
  blue:  { color: '#3b82f6' },
  green: { color: '#22c55e' },
  amber: { color: '#f59e0b' },
  red:   { color: '#ef4444' },
};

// ============================================
// Main Component
// ============================================

// ============================================
// Lecture du stock — c'est ici que se décide ce qui est urgent
// ============================================

/** Couvre-t-on encore combien de jours ? Sans historique de vente, on ne sait pas. */
function stockInsight(p) {
  const stock = p.stock_quantity || 0;
  const seuil = p.alert_threshold || 5;
  const vendu90 = p.sold_90d || 0;
  const parJour = vendu90 / 90;
  const jours = parJour > 0 ? Math.round(stock / parJour) : null;

  // Le seuil est à 5 pour tout le monde : il ne distingue pas une cire qui part
  // en une semaine d'une qui dort un an. Quand on connaît la vitesse, c'est
  // elle qui décide ; le seuil ne sert que de filet aux produits jamais vendus.
  let niveau;
  if (stock === 0) niveau = 'out';
  else if (jours !== null) niveau = jours < 30 ? 'low' : jours > 365 ? 'over' : 'ok';
  else niveau = stock <= seuil ? 'low' : 'ok';

  // De quoi tenir 90 jours, arrondi au-dessus.
  const aCommander = parJour > 0
    ? Math.max(1, Math.ceil(parJour * 90) - stock)
    : Math.max(1, seuil * 2 - stock);

  return { stock, seuil, jours, niveau, aCommander, parJour };
}

// Les teintes viennent du thème : les hex vifs deviennent illisibles sur le
// fond clair (2,15:1 pour l'ambre, il en faut 4,5).
const NIVEAUX = {
  out:  { label: 'Rupture', color: 'var(--ink-danger)' },
  low:  { label: 'À commander', color: 'var(--ink-warn)' },
  ok:   { label: 'OK', color: 'var(--ink-good)' },
  over: { label: 'Surstock', color: 'var(--ink-mute)' },
};

function joursLabel(jours) {
  if (jours === null) return 'jamais vendu';
  if (jours === 0) return 'épuisé';
  if (jours < 60) return `≈ ${jours} j de stock`;
  if (jours < 730) return `≈ ${Math.round(jours / 30)} mois de stock`;
  return '≈ 2 ans et +';
}

// ============================================
// Main Component
// ============================================

export default function Boutique() {
  const isMobile = useMobile();
  const { data: products = [], isLoading, error, refetch } = useProducts();
  const { data: stats } = useProductStats();
  const { data: allBarbers = [] } = useBarbers();
  const barbers = useMemo(() => allBarbers.filter(b => b.is_active), [allBarbers]);
  const [search, setSearch] = useState('');
  const [filtre, setFiltre] = useState('all');       // all | order | over
  const [productModal, setProductModal] = useState(null);
  const [stockModal, setStockModal] = useState(null); // { product, sens }
  const [giftCardModal, setGiftCardModal] = useState(false);
  const [copie, setCopie] = useState(null);   // null | 'ok' | 'ko'

  const actifs = useMemo(() => products.filter(p => p.is_active), [products]);

  const insights = useMemo(() => {
    const m = new Map();
    actifs.forEach(p => m.set(p.id, stockInsight(p)));
    return m;
  }, [actifs]);

  const aCommander = useMemo(() => (
    actifs
      .filter(p => ['out', 'low'].includes(insights.get(p.id).niveau))
      // Le plus urgent d'abord : rupture, puis le moins de jours restants.
      .sort((a, b) => {
        const ia = insights.get(a.id), ib = insights.get(b.id);
        return (ia.jours ?? 9999) - (ib.jours ?? 9999);
      })
  ), [actifs, insights]);

  const coutCommande = useMemo(() => aCommander.reduce(
    (s, p) => s + (p.buy_price || 0) * insights.get(p.id).aCommander, 0
  ), [aCommander, insights]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = actifs.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.category || '').toLowerCase().includes(q)) return false;
      const n = insights.get(p.id).niveau;
      if (filtre === 'order') return n === 'out' || n === 'low';
      if (filtre === 'over') return n === 'over';
      return true;
    });
    const groups = {};
    filtered.forEach(p => {
      const cat = p.category || 'Autre';
      (groups[cat] ||= []).push(p);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Autre') return 1;
      if (b === 'Autre') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [actifs, search, filtre, insights]);

  const stockValue = useMemo(
    () => actifs.reduce((sum, p) => sum + (p.sell_price || 0) * (p.stock_quantity || 0), 0),
    [actifs]
  );
  const nbSurstock = useMemo(
    () => actifs.filter(p => insights.get(p.id).niveau === 'over').length,
    [actifs, insights]
  );

  // La tâche récurrente dit « passer commande sur barbercorner » : le presse-papier
  // évite de recopier la liste à la main dans un mail ou un SMS.
  async function copierCommande() {
    const lignes = aCommander.map(p => `${insights.get(p.id).aCommander} x ${p.name}`);
    try {
      await navigator.clipboard.writeText(`Commande BarberClub\n\n${lignes.join('\n')}`);
      setCopie('ok');
    } catch {
      // Safari refuse le presse-papier hors geste direct, et le refus était muet.
      setCopie('ko');
    }
    setTimeout(() => setCopie(null), 2800);
  }

  const nbResultats = grouped.reduce((s, [, items]) => s + items.length, 0);

  return (
    <>
      {error && (
        <div className="st-error" role="alert">
          <span>{typeof error === 'string' ? error : error.message}</span>
          <button onClick={() => refetch()}>Réessayer</button>
        </div>
      )}

      <div className="page-header">
        <h2 className="page-title">Stock</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setGiftCardModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
            </svg>
            {isMobile ? 'Cartes' : 'Cartes cadeaux'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setProductModal('create')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Produit
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* ---- Ce qu'il faut commander : la seule chose qui demande une action ---- */}
        {!isLoading && aCommander.length > 0 && (
          <section className="st-order" aria-label="Produits à commander">
            <header className="st-order-head">
              <h3>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                À commander
                <span className="st-order-n">{aCommander.length}</span>
              </h3>
              <button type="button" className={`st-copy ${copie === 'ko' ? 'ko' : ''}`} onClick={copierCommande}>
                {copie === 'ok' ? (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> Copié</>
                ) : copie === 'ko' ? (
                  <>Copie refusée</>
                ) : (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg> Copier la liste</>
                )}
              </button>
            </header>

            <ul className="st-order-list">
              {aCommander.map(p => {
                const i = insights.get(p.id);
                return (
                  <li key={p.id}>
                    <span className={`st-pip ${i.niveau}`} aria-hidden="true" />
                    <span className="st-order-name">{p.name}</span>
                    <span className="st-order-state">
                      {i.niveau === 'out' ? 'en rupture' : joursLabel(i.jours)}
                    </span>
                    <span className="st-order-qty">{i.aCommander}</span>
                    <button
                      type="button"
                      className="st-order-in"
                      onClick={() => setStockModal({ product: p, sens: 'in', suggestion: i.aCommander })}
                    >
                      Réceptionner
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="st-order-total">
              {coutCommande > 0
                ? <>Coût d’achat estimé <strong>{formatPriceCompact(coutCommande)}</strong> · </>
                : <>Renseignez le prix d’achat des produits pour estimer le coût · </>}
              <span>quantités calculées pour tenir 90 jours</span>
            </p>
          </section>
        )}

        {/* ---- KPI ---- */}
        <div className="a-kpi-grid" style={{ marginBottom: 24 }}>
          <KpiCard
            label="Valeur du stock" value={formatPriceCompact(stockValue)} accent="blue"
            subtitle={`${actifs.length} produits`}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>}
          />
          <KpiCard
            label="À commander" value={aCommander.length}
            accent={aCommander.length > 0 ? 'red' : 'green'}
            subtitle={aCommander.length === 0 ? 'Rien à commander'
              : coutCommande > 0 ? formatPriceCompact(coutCommande)
              : 'coût inconnu, prix d’achat vides'}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
          />
          <KpiCard
            label="CA produits (mois)" value={formatPriceCompact(stats?.revenue_month || 0)} accent="green"
            subtitle={`${stats?.sales_month || 0} ventes`}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>}
          />
          <KpiCard
            label="Ventes aujourd'hui" value={stats?.sales_today || 0} accent="amber"
            subtitle={formatPriceCompact(stats?.revenue_today || 0)}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>}
          />
        </div>

        {/* ---- Recherche + filtres ---- */}
        <div className="st-tools">
          <div className="st-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <label className="sr-only" htmlFor="st-q">Rechercher un produit</label>
            <input id="st-q" className="input" placeholder="Rechercher un produit..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="st-chips" role="group" aria-label="Filtrer">
            {[
              { k: 'all', l: 'Tout', n: actifs.length },
              { k: 'order', l: 'À commander', n: aCommander.length },
              { k: 'over', l: 'Surstock', n: nbSurstock },
            ].map(c => (
              <button
                key={c.k} type="button"
                className={`st-chip ${filtre === c.k ? 'on' : ''}`}
                onClick={() => setFiltre(c.k)}
                aria-pressed={filtre === c.k}
              >
                {c.l}<span>{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ---- Produits par catégorie ---- */}
        {isLoading ? (
          <div className="empty-state">Chargement...</div>
        ) : nbResultats === 0 ? (
          <div className="empty-state">
            {search ? 'Aucun produit trouvé'
              : filtre === 'order' ? 'Rien à commander, tout est approvisionné'
              : filtre === 'over' ? 'Aucun surstock'
              : 'Aucun produit — ajoutez votre premier produit'}
          </div>
        ) : (
          grouped.map(([category, items]) => {
            const catColor = getCategoryColor(category);
            return (
              <div key={category} className="st-cat">
                <div className="st-cat-head">
                  <span className="st-cat-dot" style={{ background: catColor, boxShadow: `0 0 8px ${catColor}55` }} aria-hidden="true" />
                  <h3>{category}</h3>
                  <span className="st-cat-n">{items.length}</span>
                </div>
                <div className="st-grid">
                  {items.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      insight={insights.get(product.id)}
                      categoryColor={catColor}
                      onEdit={() => setProductModal(product)}
                      onMove={(sens, suggestion) => setStockModal({ product, sens, suggestion })}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {stockModal && (
        <StockMovementModal
          product={stockModal.product}
          sens={stockModal.sens}
          suggestion={stockModal.suggestion}
          barbers={barbers}
          onClose={() => setStockModal(null)}
        />
      )}
      {productModal && (
        <ProductModal product={productModal === 'create' ? null : productModal} onClose={() => setProductModal(null)} />
      )}
      {giftCardModal && (
        <GiftCardsModal barbers={barbers} onClose={() => setGiftCardModal(false)} />
      )}
    </>
  );
}

// ============================================
// KPI Card (reuses .a-kpi from index.css)
// ============================================

function KpiCard({ label, value, subtitle, accent = 'blue', icon }) {
  const a = KPI_ACCENTS[accent] || KPI_ACCENTS.blue;
  return (
    <div className="a-kpi">
      <div className="a-kpi-top">
        <span className="a-kpi-label">{label}</span>
        <span className="a-kpi-icon" style={{ color: a.color }}>{icon}</span>
      </div>
      <div className="a-kpi-value" style={{ color: a.color }}>{value}</div>
      {subtitle && <div className="a-kpi-sub">{subtitle}</div>}
    </div>
  );
}

// ============================================
// Product card
// ============================================

function ProductCard({ product, insight, categoryColor, onEdit, onMove }) {
  const n = NIVEAUX[insight.niveau];
  const marge = product.buy_price > 0
    ? Math.round(((product.sell_price - product.buy_price) / product.sell_price) * 100)
    : null;

  return (
    <article className={`st-card ${insight.niveau}`} style={{ '--cat': categoryColor }}>
      <div className="st-card-top">
        <div className="st-card-id">
          <h4 className="st-card-name" title={product.name}>{product.name}</h4>
          {product.sku && <span className="st-card-sku">{product.sku}</span>}
        </div>
        <button type="button" className="st-icon-btn" onClick={onEdit} aria-label={`Modifier ${product.name}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      <div className="st-card-stock">
        <span className="st-qty">{insight.stock}</span>
        <span className="st-qty-unit">en stock</span>
        {/* Un badge sur chaque carte ne signale plus rien : seul ce qui sort de
            l'ordinaire en porte un. Le nom accompagne toujours la couleur. */}
        {insight.niveau !== 'ok' && (
          <span className="st-badge" style={{ '--lvl': n.color }}>{n.label}</span>
        )}
      </div>

      <p className="st-card-days">
        {product.sellable === false ? 'consommable, non vendu' : joursLabel(insight.jours)}
      </p>

      <div className="st-card-price">
        {product.sellable === false ? (
          <span className="st-internal">Usage interne</span>
        ) : product.sell_price > 0 ? (
          <>
            <span className="st-price">{formatPriceCompact(product.sell_price)}</span>
            {marge !== null && <span className="st-margin">+{marge}%</span>}
          </>
        ) : (
          <button type="button" className="st-noprice" onClick={onEdit}>Prix à définir</button>
        )}
      </div>

      <div className="st-card-actions">
        <button
          type="button" className="st-act in"
          onClick={() => onMove('in', insight.niveau === 'ok' || insight.niveau === 'over' ? 1 : insight.aCommander)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Entrée
        </button>
        <button
          type="button" className="st-act out"
          onClick={() => onMove('out', 1)}
          disabled={insight.stock <= 0}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Sortie
        </button>
      </div>
    </article>
  );
}

// ============================================
// Mouvement de stock — entrée ou sortie, sans impact CA
// (la vente réelle aux clients passe par le modal du RDV)
// ============================================

const MOTIFS = {
  in: [
    { value: 'restock', label: 'Réception commande' },
    { value: 'inventory', label: 'Correction inventaire' },
  ],
  out: [
    { value: 'internal_use', label: 'Usage interne' },
    { value: 'loss', label: 'Perte / casse' },
    { value: 'inventory', label: 'Correction inventaire' },
  ],
};

function StockMovementModal({ product, sens, suggestion, barbers, onClose }) {
  const mouvement = useStockMovement();
  const { data: movements = [], isLoading: loadingMovements } = useStockMovements(product.id);
  const entree = sens === 'in';
  const [qty, setQty] = useState(Math.max(1, suggestion || 1));
  const [reason, setReason] = useState(MOTIFS[sens][0].value);
  const [barberId, setBarberId] = useState(barbers[0]?.id || '');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const apres = entree ? product.stock_quantity + qty : product.stock_quantity - qty;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!entree && qty > product.stock_quantity) { setError('Stock insuffisant'); return; }
    try {
      await mouvement.mutateAsync({
        id: product.id,
        data: {
          quantity: qty,
          reason,
          direction: sens,
          performed_by: barberId || undefined,
          note: note.trim() || undefined,
        },
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 className="modal-title">
            {entree ? 'Entrée de stock' : 'Sortie de stock'} : {product.name}
          </h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Fermer">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            <p className="st-hint">
              {entree
                ? 'Une entrée ajoute au stock sans rien changer au chiffre d’affaires.'
                : 'Une sortie retire du stock sans compter dans le CA. Pour une vente à un client, ajoutez le produit depuis le rendez-vous.'}
            </p>

            {/* Compteur — gros boutons, utilisable au comptoir sans clavier */}
            <div className="form-group">
              <label className="label" htmlFor="st-qty">Quantité</label>
              <div className="st-stepper">
                <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Diminuer">−</button>
                <input
                  id="st-qty" type="number" inputMode="numeric" min="1" value={qty}
                  onChange={e => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
                <button type="button" onClick={() => setQty(q => q + 1)} aria-label="Augmenter">+</button>
              </div>
              <p className="st-after">
                {product.stock_quantity} <span aria-hidden="true">→</span> <strong>{apres}</strong>
                <span className="sr-only">après le mouvement</span>
                {apres < 0 && <em> stock insuffisant</em>}
              </p>
            </div>

            <div className="form-group">
              <label className="label">Motif</label>
              <div className="st-reasons">
                {MOTIFS[sens].map(r => (
                  <button
                    key={r.value} type="button"
                    className={`st-reason ${reason === r.value ? 'on' : ''}`}
                    onClick={() => setReason(r.value)}
                    aria-pressed={reason === r.value}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="label" htmlFor="st-by">Par</label>
              <select id="st-by" className="input" value={barberId} onChange={e => setBarberId(e.target.value)}>
                <option value="">—</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label" htmlFor="st-note">Note (facultatif)</label>
              <input id="st-note" className="input" value={note} onChange={e => setNote(e.target.value)}
                placeholder={entree ? 'Ex : livraison BarberCorner' : 'Ex : flacon cassé'} maxLength={500} />
            </div>

            {/* Historique : voir ce qui a déjà été fait évite le double comptage */}
            <div className="st-history">
              <h4>Derniers mouvements</h4>
              {loadingMovements ? (
                <p className="st-history-empty">Chargement...</p>
              ) : movements.length === 0 ? (
                <p className="st-history-empty">Aucun mouvement enregistré.</p>
              ) : (
                <ul>
                  {movements.slice(0, 5).map(m => (
                    <li key={m.id}>
                      <span className={`st-mv ${m.direction === 'in' ? 'in' : 'out'}`}>
                        {m.direction === 'in' ? '+' : '−'}{m.quantity}
                      </span>
                      <span className="st-mv-reason">{STOCK_REASON_LABELS[m.reason] || m.reason}</span>
                      <span className="st-mv-date">
                        {new Date(m.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        {m.performed_by_name ? ` · ${m.performed_by_name}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={mouvement.isPending || (!entree && qty > product.stock_quantity)}
            >
              {mouvement.isPending ? 'Enregistrement...' : entree ? `Ajouter ${qty}` : `Retirer ${qty}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Product Modal (Create / Edit)
// ============================================

function ProductModal({ product, onClose }) {
  const isEdit = !!product;
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const initialCategory = product?.category
    ? (SUGGESTED_CATEGORIES.includes(product.category) ? product.category : '__custom')
    : '';
  const initialCustom = product?.category && !SUGGESTED_CATEGORIES.includes(product.category)
    ? product.category
    : '';

  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [category, setCategory] = useState(initialCategory);
  const [customCategory, setCustomCategory] = useState(initialCustom);
  const [buyPrice, setBuyPrice] = useState(product?.buy_price ? (product.buy_price / 100).toFixed(2) : '');
  const [sellPrice, setSellPrice] = useState(product?.sell_price ? (product.sell_price / 100).toFixed(2) : '');
  const [stockQty, setStockQty] = useState(product?.stock_quantity ?? 0);
  const [alertThreshold, setAlertThreshold] = useState(product?.alert_threshold ?? 5);
  const [sku, setSku] = useState(product?.sku || '');
  const [sellable, setSellable] = useState(product?.sellable ?? true);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [error, setError] = useState('');
  const saving = createMutation.isPending || updateMutation.isPending;

  const showCustom = category === '__custom';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const finalCategory = category === '__custom' ? customCategory : category;

    const body = {
      name,
      description: description || undefined,
      category: finalCategory || undefined,
      buy_price: buyPrice ? Math.round(parseFloat(buyPrice) * 100) : 0,
      sell_price: Math.round(parseFloat(sellPrice) * 100),
      stock_quantity: parseInt(stockQty),
      alert_threshold: parseInt(alertThreshold),
      sku: sku || undefined,
      sellable,
      is_active: isActive,
    };

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: product.id, data: body });
      } else {
        await createMutation.mutateAsync(body);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Desactiver ce produit ?')) return;
    try {
      await deleteMutation.mutateAsync(product.id);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{isEdit ? 'Modifier le produit' : 'Nouveau produit'}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group">
              <label className="label">Nom du produit</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} required
                placeholder="Ex: Cire Totem Gold" />
            </div>

            <div className="form-group">
              <label className="label">Description (optionnel)</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Ex: Fixation forte, fini brillant" />
            </div>

            <div className="form-group">
              <label className="label">A vendre aux clients ?</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className={`toggle ${sellable ? 'active' : ''}`}
                  onClick={() => setSellable(!sellable)}
                />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {sellable ? 'Oui — proposable a la vente sur un RDV' : 'Non — stock interne uniquement'}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Categorie</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: showCustom ? 8 : 0 }}>
                {SUGGESTED_CATEGORIES.map(c => (
                  <button
                    key={c} type="button"
                    className={`btn btn-sm ${category === c ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setCategory(c); setCustomCategory(''); }}
                  >{c}</button>
                ))}
                <button
                  type="button"
                  className={`btn btn-sm ${showCustom ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCategory('__custom')}
                >Autre...</button>
              </div>
              {showCustom && (
                <input className="input" value={customCategory} onChange={e => setCustomCategory(e.target.value)}
                  placeholder="Nom de la categorie" />
              )}
            </div>

            <div className="input-row">
              <div className="form-group">
                <label className="label">Prix d'achat (euros)</label>
                <input className="input" type="number" step="0.01" min="0" value={buyPrice}
                  onChange={e => setBuyPrice(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group">
                <label className="label">Prix de vente (euros)</label>
                <input className="input" type="number" step="0.01" min="0" value={sellPrice}
                  onChange={e => setSellPrice(e.target.value)} required placeholder="0.00" />
              </div>
            </div>

            <div className="input-row">
              <div className="form-group">
                <label className="label">Stock actuel</label>
                <input className="input" type="number" min="0" value={stockQty}
                  onChange={e => setStockQty(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Seuil d'alerte</label>
                <input className="input" type="number" min="0" value={alertThreshold}
                  onChange={e => setAlertThreshold(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Reference / SKU (optionnel)</label>
              <input className="input" value={sku} onChange={e => setSku(e.target.value)}
                placeholder="Ex: CIR-TOTEM-GOLD" />
            </div>

            {isEdit && (
              <div className="form-group">
                <label className="label">Statut</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    className={`toggle ${isActive ? 'active' : ''}`}
                    onClick={() => setIsActive(!isActive)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {isActive ? 'Actif' : 'Inactif'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ justifyContent: isEdit ? 'space-between' : 'flex-end' }}>
            {isEdit && (
              <button type="button" className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)' }}
                onClick={handleDelete}
              >
                Desactiver
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Creer'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================
// Gift Cards Modal
// ============================================

function GiftCardsModal({ barbers, onClose }) {
  const { data: giftCards = [], isLoading } = useGiftCards();
  const createMutation = useCreateGiftCard();
  const updateMutation = useUpdateGiftCard();
  const [showCreate, setShowCreate] = useState(false);
  const [amount, setAmount] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [method, setMethod] = useState('cb');
  const [soldBy, setSoldBy] = useState(barbers[0]?.id || '');
  const [error, setError] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await createMutation.mutateAsync({
        initial_amount: Math.round(parseFloat(amount) * 100),
        buyer_name: buyerName || undefined,
        recipient_name: recipientName || undefined,
        payment_method: method,
        sold_by: soldBy,
      });
      setShowCreate(false);
      setAmount('');
      setBuyerName('');
      setRecipientName('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleActive(gc) {
    try {
      await updateMutation.mutateAsync({ id: gc.id, data: { is_active: !gc.is_active } });
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 className="modal-title">Cartes cadeaux</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!showCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Nouvelle
              </button>
            )}
            <button className="btn-ghost" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {/* Create form */}
          {showCreate && (
            <form onSubmit={handleCreate} style={{
              background: 'rgba(var(--overlay),0.03)',
              border: '1px solid rgba(var(--overlay),0.08)',
              borderRadius: 12, padding: 16, marginBottom: 16,
            }}>
              {error && <div className="login-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
              <div className="input-row">
                <div className="form-group">
                  <label className="label">Montant (euros)</label>
                  <input className="input" type="number" step="0.01" min="1" value={amount}
                    onChange={e => setAmount(e.target.value)} required placeholder="50.00" />
                </div>
                <div className="form-group">
                  <label className="label">Paiement</label>
                  <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="input-row">
                <div className="form-group">
                  <label className="label">Acheteur</label>
                  <input className="input" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                    placeholder="Nom (optionnel)" />
                </div>
                <div className="form-group">
                  <label className="label">Beneficiaire</label>
                  <input className="input" value={recipientName} onChange={e => setRecipientName(e.target.value)}
                    placeholder="Nom (optionnel)" />
                </div>
              </div>
              <div className="form-group">
                <label className="label">Vendu par</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {barbers.map(b => (
                    <button key={b.id} type="button"
                      className={`btn btn-sm ${soldBy === b.id ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setSoldBy(b.id)}
                    >{b.name}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => { setShowCreate(false); setError(''); }}>Annuler</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creation...' : 'Creer la carte'}
                </button>
              </div>
            </form>
          )}

          {/* Gift cards list */}
          {isLoading ? (
            <div className="empty-state">Chargement...</div>
          ) : giftCards.length === 0 && !showCreate ? (
            <div className="empty-state">Aucune carte cadeau</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {giftCards.map(gc => (
                <div key={gc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  background: 'rgba(var(--overlay),0.03)',
                  border: '1px solid rgba(var(--overlay),0.06)',
                  borderRadius: 10,
                  opacity: gc.is_active ? 1 : 0.5,
                  transition: 'opacity 0.2s',
                }}>
                  {/* Gift icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.15))',
                    border: '1px solid rgba(139,92,246,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 12 20 22 4 22 4 12" />
                      <rect x="2" y="7" width="20" height="5" />
                      <line x1="12" y1="22" x2="12" y2="7" />
                      <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
                      <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
                    </svg>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700,
                        letterSpacing: '0.05em',
                      }}>{gc.code}</span>
                      <span className={`badge badge-${gc.is_active ? 'active' : 'inactive'}`} style={{ fontSize: 9 }}>
                        {gc.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {gc.buyer_name || 'Anonyme'}
                      {gc.recipient_name ? ` \u2192 ${gc.recipient_name}` : ''}
                      {gc.sold_by_name ? ` \u00B7 ${gc.sold_by_name}` : ''}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800,
                    }}>
                      {formatPrice(gc.balance)}
                    </div>
                    {gc.balance !== gc.initial_amount && (
                      <div style={{
                        fontSize: 10, color: 'var(--text-muted)',
                        textDecoration: 'line-through',
                      }}>
                        {formatPrice(gc.initial_amount)}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => toggleActive(gc)}
                    style={{
                      background: 'none', border: 'none', padding: 4, cursor: 'pointer',
                      color: 'var(--text-muted)', flexShrink: 0, borderRadius: 4,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                    title={gc.is_active ? 'Desactiver' : 'Reactiver'}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {gc.is_active ? (
                        <>
                          <circle cx="12" cy="12" r="10" />
                          <path d="M4.93 4.93l14.14 14.14" />
                        </>
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9 12l2 2 4-4" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
