/**
 * ProductPicker — Add/remove product sales from a booking.
 * Shows a "+ Ajouter un produit" button that opens a search dropdown.
 * Displays attached products with price and a remove button.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProducts } from '../../hooks/useApi';
import * as api from '../../api';

export default function ProductPicker({ booking, barberId }) {
  const queryClient = useQueryClient();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  const { data: products = [] } = useProducts();

  // Load existing sales for this booking
  useEffect(() => {
    if (!booking?.id) return;
    setLoading(true);
    api.getBookingSales(booking.id)
      .then((data) => setSales(Array.isArray(data) ? data : []))
      .catch(() => setSales([]))
      .finally(() => setLoading(false));
  }, [booking?.id]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open && searchRef.current) searchRef.current.focus();
  }, [open]);

  const filteredProducts = products.filter((p) => {
    if (!p.is_active || p.stock_quantity <= 0 || !p.sell_price) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
  });

  const handleAdd = useCallback(async (product) => {
    setSaving(true);
    try {
      const result = await api.recordProductSale(product.id, {
        quantity: 1,
        payment_method: 'cb',
        sold_by: barberId,
        client_id: booking.client_id || null,
        booking_id: booking.id,
      });
      setSales((prev) => [...prev, {
        id: result.id,
        product_id: product.id,
        product_name: product.name,
        category: product.category,
        quantity: 1,
        unit_price: product.sell_price,
        total_price: product.sell_price,
      }]);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setOpen(false);
      setSearch('');
    } catch (err) {
      alert(err.message || 'Erreur lors de l\'ajout');
    }
    setSaving(false);
  }, [barberId, booking, queryClient]);

  const handleRemove = useCallback(async (saleId) => {
    try {
      await api.deleteSale(saleId);
      setSales((prev) => prev.filter((s) => s.id !== saleId));
      queryClient.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      alert(err.message || 'Erreur lors de la suppression');
    }
  }, [queryClient]);

  const totalProducts = sales.reduce((sum, s) => sum + (s.total_price || 0), 0);

  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--text-muted)',
        }}>
          Produits
        </span>
        {totalProducts > 0 && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            +{(totalProducts / 100).toFixed(2).replace('.', ',')} €
          </span>
        )}
      </div>

      {/* Existing sales */}
      {sales.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {sales.map((s) => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 10,
              background: 'rgba(var(--overlay), 0.03)',
              border: '1px solid rgba(var(--overlay), 0.06)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(139,92,246,0.05))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
              }}>
                📦
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.product_name}</div>
                {s.category && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.category}</div>}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                {(s.total_price / 100).toFixed(2).replace('.', ',')} €
              </div>
              <button
                onClick={() => handleRemove(s.id)}
                style={{
                  width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, fontSize: 14,
                }}
                title="Retirer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button + dropdown */}
      <div ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(!open)}
          disabled={saving}
          style={{
            width: '100%', padding: '10px 14px',
            background: open ? 'rgba(var(--overlay), 0.06)' : 'rgba(var(--overlay), 0.03)',
            border: `1px dashed rgba(var(--overlay), ${open ? '0.15' : '0.08'})`,
            borderRadius: 10, cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            transition: 'all 0.15s',
            fontFamily: 'var(--font)',
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Ajouter un produit
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 50, overflow: 'hidden',
            maxHeight: 300, display: 'flex', flexDirection: 'column',
          }}>
            {/* Search */}
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher un produit..."
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'rgba(var(--overlay), 0.04)',
                  border: '1px solid rgba(var(--overlay), 0.08)',
                  borderRadius: 8, color: 'var(--text)', fontSize: 13,
                  fontFamily: 'var(--font)', outline: 'none',
                }}
              />
            </div>

            {/* Results */}
            <div style={{ overflowY: 'auto', flex: 1, overscrollBehavior: 'contain' }}>
              {filteredProducts.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  {search ? 'Aucun produit trouvé' : 'Aucun produit en stock'}
                </div>
              ) : (
                filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAdd(p)}
                    disabled={saving}
                    style={{
                      width: '100%', padding: '10px 14px',
                      background: 'transparent', border: 'none',
                      borderBottom: '1px solid rgba(var(--overlay), 0.04)',
                      cursor: 'pointer', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'background 0.1s',
                      fontFamily: 'var(--font)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                        {p.category && <span>{p.category}</span>}
                        <span>Stock: {p.stock_quantity}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                      {(p.sell_price / 100).toFixed(0)} €
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Total with products */}
      {sales.length > 0 && booking.price != null && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(var(--overlay), 0.03)',
          border: '1px solid rgba(var(--overlay), 0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Total (prestation + produits)</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
            {((booking.price + totalProducts) / 100).toFixed(2).replace('.', ',')} €
          </span>
        </div>
      )}
    </div>
  );
}
