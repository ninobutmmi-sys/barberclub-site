-- Migration 049: Tasks section
-- Boss assigns tasks to barbers OR free-text people (alternant), with optional
-- recurrence (paie fin du mois, etc.) and history of completions.

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id VARCHAR(20) NOT NULL REFERENCES salons(id),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    description TEXT,
    assigned_to_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    assigned_to_name TEXT,
    due_date DATE,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_config JSONB,
    next_due_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES barbers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Either a barber OR a free-text name, never both
    CONSTRAINT tasks_assignee_xor CHECK (
        NOT (assigned_to_barber_id IS NOT NULL AND assigned_to_name IS NOT NULL)
    ),
    -- Recurrence config required iff is_recurring=true
    CONSTRAINT tasks_recurrence_consistency CHECK (
        (is_recurring = false AND recurrence_config IS NULL)
        OR (is_recurring = true AND recurrence_config IS NOT NULL)
    )
);

CREATE INDEX idx_tasks_salon_active_due ON tasks (salon_id, is_active, next_due_date);
CREATE INDEX idx_tasks_assigned_barber ON tasks (assigned_to_barber_id) WHERE assigned_to_barber_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    completed_by_barber_id UUID REFERENCES barbers(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_date_at_completion DATE,
    notes TEXT,

    -- Idempotent completion : 2 clicks on same occurrence = 1 row
    UNIQUE (task_id, due_date_at_completion)
);

CREATE INDEX idx_task_completions_task ON task_completions (task_id, completed_at DESC);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;
