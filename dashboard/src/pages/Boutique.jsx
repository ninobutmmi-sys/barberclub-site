import { useState, useEffect } from 'react';
import {
  getProducts, createProduct, updateProduct, deleteProduct,
  recordProductSale, getProductSales, getProductStats,
  getGiftCards, createGiftCard, updateGiftCard,
  getBarbers,
} from '../api';

function formatPrice(cents) {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

const CATEGORIES = [
  { value: 'cire', label: 'Cires & Coiffants' },
  { value: 'huile', label: 'Huiles à barbe' },
  { value: 'shampoing', label: 'Shampoings' },
  { value: 'soin', label: 'Soins & Après-shampoings' },
  { value: 'accessoire', label: 'Accessoires' },
  { value: 'autre', label: 'Autre' },
];

export default function Boutique() {
  const [tab, setTab] = useState('products'); // products | gift-cards | sales
  const [products, setProducts] = useState([]);
  const [giftCards, setGiftCards] = useState([]);
  const [sales, setSales] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'create' | product obj
  const [saleModal, setSaleModal] = useState(null); // null | product obj
  const [gcModal, setGcModal] = useState(null); // null | 'create' | gift card obj
  const [filterCategory, setFilterCategory] = useState('');
  const [showLowStock, setShowLowStock] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [p, gc, b, st] = await Promise.all([
        getProducts(),
        getGiftCards(),
        getBarbers(),
        getProductStats(),
      ]);
      setProducts(p);
      setGiftCards(gc);
      setBarbers(b);
      setStats(st);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function loadSales() {
    try {
      const s = await getProductSales();
      setSales(s);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    if (tab === 'sales') loadSales();
  }, [tab]);

  async function handleDeleteProduct(id) {
    if (!confirm('Désactiver ce produit ?')) return;
    try {
      await deleteProduct(id);
      loadData();
    } catch (err) { alert(err.message); }
  }

  const filteredProducts = products.filter((p) => {
    if (filterCategory && p.category !== filterCategory) return false;
    if (showLowStock && p.stock_quantity > p.alert_threshold) return false;
    return true;
  });

  const lowStockCount = products.filter((p) => p.stock_quantity <= p.alert_threshold && p.is_active).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Boutique & Stocks</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Produits, cartes cadeaux & ventes
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* Stats cards */}
        {stats && (
          <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="CA Produits aujourd'hui" value={formatPrice(stats.revenue_today || 0)} />
            <StatCard label="CA Produits ce mois" value={formatPrice(stats.revenue_month || 0)} />
            <StatCard label="Produits en stock" value={products.filter((p) => p.is_active).length} />
            <StatCard
              label="Alertes stock"
              value={lowStockCount}
              alert={lowStockCount > 0}
            />
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(var(--overlay),0.08)' }}>
          {[
            { id: 'products', label: 'Produits' },
            { id: 'gift-cards', label: 'Cartes Cadeaux' },
            { id: 'sales', label: 'Historique Ventes' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none', borderBottom: tab === t.id ? '2px solid var(--text)' : '2px solid transparent',
                background: 'transparent', color: tab === t.id ? 'var(--text)' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
              {t.id === 'products' && lowStockCount > 0 && (
                <span style={{
                  marginLeft: 6, background: '#ef4444', color: '#fff', fontSize: 10,
                  padding: '1px 6px', borderRadius: 10, fontWeight: 700,
                }}>{lowStockCount}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="empty-state">Chargement...</div>
        ) : (
          <>
            {/* ====== PRODUCTS TAB ====== */}
            {tab === 'products' && (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    className="input"
                    style={{ width: 'auto', minWidth: 160, fontSize: 12 }}
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                  >
                    <option value="">Toutes catégories</option>
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    className={`btn btn-sm ${showLowStock ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowLowStock(!showLowStock)}
                  >
                    {showLowStock ? '⚠ Stock bas' : 'Filtrer stock bas'}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-primary btn-sm" onClick={() => setModal('create')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Ajouter produit
                  </button>
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Produit</th>
                        <th>Catégorie</th>
                        <th>Prix achat</th>
                        <th>Prix vente</th>
                        <th>Marge</th>
                        <th>Stock</th>
                        <th style={{ width: 120 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((p) => {
                        const margin = p.sell_price - p.buy_price;
                        const marginPct = p.buy_price > 0 ? Math.round((margin / p.buy_price) * 100) : 0;
                        const isLow = p.stock_quantity <= p.alert_threshold;
                        return (
                          <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.4 }}>
                            <td style={{ fontWeight: 600 }}>
                              {p.name}
                              {p.description && (
                                <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 1 }}>{p.description}</div>
                              )}
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {CATEGORIES.find((c) => c.value === p.category)?.label || p.category}
                            </td>
                            <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{formatPrice(p.buy_price)}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{formatPrice(p.sell_price)}</td>
                            <td>
                              <span style={{ color: margin > 0 ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 12 }}>
                                {formatPrice(margin)} ({marginPct}%)
                              </span>
                            </td>
                            <td>
                              <span style={{
                                fontWeight: 700, fontSize: 13,
                                color: isLow ? '#ef4444' : p.stock_quantity > 20 ? '#22c55e' : '#f59e0b',
                              }}>
                                {p.stock_quantity}
                              </span>
                              {isLow && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
                                  ⚠ BAS
                                </span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSaleModal(p)}>
                                  Vendre
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={() => setModal(p)}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                </button>
                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteProduct(p.id)}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredProducts.length === 0 && (
                        <tr><td colSpan="7" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Aucun produit</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ====== GIFT CARDS TAB ====== */}
            {tab === 'gift-cards' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setGcModal('create')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Nouvelle carte cadeau
                  </button>
                </div>

                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Montant initial</th>
                        <th>Solde restant</th>
                        <th>Acheteur</th>
                        <th>Destinataire</th>
                        <th>Expiration</th>
                        <th>Statut</th>
                        <th style={{ width: 60 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {giftCards.map((gc) => {
                        const expired = gc.expires_at && new Date(gc.expires_at) < new Date();
                        const used = gc.balance === 0;
                        return (
                          <tr key={gc.id} style={{ opacity: gc.is_active && !expired ? 1 : 0.5 }}>
                            <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>{gc.code}</td>
                            <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{formatPrice(gc.initial_amount)}</td>
                            <td>
                              <span style={{ fontWeight: 700, color: gc.balance > 0 ? '#22c55e' : '#888' }}>
                                {formatPrice(gc.balance)}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>{gc.buyer_name || '–'}</td>
                            <td style={{ fontSize: 12 }}>{gc.recipient_name || '–'}</td>
                            <td style={{ fontSize: 12 }}>
                              {gc.expires_at ? new Date(gc.expires_at).toLocaleDateString('fr-FR') : 'Illimitée'}
                            </td>
                            <td>
                              <span className={`badge badge-${expired ? 'inactive' : used ? 'inactive' : 'active'}`}>
                                {expired ? 'Expirée' : used ? 'Utilisée' : 'Active'}
                              </span>
                            </td>
                            <td>
                              <button className="btn btn-ghost btn-sm" onClick={() => setGcModal(gc)}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {giftCards.length === 0 && (
                        <tr><td colSpan="8" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Aucune carte cadeau</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ====== SALES HISTORY TAB ====== */}
            {tab === 'sales' && (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Produit</th>
                      <th>Qté</th>
                      <th>Total</th>
                      <th>Paiement</th>
                      <th>Vendu par</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontSize: 12 }}>{new Date(s.sold_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ fontWeight: 600 }}>{s.product_name}</td>
                        <td>{s.quantity}</td>
                        <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13 }}>{formatPrice(s.total_price)}</td>
                        <td style={{ fontSize: 12, textTransform: 'uppercase' }}>{s.payment_method}</td>
                        <td style={{ fontSize: 12 }}>{s.barber_name || '–'}</td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Aucune vente</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Product Create/Edit Modal */}
      {modal && (
        <ProductModal
          product={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadData(); }}
        />
      )}

      {/* Product Sale Modal */}
      {saleModal && (
        <SaleModal
          product={saleModal}
          barbers={barbers}
          onClose={() => setSaleModal(null)}
          onSaved={() => { setSaleModal(null); loadData(); if (tab === 'sales') loadSales(); }}
        />
      )}

      {/* Gift Card Create/Edit Modal */}
      {gcModal && (
        <GiftCardModal
          giftCard={gcModal === 'create' ? null : gcModal}
          barbers={barbers}
          onClose={() => setGcModal(null)}
          onSaved={() => { setGcModal(null); loadData(); }}
        />
      )}
    </>
  );
}

function StatCard({ label, value, alert }) {
  return (
    <div style={{
      flex: '1 1 180px', padding: '16px 20px', borderRadius: 10,
      background: alert ? 'rgba(239,68,68,0.08)' : 'rgba(var(--overlay),0.03)',
      border: `1px solid ${alert ? 'rgba(239,68,68,0.25)' : 'rgba(var(--overlay),0.06)'}`,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)', color: alert ? '#ef4444' : 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ProductModal({ product, onClose, onSaved }) {
  const isEdit = !!product;
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [category, setCategory] = useState(product?.category || 'autre');
  const [buyPrice, setBuyPrice] = useState(product ? (product.buy_price / 100).toFixed(2) : '');
  const [sellPrice, setSellPrice] = useState(product ? (product.sell_price / 100).toFixed(2) : '');
  const [stockQuantity, setStockQuantity] = useState(product?.stock_quantity ?? 0);
  const [alertThreshold, setAlertThreshold] = useState(product?.alert_threshold ?? 5);
  const [sku, setSku] = useState(product?.sku || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    const body = {
      name,
      description: description || undefined,
      category,
      buy_price: Math.round(parseFloat(buyPrice || 0) * 100),
      sell_price: Math.round(parseFloat(sellPrice) * 100),
      stock_quantity: parseInt(stockQuantity),
      alert_threshold: parseInt(alertThreshold),
      sku: sku || undefined,
    };
    try {
      if (isEdit) await updateProduct(product.id, body);
      else await createProduct(body);
      onSaved();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{isEdit ? 'Modifier produit' : 'Nouveau produit'}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="form-group">
              <label className="label">Nom du produit</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="label">Description</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Cire coiffante tenue forte..." />
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Catégorie</label>
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">SKU / Référence</label>
                <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optionnel" />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Prix d'achat (€)</label>
                <input className="input" type="number" step="0.01" min="0" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">Prix de vente (€)</label>
                <input className="input" type="number" step="0.01" min="0" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Quantité en stock</label>
                <input className="input" type="number" min="0" value={stockQuantity} onChange={(e) => setStockQuantity(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Seuil d'alerte</label>
                <input className="input" type="number" min="0" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SaleModal({ product, barbers, onClose, onSaved }) {
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('cb');
  const [soldBy, setSoldBy] = useState(barbers[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = quantity * product.sell_price;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (quantity > product.stock_quantity) {
      setError(`Stock insuffisant (${product.stock_quantity} disponible)`);
      return;
    }
    setSaving(true);
    try {
      await recordProductSale(product.id, { quantity: parseInt(quantity), payment_method: paymentMethod, sold_by: soldBy });
      onSaved();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title">Vente — {product.name}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div style={{ padding: '12px 16px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, marginBottom: 16, border: '1px solid rgba(var(--overlay),0.06)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Prix unitaire</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>{formatPrice(product.sell_price)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Stock actuel : {product.stock_quantity}</div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Quantité</label>
                <input className="input" type="number" min="1" max={product.stock_quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="label">Paiement</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cb">CB</option>
                  <option value="cash">Espèces</option>
                  <option value="lydia">Lydia</option>
                  <option value="other">Autre</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Vendu par</label>
              <select className="input" value={soldBy} onChange={(e) => setSoldBy(e.target.value)}>
                {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div style={{ padding: '16px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>TOTAL</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, color: '#22c55e' }}>{formatPrice(total)}</div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : 'Enregistrer la vente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GiftCardModal({ giftCard, barbers, onClose, onSaved }) {
  const isEdit = !!giftCard;
  const [amount, setAmount] = useState(giftCard ? (giftCard.initial_amount / 100).toFixed(2) : '');
  const [balance, setBalance] = useState(giftCard ? (giftCard.balance / 100).toFixed(2) : '');
  const [buyerName, setBuyerName] = useState(giftCard?.buyer_name || '');
  const [recipientName, setRecipientName] = useState(giftCard?.recipient_name || '');
  const [recipientEmail, setRecipientEmail] = useState(giftCard?.recipient_email || '');
  const [paymentMethod, setPaymentMethod] = useState(giftCard?.payment_method || 'cb');
  const [expiresAt, setExpiresAt] = useState(giftCard?.expires_at?.split('T')[0] || '');
  const [soldBy, setSoldBy] = useState(giftCard?.sold_by || barbers[0]?.id || '');
  const [isActive, setIsActive] = useState(giftCard?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (isEdit) {
        await updateGiftCard(giftCard.id, {
          balance: Math.round(parseFloat(balance) * 100),
          recipient_name: recipientName || undefined,
          recipient_email: recipientEmail || undefined,
          is_active: isActive,
        });
      } else {
        await createGiftCard({
          initial_amount: Math.round(parseFloat(amount) * 100),
          buyer_name: buyerName || undefined,
          recipient_name: recipientName || undefined,
          recipient_email: recipientEmail || undefined,
          payment_method: paymentMethod,
          expires_at: expiresAt || undefined,
          sold_by: soldBy || undefined,
        });
      }
      onSaved();
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 className="modal-title">{isEdit ? 'Modifier carte cadeau' : 'Nouvelle carte cadeau'}</h3>
          <button className="btn-ghost" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
            {isEdit && (
              <div style={{ padding: '12px 16px', background: 'rgba(var(--overlay),0.03)', borderRadius: 8, marginBottom: 16, border: '1px solid rgba(var(--overlay),0.06)', textAlign: 'center' }}>
                <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{giftCard.code}</div>
              </div>
            )}
            {!isEdit && (
              <div className="input-row">
                <div className="form-group">
                  <label className="label">Montant (€)</label>
                  <input className="input" type="number" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="label">Paiement</label>
                  <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    <option value="cb">CB</option>
                    <option value="cash">Espèces</option>
                    <option value="lydia">Lydia</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
              </div>
            )}
            {isEdit && (
              <div className="form-group">
                <label className="label">Solde restant (€)</label>
                <input className="input" type="number" step="0.01" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} required />
              </div>
            )}
            <div className="input-row">
              <div className="form-group">
                <label className="label">Nom acheteur</label>
                <input className="input" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Optionnel" disabled={isEdit} />
              </div>
              <div className="form-group">
                <label className="label">Nom destinataire</label>
                <input className="input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Optionnel" />
              </div>
            </div>
            <div className="input-row">
              <div className="form-group">
                <label className="label">Email destinataire</label>
                <input className="input" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="Optionnel" />
              </div>
              {!isEdit && (
                <div className="form-group">
                  <label className="label">Date d'expiration</label>
                  <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
              )}
            </div>
            {!isEdit && (
              <div className="form-group">
                <label className="label">Vendu par</label>
                <select className="input" value={soldBy} onChange={(e) => setSoldBy(e.target.value)}>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            {isEdit && (
              <div className="form-group">
                <label className="label">Statut</label>
                <button type="button" className={`toggle ${isActive ? 'active' : ''}`} onClick={() => setIsActive(!isActive)} />
                <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {isActive ? 'Active' : 'Désactivée'}
                </span>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
