import { useState, useEffect, useMemo } from 'react';
import useMobile from '../hooks/useMobile';
import { useBarbers } from '../hooks/useApi';
import * as api from '../api';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function Portfolio() {
  const isMobile = useMobile();
  const { data: barbers = [] } = useBarbers();
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    api.getPortfolioPhotos()
      .then((data) => setPhotos(Array.isArray(data) ? data : []))
      .catch(() => setPhotos([]))
      .finally(() => setLoading(false));
  }, []);

  // Group photos by barber
  const grouped = useMemo(() => {
    const map = {};
    const activeBarbers = barbers.filter(b => b.is_active);
    activeBarbers.forEach(b => { map[b.id] = { barber: b, photos: [] }; });
    photos.forEach(p => {
      if (map[p.created_by]) {
        map[p.created_by].photos.push(p);
      } else {
        // Photo by a barber not in active list (e.g. Admin) — create entry from photo data
        map[p.created_by] = {
          barber: { id: p.created_by, name: p.barber_name || 'Admin', is_active: true },
          photos: [p],
        };
      }
    });
    // Sort: most photos first, barbers with 0 at the end
    return Object.values(map).sort((a, b) => b.photos.length - a.photos.length);
  }, [barbers, photos]);

  const totalPhotos = photos.length;
  const topBarber = grouped[0]?.photos.length > 0 ? grouped[0] : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Portfolio</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {totalPhotos} photo{totalPhotos !== 1 ? 's' : ''} de coupes
          </p>
        </div>
      </div>

      <div className="page-body">
        {/* Stats banner */}
        {!loading && totalPhotos > 0 && (
          <div style={{
            display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap',
          }}>
            <div style={{
              flex: 1, minWidth: 160, padding: '18px 20px', borderRadius: 14,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 20, right: 20, height: 2, background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)', opacity: 0.5 }} />
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>Total photos</div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--font-display)' }}>{totalPhotos}</div>
            </div>
            {topBarber && (
              <div style={{
                flex: 1, minWidth: 160, padding: '18px 20px', borderRadius: 14,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 20, right: 20, height: 2, background: 'linear-gradient(90deg, transparent, #22c55e, transparent)', opacity: 0.5 }} />
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 8 }}>Top contributeur</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {topBarber.barber.name} <span style={{ color: '#22c55e', fontSize: 13 }}>({topBarber.photos.length})</span>
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}>Chargement...</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : `repeat(${Math.min(grouped.length, 3)}, 1fr)`,
            gap: isMobile ? 20 : 24,
          }}>
            {grouped.map(({ barber, photos: barberPhotos }) => (
              <div key={barber.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 16, overflow: 'hidden',
              }}>
                {/* Barber header */}
                <div style={{
                  padding: '20px 20px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  borderBottom: barberPhotos.length > 0 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: `linear-gradient(135deg, ${barber.name.charCodeAt(0) % 2 === 0 ? '#3b82f6' : '#8b5cf6'}30, ${barber.name.charCodeAt(0) % 2 === 0 ? '#3b82f6' : '#8b5cf6'}10)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 800, color: barber.name.charCodeAt(0) % 2 === 0 ? '#3b82f6' : '#8b5cf6',
                    fontFamily: 'var(--font-display)',
                  }}>
                    {barber.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{barber.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {barberPhotos.length} photo{barberPhotos.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {barberPhotos.length > 0 && (
                    <div style={{
                      fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)',
                      color: barberPhotos.length >= 5 ? '#22c55e' : barberPhotos.length >= 2 ? 'var(--text)' : 'var(--text-muted)',
                    }}>
                      {barberPhotos.length}
                    </div>
                  )}
                </div>

                {/* Photos grid or empty state */}
                {barberPhotos.length === 0 ? (
                  <div style={{
                    padding: '40px 20px', textAlign: 'center',
                  }}>
                    <div style={{
                      width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
                      background: 'rgba(var(--overlay), 0.04)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Aucune photo
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {barber.name}, prends tes plus belles coupes en photo !
                    </p>
                  </div>
                ) : (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3,
                    padding: 3,
                  }}>
                    {barberPhotos.map((photo) => (
                      <div
                        key={photo.id}
                        onClick={() => setLightbox(photo)}
                        style={{
                          position: 'relative', paddingBottom: '100%',
                          cursor: 'pointer', overflow: 'hidden',
                          borderRadius: 4, background: '#111',
                        }}
                      >
                        <img
                          src={photo.photo_data}
                          alt={`Coupe par ${barber.name}`}
                          loading="lazy"
                          style={{
                            position: 'absolute', inset: 0,
                            width: '100%', height: '100%',
                            objectFit: 'cover',
                            transition: 'transform 0.3s ease',
                          }}
                          onMouseEnter={(e) => { e.target.style.transform = 'scale(1.05)'; }}
                          onMouseLeave={(e) => { e.target.style.transform = 'scale(1)'; }}
                        />
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0,
                          padding: '16px 8px 6px',
                          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                          fontSize: 10, color: 'rgba(255,255,255,0.7)',
                          display: 'flex', justifyContent: 'space-between',
                        }}>
                          <span>{photo.client_first_name}</span>
                          <span>{formatDate(photo.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 20,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img
              src={lightbox.photo_data}
              alt="Photo coupe"
              style={{
                maxWidth: '100%', maxHeight: '85vh',
                borderRadius: 12, objectFit: 'contain',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            />
            <div style={{
              position: 'absolute', bottom: -36, left: 0, right: 0,
              textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)',
            }}>
              {lightbox.client_first_name} {lightbox.client_last_name} — {lightbox.barber_name} — {formatDate(lightbox.created_at)}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            style={{
              position: 'absolute', top: 20, right: 20,
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)', border: 'none',
              color: '#fff', fontSize: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
