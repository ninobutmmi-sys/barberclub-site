import { useState, useMemo } from 'react';
import useMobile from '../hooks/useMobile';
import {
  useProducts,
  useProductStats,
  useBarbers,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  useRecordSale,
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

function getStockStatus(qty, threshold) {
  const t = threshold || 5;
  if (qty <= t) return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  if (qty <= t * 2.5) return { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  return { color: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
}

const SUGGESTED_CATEGORIES = ['Cires', 'Coiffage', 'Barbe', 'Parfum', 'Accessoires'];
const PAYMENT_METHODS = [
  { value: 'cb', label: 'CB' },
  { value: 'cash', label: 'Especes' },
  { value: 'lydia', label: 'Lydia' },
  { value: 'other', label: 'Autre' },
];

const KPI_ACCENTS = {
  blue:  { color: '#3b82f6' },
  green: { color: '#22c55e' },
  amber: { color: '#f59e0b' },
  red:   { color: '#ef4444' },
};

// ============================================
// Main Component
// ============================================

export default function Boutique() {
  const isMobile = useMobile();
  const { data: products = [], isLoading, error, refetch } = useProducts();
  const { data: stats } = useProductStats();
  const { data: barbers = [] } = useBarbers();
  const [search, setSearch] = useState('');
  const [productModal, setProductModal] = useState(null);
  const [saleModal, setSaleModal] = useState(null);
  const [giftCardModal, setGiftCardModal] = useState(false);

  const grouped = useMemo(() => {
    const filtered = products.filter(p =>
      p.is_active &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.category || '').toLowerCase().includes(search.toLowerCase()))
    );
    const groups = {};
    filtered.forEach(p => {
      const cat = p.category || 'Autre';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Autre') return 1;
      if (b === 'Autre') return -1;
      return a.localeCompare(b, 'fr');
    });
  }, [products, search]);

  const stockValue = useMemo(() => {
    return products
      .filter(p => p.is_active)
      .reduce((sum, p) => sum + (p.sell_price || 0) * (p.stock_quantity || 0), 0);
  }, [products]);

  const lowStockCount = useMemo(() => {
    return products.filter(p => p.is_active && p.stock_quantity <= (p.alert_threshold || 5)).length;
  }, [products]);

  return (
    <>
      {error && (
        <div role="alert" style={{
          background: '#1c1917', border: '1px solid #dc2626', borderRadius: 8,
          padding: '12px 16px', marginBottom: 16, display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', color: '#fca5a5',
        }}>
          <span>{typeof error === 'string' ? error : error.message}</span>
          <button onClick={() => refetch()} style={{
            background: '#dc2626', color: '#fff', border: 'none',
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
          }}>Reessayer</button>
        </div>
      )}

      <div className="page-header">
        <h2 className="page-title">Boutique</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setGiftCardModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
            </svg>
            Cartes cadeaux
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setProductModal('create')}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Produit
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* ---- KPI Stats ---- */}
        <div className="a-kpi-grid" style={{ marginBottom: 28 }}>
          <KpiCard
            label="Valeur du stock"
            value={formatPriceCompact(stockValue)}
            accent="blue"
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21" /><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>}
          />
          <KpiCard
            label="Alertes stock"
            value={lowStockCount}
            accent={lowStockCount > 0 ? 'red' : 'green'}
            subtitle={lowStockCount > 0 ? 'produit(s) bas' : 'Tout est OK'}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>}
          />
          <KpiCard
            label="CA produits (mois)"
            value={formatPriceCompact(stats?.revenue_month || 0)}
            accent="green"
            subtitle={`${stats?.sales_month || 0} ventes`}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>}
          />
          <KpiCard
            label="Ventes aujourd'hui"
            value={stats?.sales_today || 0}
            accent="amber"
            subtitle={formatPriceCompact(stats?.revenue_today || 0)}
            icon={<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></svg>}
          />
        </div>

        {/* ---- Search ---- */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28,
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          <div style={{ flex: 1, minWidth: isMobile ? '100%' : 200, position: 'relative' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none',
              }}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="input"
              placeholder="Rechercher un produit..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 38, width: '100%' }}
            />
          </div>
          {search && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {grouped.reduce((sum, [, items]) => sum + items.length, 0)} resultat(s)
            </span>
          )}
        </div>

        {/* ---- Products by category ---- */}
        {isLoading ? (
          <div className="empty-state">Chargement...</div>
        ) : grouped.length === 0 ? (
          <div className="empty-state">
            {search ? 'Aucun produit trouve' : 'Aucun produit — ajoutez votre premier produit'}
          </div>
        ) : (
          grouped.map(([category, items]) => {
            const catColor = getCategoryColor(category);
            return (
              <div key={category} style={{ marginBottom: 32 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  marginBottom: 16, paddingBottom: 12,
                  borderBottom: '1px solid rgba(var(--overlay), 0.04)',
                }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: 3,
                    background: catColor,
                    boxShadow: `0 0 8px ${catColor}40`,
                  }} />
                  <h3 style={{
                    fontSize: 14, fontWeight: 700, letterSpacing: '0.04em',
                    textTransform: 'uppercase', color: 'var(--text-secondary)',
                  }}>
                    {category}
                  </h3>
                  <span style={{
                    fontSize: 11, color: 'var(--text-muted)',
                    background: 'rgba(var(--overlay), 0.05)',
                    padding: '2px 8px', borderRadius: 10,
                  }}>
                    {items.length}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile
                    ? 'repeat(2, 1fr)'
                    : 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: isMobile ? 10 : 14,
                }}>
                  {items.map(product => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      categoryColor={catColor}
                      onEdit={() => setProductModal(product)}
                      onSell={() => setSaleModal(product)}
                      isMobile={isMobile}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {saleModal && (
        <SaleModal
          product={saleModal}
          barbers={barbers}
          onClose={() => setSaleModal(null)}
        />
      )}
      {productModal && (
        <ProductModal
          product={productModal === 'create' ? null : productModal}
          onClose={() => setProductModal(null)}
        />
      )}
      {giftCardModal && (
        <GiftCardsModal
          barbers={barbers}
          onClose={() => setGiftCardModal(false)}
        />
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
      <div style={{
        position: 'absolute', top: 0, left: 24, right: 24, height: 2,
        background: `linear-gradient(90deg, transparent, ${a.color}, transparent)`,
        opacity: 0.5, borderRadius: '0 0 2px 2px',
      }} />
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          {label}
        </div>
        {icon && <div style={{ opacity: 0.25 }}>{icon}</div>}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800,
        lineHeight: 1.1, marginBottom: 6,
      }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{subtitle}</div>
      )}
    </div>
  );
}

// ============================================
// Product Card
// ============================================

function ProductCard({ product, categoryColor, onEdit, onSell, isMobile }) {
  const stock = getStockStatus(product.stock_quantity, product.alert_threshold);
  const threshold = product.alert_threshold || 5;
  const barFill = Math.min(100, (product.stock_quantity / (threshold * 4)) * 100);
  const margin = product.buy_price > 0
    ? Math.round(((product.sell_price - product.buy_price) / product.sell_price) * 100)
    : null;

  return (
    <div
      style={{
        background: 'linear-gradient(165deg, rgba(var(--overlay),0.05) 0%, rgba(var(--overlay),0.015) 100%)',
        border: '1px solid rgba(var(--overlay),0.06)',
        borderRadius: 14,
        padding: isMobile ? 14 : 16,
        position: 'relative',
        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        cursor: 'default',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${categoryColor}30`;
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = `0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px ${categoryColor}15`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '';
      }}
    >
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 16, right: 16, height: 2,
        background: `linear-gradient(90deg, transparent, ${categoryColor}60, transparent)`,
        borderRadius: '0 0 2px 2px',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 10, gap: 6,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: isMobile ? 13 : 14, fontWeight: 700, lineHeight: 1.3,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {product.name}
          </div>
          {product.sku && (
            <div style={{
              fontSize: 10, color: 'var(--text-muted)', marginTop: 1,
              fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
            }}>
              {product.sku}
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          style={{
            background: 'none', border: 'none', padding: 4, cursor: 'pointer',
            color: 'var(--text-muted)', borderRadius: 6, flexShrink: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          title="Modifier"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>

      {/* Stock bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 600, color: stock.color,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {product.stock_quantity <= threshold && (
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
            {product.stock_quantity} en stock
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            seuil {threshold}
          </span>
        </div>
        <div style={{
          height: 4, borderRadius: 2,
          background: 'rgba(var(--overlay), 0.06)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${barFill}%`,
            background: `linear-gradient(90deg, ${stock.color}, ${stock.color}cc)`,
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Price + margin */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: isMobile ? 16 : 18, fontWeight: 800,
        }}>
          {formatPriceCompact(product.sell_price)}
        </div>
        {margin !== null && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#22c55e',
            background: 'rgba(34,197,94,0.1)',
            padding: '2px 6px', borderRadius: 4,
          }}>
            +{margin}%
          </span>
        )}
      </div>

      {/* Sell button or internal badge */}
      {product.sellable === false ? (
        <div style={{
          width: '100%', padding: '7px 0',
          background: 'rgba(var(--overlay),0.04)',
          border: '1px solid rgba(var(--overlay),0.06)',
          borderRadius: 8,
          color: 'var(--text-muted)', fontSize: 11, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          letterSpacing: '0.03em',
        }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
            <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          Stock interne
        </div>
      ) : (
        <button
          onClick={onSell}
          style={{
            width: '100%', padding: '8px 0',
            background: `${categoryColor}12`,
            border: `1px solid ${categoryColor}20`,
            borderRadius: 8, cursor: 'pointer',
            color: categoryColor, fontSize: 12, fontWeight: 700,
            fontFamily: 'var(--font)',
            transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `${categoryColor}22`;
            e.currentTarget.style.borderColor = `${categoryColor}35`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = `${categoryColor}12`;
            e.currentTarget.style.borderColor = `${categoryColor}20`;
          }}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 01-8 0" />
          </svg>
          Vendre
        </button>
      )}
    </div>
  );
}

