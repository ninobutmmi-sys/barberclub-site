// ---------------------------------------------------------------------------
// BlockDetailModal
// ---------------------------------------------------------------------------

import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { BLOCK_TYPE_LABELS } from './BlockedSlotBlock';
import { DetailRow } from './BookingDetailModal';
import { CloseIcon } from './Icons';

export default function BlockDetailModal({ block, onClose, onDelete }) {
  if (!block) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Créneau bloqué</h3>
          <button className="btn-ghost" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gap: 4 }}>
            <DetailRow label="Type" value={BLOCK_TYPE_LABELS[block.type] || block.type} bold />
            <DetailRow label="Barber" value={block.barber_name || '\u2013'} />
            <DetailRow label="Date" value={block.date ? format(parseISO(typeof block.date === 'string' ? block.date.slice(0, 10) : block.date), 'EEEE d MMMM yyyy', { locale: fr }) : '\u2013'} />
            <DetailRow label="Horaire" value={`${block.start_time?.slice(0, 5)} \u2013 ${block.end_time?.slice(0, 5)}`} />
            {block.reason && <DetailRow label="Raison" value={block.reason} />}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(block.id)}>Supprimer le blocage</button>
        </div>
      </div>
    </div>
  );
}
