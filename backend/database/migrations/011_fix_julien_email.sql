-- Migration 011: Fix Julien's email (was duplicated with Lucas)
-- Both barbers had barberclubmeylan@gmail.com, only Lucas (rows[0]) could login

UPDATE barbers
SET email = 'julien@barberclub-grenoble.fr'
WHERE id = 'b0000000-0000-0000-0000-000000000002'
  AND email = 'barberclubmeylan@gmail.com';
