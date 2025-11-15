-- ===============================================================
--   BASE DE DATOS POSTGRESQL – Attendance System
--   Completa, optimizada, lista para producción
-- ===============================================================

-- ==========================
-- LIMPIEZA (OPCIONAL)
-- ==========================
-- DROP TABLE IF EXISTS attendance CASCADE;
-- DROP TABLE IF EXISTS employees CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;


-- ===============================================================
--   TABLE: employees
-- ===============================================================
CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    dni TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Producción', 'Al Dia')),
    monthly_salary NUMERIC(12,2) DEFAULT 0,
    photo TEXT,
    qr_code TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_employees_dni ON employees(dni);
CREATE INDEX IF NOT EXISTS idx_employees_type ON employees(type);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);


-- ===============================================================
--   TABLE: users
-- ===============================================================
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'scanner', 'viewer')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);


-- ===============================================================
--   TABLE: attendance
-- ===============================================================
CREATE TABLE IF NOT EXISTS attendance (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    entry_time TIMESTAMP,
    exit_time TIMESTAMP,
    hours_extra NUMERIC(10,2) DEFAULT 0,
    despalillo NUMERIC(12,2) DEFAULT 0,
    escogida NUMERIC(12,2) DEFAULT 0,
    monado NUMERIC(12,2) DEFAULT 0,
    t_despalillo NUMERIC(12,2) DEFAULT 0,
    t_escogida NUMERIC(12,2) DEFAULT 0,
    t_monado NUMERIC(12,2) DEFAULT 0,
    prop_sabado NUMERIC(12,2) DEFAULT 0,
    septimo_dia NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Evitar doble entrada por día
    UNIQUE (employee_id, date)
);

-- Optimización para filtros comunes
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);


-- ===============================================================
--   CREAR SUPER ADMIN POR DEFECTO
-- ===============================================================
-- ⚠️ IMPORTANTE:
-- Se usa la contraseña HASH generada con bcrypt (10 rounds)
-- Contraseña original:  admin123

INSERT INTO users (username, password, role)
VALUES (
    'admin',
    '$2a$10$wI9U2q0qz1WY5/PuBLyVV.GK95B2S/bRMyCV2wAPOQgpdnH3UX0kW',
    'super_admin'
)
ON CONFLICT (username) DO NOTHING;

-- ===============================================================
-- FIN DEL ARCHIVO
-- ===============================================================