// ============================================
// Sale Modal
// ============================================

function SaleModal({ product, barbers, onClose }) {
  const recordSale = useRecordSale();
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState('cb');
  const [barberId, setBarberId] = useState(barbers[0]?.id || '');
  const [error, setError] = useState('');
  const total = (product.sell_price || 0) * qty;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!barberId) { setError('Selectionnez un barber'); return; }
    if (qty > product.stock_quantity) { setError('Stock insuffisant'); return; }
    try {
      await recordSale.mutateAsync({
        id: product.id,
        data: { quantity: qty, payment_method: method, sold_by: barberId },
      });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title">Vendre : {product.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Quantity stepper */}
            <div className="form-group">
              <label className="label">Quantite</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))}
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'rgba(var(--overlay),0.06)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 600, transition: 'all 0.15s',
                  }}>
                  -
                </button>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 800,
                  minWidth: 48, textAlign: 'center',
                }}>
                  {qty}
                </span>
                <button type="button"
                  onClick={() => setQty(q => Math.min(product.stock_quantity, q + 1))}
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'rgba(var(--overlay),0.06)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 600, transition: 'all 0.15s',
                  }}>
                  +
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  / {product.stock_quantity} dispo
                </span>
              </div>
            </div>

            {/* Payment method */}
            <div className="form-group">
              <label className="label">Paiement</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PAYMENT_METHODS.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    className={`btn btn-sm ${method === m.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setMethod(m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Barber */}
            <div className="form-group">
              <label className="label">Vendu par</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {barbers.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    className={`btn btn-sm ${barberId === b.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setBarberId(b.id)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Total */}
            <div style={{
              marginTop: 8, padding: '16px 18px',
              background: 'linear-gradient(135deg, rgba(var(--overlay),0.04), rgba(var(--overlay),0.02))',
              borderRadius: 12, border: '1px solid rgba(var(--overlay),0.06)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>Total</span>
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800,
              }}>
                {formatPrice(total)}
              </span>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={recordSale.isPending}>
              {recordSale.isPending ? 'Enregistrement...' : 'Confirmer la vente'}
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
                  {sellable ? 'Oui — visible en vente' : 'Non — stock interne uniquement'}
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
