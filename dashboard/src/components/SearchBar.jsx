import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClients } from '../api';

/**
 * Global search bar with debounced client search and floating dropdown.
 * Calls getClients({ search, limit: 5 }) on input with 300ms debounce.
 * Click a result to navigate to /clients/:id.
 * Escape or click outside closes the dropdown.
 */
export default function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const timerRef = useRef(null);

  /** Debounced search: waits 300ms after last keystroke */
  const search = useCallback((term) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!term || term.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await getClients({ search: term.trim(), limit: 5 });
        setResults(data.clients || []);
        setOpen(true);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      }
      setLoading(false);
    }, 300);
  }, []);

  function handleChange(e) {
    const value = e.target.value;
    setQuery(value);
    search(value);
  }

  function handleSelect(client) {
    setQuery('');
    setResults([]);
    setOpen(false);
    navigate(`/clients/${client.id}`);
  }

  /** Close dropdown on Escape */
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }

  /** Close dropdown on click outside */
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Cleanup timer on unmount */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      <div style={styles.inputWrapper}>
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={styles.icon}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Rechercher un client..."
          style={styles.input}
        />
        {loading && (
          <span style={styles.spinner}>...</span>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={styles.dropdown}>
          {results.map((client) => (
            <div
              key={client.id}
              style={styles.resultItem}
              onClick={() => handleSelect(client)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={styles.resultName}>
                {client.first_name} {client.last_name}
              </div>
              <div style={styles.resultMeta}>
                <span>{client.phone}</span>
                {client.last_visit && (
                  <span style={styles.resultDate}>
                    Derniere visite: {client.last_visit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && query.trim().length >= 2 && results.length === 0 && !loading && (
        <div style={styles.dropdown}>
          <div style={styles.noResults}>Aucun client trouve</div>
        </div>
      )}
    </div>
  );
}

/** @type {Record<string, React.CSSProperties>} */
const styles = {
  wrapper: {
    position: 'relative',
    padding: '12px 10px',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  icon: {
    position: 'absolute',
    left: 10,
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '9px 12px 9px 34px',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    fontFamily: 'var(--font)',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  spinner: {
    position: 'absolute',
    right: 10,
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 10,
    right: 10,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    zIndex: 100,
    maxHeight: 300,
    overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  resultItem: {
    padding: '10px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.1s',
  },
  resultName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text)',
  },
  resultMeta: {
    display: 'flex',
    gap: 12,
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  resultDate: {
    color: 'var(--text-muted)',
  },
  noResults: {
    padding: '14px',
    fontSize: 13,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
};
