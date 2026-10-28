CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY, nombre text NOT NULL, email text NOT NULL UNIQUE,
  telefono text NOT NULL, identity_user_id uuid NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS vehiculos (
  id uuid PRIMARY KEY, matricula text NOT NULL UNIQUE, marca text NOT NULL, modelo text NOT NULL,
  cliente_id uuid NOT NULL REFERENCES clientes(id)
);
CREATE TABLE IF NOT EXISTS reservas (
  id uuid PRIMARY KEY, cliente_id uuid NOT NULL REFERENCES clientes(id),
  vehiculo_id uuid NOT NULL REFERENCES vehiculos(id), inicio timestamptz NOT NULL, fin timestamptz NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ACTIVA','CANCELADA')),
  CHECK (inicio < fin),
  -- La base arbitra la concurrencia entre TODOS los procesos, incluso al modificar reservas.
  CONSTRAINT reservas_sin_solapamiento EXCLUDE USING gist
    (vehiculo_id WITH =, tstzrange(inicio,fin,'[)') WITH &&) WHERE (estado='ACTIVA')
);
CREATE INDEX IF NOT EXISTS vehiculos_cliente ON vehiculos(cliente_id);
CREATE INDEX IF NOT EXISTS reservas_cliente_inicio ON reservas(cliente_id,inicio,id);
CREATE INDEX IF NOT EXISTS reservas_estado_inicio ON reservas(estado,inicio,id);
CREATE INDEX IF NOT EXISTS reservas_inicio ON reservas(inicio,id);
CREATE INDEX IF NOT EXISTS reservas_vehiculo ON reservas(vehiculo_id);

-- Estado técnico de integración: comparte la transacción, pero no es una entidad del dominio.
CREATE SCHEMA IF NOT EXISTS integration;
CREATE TABLE IF NOT EXISTS integration.outbox (
  event_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS outbox_pending
  ON integration.outbox(next_attempt_at,created_at,event_id) WHERE delivered_at IS NULL;
